/**
 * Refusing an order: does everything it should unwind actually unwind?
 *
 * Cancelling is where quiet damage hides. A cancelled order that leaves its
 * sale standing keeps billing a customer for goods they will never receive, and
 * one that credits stock back after the money has been taken invents goods.
 * Every check below asserts an exact figure rather than "it worked".
 *
 *     node scripts/cancel_check.js <database>
 */
const Module = require("module");
const { Pool } = require("pg");

const DB = process.argv[2] || "qa_cancel";
const dbPath = require.resolve("../src/config/db");
const testPool = new Pool({ connectionString: `postgres://postgres@127.0.0.1:5433/${DB}` });
const stub = new Module(dbPath, null);
stub.exports = testPool;
stub.loaded = true;
require.cache[dbPath] = stub;

const orders = require("../src/controllers/orderController");
const parties = require("../src/controllers/partyController");
const partyService = require("../src/services/partyService");
const saleService = require("../src/services/orderSaleService");

const mk = () => {
  const r = { statusCode: 200, body: null };
  r.status = (c) => ((r.statusCode = c), r);
  r.json = (b) => ((r.body = b), r);
  return r;
};
const call = async (fn, req) => { const r = mk(); await fn(req, r); return r; };

let fails = 0;
const check = (cond, label, v) => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"} ${String(label).padEnd(50)} ${JSON.stringify(v)}`);
};
const q = (sql, args) => testPool.query(sql, args);

const stamp = Date.now();
let seq = 0;
const mkUser = async (role, phone) =>
  (await q(
    `INSERT INTO users (first_name,last_name,email,role,phone,password_hash)
     VALUES ($1,'T',$2,$3,$4,'x') RETURNING id`,
    [role === "seller" ? "Ram" : "Kishan", `${role}${stamp}${seq++}@x.local`, role, phone],
  )).rows[0].id;

(async () => {
  console.log(`\n=== cancelling, ${DB} ===`);
  partyService.resetPartyLink();
  saleService.resetSaleLink();

  const wid = await mkUser("seller", "9000000001");
  await q(
    `INSERT INTO wholesaler_profiles (user_id, company_name, upi_id, contact_phone, city)
     VALUES ($1,'Ram Textiles','ram@upi','9000000001','Surat')`,
    [wid],
  );
  const buyer = await mkUser("buyer", "9820011223");
  const seller = { id: wid, role: "seller" };
  const shopper = { id: buyer, role: "buyer" };

  // Two products, because an order holding several lines is the case dropped
  // by anything reading orders.inventory_item_id.
  const ids = [];
  for (const [name, price] of [["Cotton shirting", 142], ["Silk dupatta", 340]]) {
    const p = (await q(`INSERT INTO products (name,category) VALUES ($1,'Fabric') RETURNING id`, [name])).rows[0].id;
    const i = (await q(
      `INSERT INTO supplier_inventory (supplier_id,product_id,price,moq,stock,status,visibility,shipping_days,unit,gst_percent)
       VALUES ($1,$2,$3,1,0,'Active','public',5,'mtr',5) RETURNING id`,
      [wid, p, price],
    )).rows[0].id;
    ids.push({ p, i });
  }

  const place = async (who = buyer) =>
    call(orders.createOrder, {
      user: { id: who },
      body: {
        products: [
          { productId: ids[0].p, inventoryId: ids[0].i, quantity: 10 },
          { productId: ids[1].p, inventoryId: ids[1].i, quantity: 2 },
        ],
        deliveryAddress: { name: "Kishan Cloth House", phone: "9820011223", city: "Surat" },
      },
    });

  const statusOf = async (id) => (await q("SELECT status FROM orders WHERE id=$1", [id])).rows[0].status;
  const partyOf = async (id) => (await q("SELECT party_id FROM orders WHERE id=$1", [id])).rows[0].party_id;
  const balance = async (partyId) =>
    Number(
      (await call(parties.getPartyById, { user: seller, params: { id: partyId } })).body?.party
        ?.outstanding,
    );

  // ---- a seller refuses an order nobody has paid for -------------------
  const a = await place();
  check(a.statusCode === 201, "order placed", { s: a.statusCode });
  const partyId = await partyOf(a.body.orderId);
  check((await balance(partyId)) === 0, "a pending order is not owed yet", { bal: await balance(partyId) });

  const refused = await call(orders.cancelOrderHandler, {
    user: seller,
    params: { orderId: a.body.orderId },
    body: { reason: "Out of this colour" },
  });
  check(refused.statusCode === 200, "seller may refuse a new order", { s: refused.statusCode, m: refused.body?.message });
  check((await statusOf(a.body.orderId)) === "cancelled", "order is cancelled", {});
  check((await balance(partyId)) === 0, "nothing is owed for a refused order", { bal: await balance(partyId) });

  const hist = await q(
    `SELECT status, previous_status, updated_by_role, remarks FROM order_status_history
      WHERE order_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [a.body.orderId],
  );
  check(hist.rows[0]?.remarks === "Out of this colour", "the reason is written down", hist.rows[0]?.remarks);
  check(hist.rows[0]?.updated_by_role === "supplier", "recorded against the seller", hist.rows[0]?.updated_by_role);

  const twice = await call(orders.cancelOrderHandler, {
    user: seller, params: { orderId: a.body.orderId }, body: {},
  });
  check(twice.statusCode === 400, "a cancelled order cannot be cancelled again", { s: twice.statusCode });

  // ---- a buyer calls off their own order ---------------------------------
  const b = await place();
  const byBuyer = await call(orders.cancelOrderHandler, {
    user: shopper, params: { orderId: b.body.orderId }, body: {},
  });
  check(byBuyer.statusCode === 200, "buyer may cancel their own order", { s: byBuyer.statusCode });
  const bHist = await q(
    `SELECT updated_by_role FROM order_status_history WHERE order_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [b.body.orderId],
  );
  check(bHist.rows[0]?.updated_by_role === "buyer", "recorded against the buyer", bHist.rows[0]?.updated_by_role);

  // ---- a stranger may not touch it -------------------------------------
  const c = await place();
  const stranger = await mkUser("buyer", "9700000009");
  const denied = await call(orders.cancelOrderHandler, {
    user: { id: stranger, role: "buyer" }, params: { orderId: c.body.orderId }, body: {},
  });
  check(denied.statusCode === 403, "a stranger cannot cancel someone's order", { s: denied.statusCode });
  check((await statusOf(c.body.orderId)) !== "cancelled", "and the order is untouched", {});

  // ---- an accepted, paid order takes its sale down with it -------------
  // A fresh buyer, so this customer's balance is only about this order.
  const dBuyer = await mkUser("buyer", "9820044556");
  const d = await place(dBuyer);
  const dParty = await partyOf(d.body.orderId);
  await call(orders.initiatePayment, {
    user: { id: dBuyer }, params: { orderId: d.body.orderId }, body: {},
  });
  await call(orders.updatePaymentStatus, {
    user: { id: dBuyer }, params: { orderId: d.body.orderId }, body: { paymentStatus: "paid" },
  });
  const paid = Number((await q("SELECT amount_paid FROM orders WHERE id=$1", [d.body.orderId])).rows[0].amount_paid);
  check(paid === 2100, "buyer paid in full", { paid });

  await call(orders.updateOrderStatus, {
    user: seller, params: { orderId: d.body.orderId }, body: { status: "supplier_accepted" },
  });
  const sale = await q("SELECT id, status, total FROM sales WHERE order_id=$1", [d.body.orderId]);
  check(sale.rows.length === 1, "accepting wrote a sale", { n: sale.rows.length });
  check(Number(sale.rows[0]?.total) === 2100, "the sale is for what the order charged", sale.rows[0]?.total);
  // Billed 2100 once, paid 2100. A double count would read 2100, not 0.
  check((await balance(dParty)) === 0, "billed once, not twice", { bal: await balance(dParty) });

  const dCancel = await call(orders.cancelOrderHandler, {
    user: seller, params: { orderId: d.body.orderId }, body: { reason: "Cannot fill it" },
  });
  check(dCancel.statusCode === 200, "a paid order can still be refused", { s: dCancel.statusCode });
  check(dCancel.body?.paymentLeftInPlace === true, "and it says the money is still there", dCancel.body?.paymentLeftInPlace);

  const after = await q("SELECT status FROM sales WHERE order_id=$1", [d.body.orderId]);
  check(after.rows[0].status === "cancelled", "the sale is cancelled too", after.rows[0].status);
  const still = Number(
    (await q("SELECT COALESCE(SUM(amount),0) AS n FROM party_payments WHERE party_id=$1", [dParty]))
      .rows[0].n,
  );
  check(still === 2100, "the payment is not deleted", { still });
  check((await balance(dParty)) === -2100, "customer is in credit, so they are owed a refund", { bal: await balance(dParty) });

  // ---- stock is not invented -------------------------------------------
  // Stock tracking is off, so checkout floors the subtraction at zero and a
  // listing that started at zero gave nothing up. Cancelling must not hand
  // back goods that were never taken.
  const stock = Number((await q("SELECT stock FROM supplier_inventory WHERE id=$1", [ids[0].i])).rows[0].stock);
  check(stock === 0, "cancelling did not invent stock", { stock });

  // ---- an order already sent out cannot be called off ------------------
  const fBuyer = await mkUser("buyer", "9820077889");
  const f = await place(fBuyer);
  await call(orders.initiatePayment, { user: { id: fBuyer }, params: { orderId: f.body.orderId }, body: {} });
  await call(orders.updatePaymentStatus, {
    user: { id: fBuyer }, params: { orderId: f.body.orderId }, body: { paymentStatus: "paid" },
  });
  for (const s of ["supplier_accepted", "processing", "packed", "ready_for_pickup", "shipped"]) {
    await call(orders.updateOrderStatus, { user: seller, params: { orderId: f.body.orderId }, body: { status: s } });
  }
  check((await statusOf(f.body.orderId)) === "shipped", "order is on its way", {});
  const late = await call(orders.cancelOrderHandler, {
    user: seller, params: { orderId: f.body.orderId }, body: {},
  });
  check(late.statusCode === 400, "a shipped order cannot be refused", { s: late.statusCode });
  check(/return/i.test(late.body?.message || ""), "and it points at a return instead", late.body?.message);
  const fSale = await q("SELECT status FROM sales WHERE order_id=$1", [f.body.orderId]);
  check(fSale.rows[0]?.status !== "cancelled", "its sale is left alone", fSale.rows[0]?.status);

  // ---- the bell actually rings -----------------------------------------
  // Every in app notification insert used to fail on a not null column and
  // the error was swallowed, so this counts rows rather than trusting that
  // the call was made.
  const notes = await q(
    `SELECT type, notification_type, title FROM notifications
      WHERE user_id = $1 ORDER BY created_at`,
    [dBuyer],
  );
  check(notes.rows.length > 0, "the buyer was told their payment landed", { n: notes.rows.length });
  check(
    notes.rows.every((n) => n.type && n.notification_type),
    "both type columns are filled in",
    notes.rows[0],
  );

  console.log(fails === 0 ? "\nall good\n" : `\n${fails} failure(s)\n`);
  process.exitCode = fails === 0 ? 0 : 1;
  await testPool.end();
})();

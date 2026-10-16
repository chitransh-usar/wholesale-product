/**
 * Does a return actually go round, and does the money follow it?
 *
 * The return flow existed on paper and nowhere else: the buyer's route set a
 * flag, orders.status never moved, and there was no answer a wholesaler could
 * give. So every check here starts from a real delivered order and asserts an
 * exact figure rather than a status word.
 *
 * The trap this is really watching for: an accepted order writes itself a
 * sale, and from then on the sale is what the khata bills. partyController
 * leaves an order at return_completed off the billed side, but for an order
 * that reached delivery that clause does nothing, because the debt is coming
 * from the sale. Miss that and a customer goes on owing for goods sitting
 * back in the godown.
 *
 *     node scripts/return_check.js <database>
 */
const Module = require("module");
const { Pool } = require("pg");

const DB = process.argv[2] || "qa_return";
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
  console.log(`  ${cond ? "PASS" : "FAIL"} ${String(label).padEnd(52)} ${JSON.stringify(v ?? "")}`);
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
  console.log(`\n=== returns, ${DB} ===`);
  partyService.resetPartyLink();
  saleService.resetSaleLink();

  const wid = await mkUser("seller", "9000000001");
  await q(
    `INSERT INTO wholesaler_profiles (user_id, company_name, upi_id, contact_phone, city, gstin)
     VALUES ($1,'Ram Textiles','ram@upi','9000000001','Surat','24AAAAA0000A1Z8')`,
    [wid],
  );
  const seller = { id: wid, role: "seller" };

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

  const statusOf = async (id) => (await q("SELECT status FROM orders WHERE id=$1", [id])).rows[0].status;
  const balance = async (partyId) =>
    Number(
      (await call(parties.getPartyById, { user: seller, params: { id: partyId } })).body?.party
        ?.outstanding,
    );

  /** A fresh buyer each time, so one customer's balance is about one order. */
  const deliveredOrder = async (phone) => {
    const buyer = await mkUser("buyer", phone);
    const placed = await call(orders.createOrder, {
      user: { id: buyer },
      body: {
        products: [
          { productId: ids[0].p, inventoryId: ids[0].i, quantity: 10 },
          { productId: ids[1].p, inventoryId: ids[1].i, quantity: 2 },
        ],
        deliveryAddress: { name: "Kishan Cloth House", phone, city: "Surat" },
      },
    });
    const orderId = placed.body.orderId;
    await call(orders.initiatePayment, { user: { id: buyer }, params: { orderId }, body: {} });
    await call(orders.updatePaymentStatus, {
      user: { id: buyer }, params: { orderId }, body: { paymentStatus: "paid" },
    });
    for (const s of ["supplier_accepted", "processing", "packed", "ready_for_pickup",
                     "shipped", "in_transit", "out_for_delivery", "delivered"]) {
      await call(orders.updateOrderStatus, { user: seller, params: { orderId }, body: { status: s } });
    }
    const partyId = (await q("SELECT party_id FROM orders WHERE id=$1", [orderId])).rows[0].party_id;
    return { buyer, orderId, partyId };
  };

  // ---- the buyer asks --------------------------------------------------
  const a = await deliveredOrder("9820011223");
  check((await statusOf(a.orderId)) === "delivered", "an order was delivered", {});
  check((await balance(a.partyId)) === 0, "billed 2100, paid 2100, so nothing owed", { bal: await balance(a.partyId) });

  const noReason = await call(orders.requestReturn, {
    user: { id: a.buyer, role: "buyer" }, params: { orderId: a.orderId }, body: {},
  });
  check(noReason.statusCode === 400, "a return with no reason is refused", { s: noReason.statusCode });

  const asked = await call(orders.requestReturn, {
    user: { id: a.buyer, role: "buyer" },
    params: { orderId: a.orderId },
    body: { reason: "Short by four metres" },
  });
  check(asked.statusCode === 200, "the buyer can ask to send goods back", { s: asked.statusCode });
  check(
    (await statusOf(a.orderId)) === "return_requested",
    "and the ORDER moves, not just a flag nobody reads",
    await statusOf(a.orderId),
  );
  const row = (await q("SELECT return_status, return_reason FROM orders WHERE id=$1", [a.orderId])).rows[0];
  check(row.return_status === "requested", "the old column is kept current too", row.return_status);
  check(row.return_reason === "Short by four metres", "their reason is written down", row.return_reason);

  const stranger = await mkUser("buyer", "9700000009");
  const nosy = await call(orders.requestReturn, {
    user: { id: stranger, role: "buyer" }, params: { orderId: a.orderId }, body: { reason: "mine now" },
  });
  check(nosy.statusCode === 403, "a stranger cannot return someone's order", { s: nosy.statusCode });

  // ---- the wholesaler accepts, and the money unwinds --------------------
  const approved = await call(orders.updateOrderStatus, {
    user: seller, params: { orderId: a.orderId }, body: { status: "return_approved" },
  });
  check(approved.statusCode === 200, "the wholesaler accepts the return", { s: approved.statusCode });
  check((await balance(a.partyId)) === 0, "accepting alone does not move the khata yet", { bal: await balance(a.partyId) });

  const done = await call(orders.updateOrderStatus, {
    user: seller, params: { orderId: a.orderId }, body: { status: "return_completed" },
  });
  check(done.statusCode === 200, "and marks the goods back", { s: done.statusCode });

  const sale = (await q("SELECT status FROM sales WHERE order_id=$1", [a.orderId])).rows[0];
  check(sale?.status === "cancelled", "the sale is cancelled, so billing stops", sale?.status);
  // Billed nothing now, and they paid 2100, so they are owed it back.
  check((await balance(a.partyId)) === -2100, "the customer is owed their money back", { bal: await balance(a.partyId) });

  const paid = Number(
    (await q("SELECT COALESCE(SUM(amount),0) AS n FROM party_payments WHERE party_id=$1", [a.partyId]))
      .rows[0].n,
  );
  check(paid === 2100, "the payment itself is not deleted", { paid });

  const note = await q(
    `SELECT cn.note_number, cn.reason, cn.grand_total
       FROM credit_notes cn JOIN invoices i ON i.id = cn.invoice_id
      WHERE i.order_id = $1`,
    [a.orderId],
  );
  check(note.rows.length === 1, "a credit note is raised against the invoice", note.rows[0]?.note_number);
  check(note.rows[0]?.reason === "goods_returned", "for the right reason", note.rows[0]?.reason);

  // ---- the bill is found by whichever road it was raised on -------------
  //
  // unwindReturnedOrder used to look only at invoices.order_id, and missed a
  // bill raised from the SALE, which is what happens whenever the wholesaler
  // takes the balance in cash and records it on the khata: that invoice
  // carries a sale_id and no order_id. The goods came back, the sale was
  // cancelled, and a tax invoice was left standing with nothing reversing it.
  //
  // It also missed a bill that had not landed yet, because both billing paths
  // run in the background. That one only showed itself when the suites were
  // run back to back and the database was busy, which is the worst way for a
  // fault to announce itself.
  const orphan = await deliveredOrder("9820077889");
  // Re-shape the bill into what the sale side produces: a sale_id and no
  // order_id. That is what a cash settled order-backed sale really writes.
  await q(
    `UPDATE invoices
        SET order_id = NULL,
            sale_id = (SELECT id FROM sales WHERE order_id = $1)
      WHERE order_id = $1`,
    [orphan.orderId],
  );
  const reshaped = await q(
    `SELECT i.id FROM invoices i JOIN sales s ON s.id = i.sale_id
      WHERE s.order_id = $1 AND i.order_id IS NULL`,
    [orphan.orderId],
  );
  check(reshaped.rows.length === 1, "a bill carrying only a sale_id", {
    why: "which is what a cash settled order-backed sale produces",
  });

  await call(orders.requestReturn, {
    user: { id: orphan.buyer, role: "buyer" }, params: { orderId: orphan.orderId },
    body: { reason: "shade" },
  });
  for (const st of ["return_approved", "return_completed"]) {
    await call(orders.updateOrderStatus, {
      user: seller, params: { orderId: orphan.orderId }, body: { status: st },
    });
  }
  const foundAnyway = await q(
    `SELECT cn.note_number FROM credit_notes cn
       JOIN invoices i ON i.id = cn.invoice_id
       JOIN sales s ON s.id = i.sale_id
      WHERE s.order_id = $1`,
    [orphan.orderId],
  );
  check(foundAnyway.rows.length === 1,
    "is still found and still reversed", { note: foundAnyway.rows[0]?.note_number });

  // ---- refusing a return leaves the debt alone --------------------------
  const b = await deliveredOrder("9820044556");
  // They have the goods and has not paid, so they owe for them.
  await q("UPDATE orders SET amount_paid = 0, remaining_amount = total_amount WHERE id = $1", [b.orderId]);
  await q("DELETE FROM party_payments WHERE party_id = $1", [b.partyId]);
  check((await balance(b.partyId)) === 2100, "an unpaid delivered order is owed", { bal: await balance(b.partyId) });

  await call(orders.requestReturn, {
    user: { id: b.buyer, role: "buyer" }, params: { orderId: b.orderId }, body: { reason: "Changed my mind" },
  });
  const refused = await call(orders.updateOrderStatus, {
    user: seller, params: { orderId: b.orderId }, body: { status: "return_rejected" },
  });
  check(refused.statusCode === 200, "the wholesaler can refuse a return", { s: refused.statusCode });
  check((await balance(b.partyId)) === 2100, "a refused return stays owed, they have the goods", { bal: await balance(b.partyId) });
  const bSale = (await q("SELECT status FROM sales WHERE order_id=$1", [b.orderId])).rows[0];
  check(bSale?.status !== "cancelled", "and its sale stands", bSale?.status);

  // ---- an order nobody has received cannot be sent back -----------------
  const c = await mkUser("buyer", "9820077889");
  const fresh = await call(orders.createOrder, {
    user: { id: c },
    body: {
      products: [{ productId: ids[0].p, inventoryId: ids[0].i, quantity: 1 }],
      deliveryAddress: { name: "Kishan Cloth House", phone: "9820077889", city: "Surat" },
    },
  });
  const early = await call(orders.requestReturn, {
    user: { id: c, role: "buyer" }, params: { orderId: fresh.body.orderId }, body: { reason: "too early" },
  });
  check(early.statusCode === 400, "goods that never arrived cannot be sent back", { s: early.statusCode });
  check(/delivered/i.test(early.body?.message || ""), "and it says why", early.body?.message);

  console.log(fails === 0 ? "\nall good\n" : `\n${fails} failure(s)\n`);
  process.exitCode = fails === 0 ? 0 : 1;
  await testPool.end();
})();

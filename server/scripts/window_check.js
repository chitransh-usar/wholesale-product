/**
 * When does an order stop being undoable, and does the money follow it back?
 *
 * Two things were missing.
 *
 * The return door never shut. `delivered` is `delivered` whether the goods
 * arrived this morning or last February, so an order from a year ago could
 * still be sent back and the wholesaler had nothing to point at when they said
 * no. The clock is a separate question from the lifecycle and had never been
 * asked. orders.actual_delivery_date existed from the beginning with nothing
 * ever writing to it, which is why there was no date to ask about.
 *
 * The cancel door was ajar in a way the buttons hid. The refuse button stops
 * at packed, but the status map allowed cancelled from packed, ready_for_pickup
 * and shipped, and the generic status route writes whatever it is passed. So
 * an order already with a driver could be killed by posting a status directly.
 *
 * And the last step of a return, return_completed to refunded, existed in the
 * lifecycle and nothing had ever called it, so every returned order stopped one
 * step short with the customer's money still in the till and no way to clear
 * the line that said so.
 *
 *     node scripts/window_check.js <database>
 */
const Module = require("module");
const { Pool } = require("pg");

const DB = process.argv[2] || "qa_window";
const dbPath = require.resolve("../src/config/db");
const testPool = new Pool({ connectionString: `postgres://postgres@127.0.0.1:5433/${DB}` });
const stub = new Module(dbPath, null);
stub.exports = testPool;
stub.loaded = true;
require.cache[dbPath] = stub;

const orders = require("../src/controllers/orderController");
const parties = require("../src/controllers/partyController");
const overview = require("../src/controllers/overviewController");
const partyService = require("../src/services/partyService");
const saleService = require("../src/services/orderSaleService");
const { returnWindow, RETURN_WINDOW_DAYS } = require("../src/services/orderWindows");
const { validateStatusTransition } = require("../src/services/orderStatusService");

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
  console.log(`  ${cond ? "PASS" : "FAIL"} ${String(label).padEnd(54)} ${JSON.stringify(v ?? "")}`);
};
const q = (sql, args) => testPool.query(sql, args);
const num = (n) => Number(Number(n || 0).toFixed(2));

const stamp = Date.now();
let seq = 0;
const mkUser = async (role, phone) =>
  (await q(
    `INSERT INTO users (first_name,last_name,email,role,phone,password_hash)
     VALUES ($1,'T',$2,$3,$4,'x') RETURNING id`,
    [role === "seller" ? "Ram" : "Kishan", `${role}${stamp}${seq++}@x.local`, role, phone],
  )).rows[0].id;

(async () => {
  console.log(`\n=== cancellation window and refunds, ${DB} ===`);
  partyService.resetPartyLink();
  saleService.resetSaleLink();

  // ---- the clock on its own, before any database ------------------------
  const day = 24 * 60 * 60 * 1000;
  const now = new Date("2026-09-10T12:00:00Z");
  check(returnWindow(new Date(now - 1 * day), now).open,
    "a day after delivery the return is open", {});
  check(returnWindow(new Date(now - 1 * day), now).daysLeft === 6,
    "and says six days are left", { d: returnWindow(new Date(now - 1 * day), now).daysLeft });
  check(returnWindow(new Date(now - 6.5 * day), now).open,
    "on the last part day it is still open", {});
  check(returnWindow(new Date(now - 6.5 * day), now).daysLeft === 1,
    "and rounds up to one day rather than nought",
    { d: returnWindow(new Date(now - 6.5 * day), now).daysLeft });
  check(!returnWindow(new Date(now - 8 * day), now).open,
    `after ${RETURN_WINDOW_DAYS} days it is shut`, {});
  check(returnWindow(new Date(now - 8 * day), now).daysLeft === 0,
    "with no days left", {});
  check(returnWindow(null, now).open,
    "no delivery date on record means open, not shut", {});
  check(returnWindow(null, now).knownDelivery === false,
    "and says the date is not known", {});

  // ---- the status map ----------------------------------------------------
  for (const from of ["packed", "ready_for_pickup", "shipped"]) {
    check(!validateStatusTransition(from, "cancelled").valid,
      `${from} can no longer be cancelled outright`, {});
  }
  for (const from of ["payment_completed", "supplier_accepted", "processing"]) {
    check(validateStatusTransition(from, "cancelled").valid,
      `${from} can still be cancelled`, {});
  }
  check(validateStatusTransition("failed_delivery", "cancelled").valid,
    "a failed delivery still has a way out", {});
  check(validateStatusTransition("return_completed", "refunded").valid,
    "a completed return can be refunded", {});

  // ---- a real order ------------------------------------------------------
  const wid = await mkUser("seller", "9000000001");
  await q(
    `INSERT INTO wholesaler_profiles (user_id, company_name, upi_id, contact_phone, city, gstin)
     VALUES ($1,'Ram Textiles','ram@upi','9000000001','Surat','24AAAAA0000A1Z8')`,
    [wid],
  );
  const seller = { id: wid, role: "seller" };

  const p = (await q(`INSERT INTO products (name,category) VALUES ($1,'Fabric') RETURNING id`,
    [`Cotton shirting ${stamp}`])).rows[0].id;
  const inv = (await q(
    `INSERT INTO supplier_inventory (supplier_id,product_id,price,moq,stock,status,visibility,shipping_days,unit,gst_percent)
     VALUES ($1,$2,200,1,0,'Active','public',5,'mtr',5) RETURNING id`,
    [wid, p],
  )).rows[0].id;

  const statusOf = async (id) => (await q("SELECT status FROM orders WHERE id=$1", [id])).rows[0].status;
  const balance = async (partyId) =>
    num((await call(parties.getPartyById, { user: seller, params: { id: partyId } })).body?.party?.outstanding);

  const deliveredOrder = async (phone) => {
    const buyer = await mkUser("buyer", phone);
    const placed = await call(orders.createOrder, {
      user: { id: buyer },
      body: {
        products: [{ productId: p, inventoryId: inv, quantity: 10 }],
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
    const row = (await q("SELECT party_id, amount_paid FROM orders WHERE id=$1", [orderId])).rows[0];
    return { buyer, orderId, partyId: row.party_id, paid: num(row.amount_paid) };
  };

  // ---- delivery is now dated ---------------------------------------------
  const a = await deliveredOrder("9820011001");
  const dated = (await q("SELECT actual_delivery_date FROM orders WHERE id=$1", [a.orderId])).rows[0];
  check(!!dated.actual_delivery_date,
    "delivering an order writes down the date", { at: dated.actual_delivery_date });

  const detail = await call(orders.getOrderById, {
    user: seller, params: { orderId: a.orderId },
  });
  check(detail.body?.returnWindow?.open === true,
    "the order page says the return door is open", detail.body?.returnWindow);
  check(detail.body?.returnWindow?.daysLeft === RETURN_WINDOW_DAYS,
    "with the full window left on the day of delivery",
    { d: detail.body?.returnWindow?.daysLeft });

  // ---- inside the window -------------------------------------------------
  const inTime = await call(orders.requestReturn, {
    user: { id: a.buyer, role: "buyer" }, params: { orderId: a.orderId },
    body: { reason: "Colour is wrong" },
  });
  check(inTime.statusCode === 200, "a return asked for today is accepted", { s: inTime.statusCode });
  check((await statusOf(a.orderId)) === "return_requested", "and the order moves", {});

  // ---- outside the window ------------------------------------------------
  const b = await deliveredOrder("9820011002");
  await q(
    `UPDATE orders SET actual_delivery_date = CURRENT_DATE - INTERVAL '30 days' WHERE id = $1`,
    [b.orderId],
  );
  // The history row still says today, so this also proves the date column is
  // read first rather than the history being scanned regardless.
  const tooLate = await call(orders.requestReturn, {
    user: { id: b.buyer, role: "buyer" }, params: { orderId: b.orderId },
    body: { reason: "Changed my mind" },
  });
  check(tooLate.statusCode === 400, "a return asked for a month later is refused", { s: tooLate.statusCode });
  check(tooLate.body?.code === "RETURN_WINDOW_CLOSED", "with a reason a screen can act on", tooLate.body);
  check((await statusOf(b.orderId)) === "delivered", "and the order does not move", { s: await statusOf(b.orderId) });

  const lateDetail = await call(orders.getOrderById, { user: seller, params: { orderId: b.orderId } });
  check(lateDetail.body?.returnWindow?.open === false,
    "the order page agrees the door is shut", lateDetail.body?.returnWindow);

  // ---- the refund --------------------------------------------------------
  // Take order (a) the rest of the way round.
  await call(orders.updateOrderStatus, { user: seller, params: { orderId: a.orderId }, body: { status: "return_approved" } });
  await call(orders.updateOrderStatus, { user: seller, params: { orderId: a.orderId }, body: { status: "return_completed" } });
  check((await statusOf(a.orderId)) === "return_completed", "the goods come back", {});

  const heldBack = await balance(a.partyId);
  check(heldBack === -a.paid,
    "their money is now showing as owed back to them", { balance: heldBack, paid: a.paid });

  const owedBack = async () => {
    const o = await call(overview.getOverview, { user: seller, query: {} });
    return { outstanding: num(o.body?.money?.outstanding), owedBack: num(o.body?.money?.owedBack) };
  };
  const before = await owedBack();
  check(before.owedBack === a.paid,
    "and the Overview reports it as money you are holding", before);
  check(before.outstanding >= 0, "still to collect stays at nought or above", before);

  // A buyer cannot refund themselves.
  const notYours = await call(orders.refundOrder, {
    user: { id: a.buyer, role: "buyer" }, params: { orderId: a.orderId }, body: {},
  });
  check(notYours.statusCode === 403, "only the seller can record a refund", { s: notYours.statusCode });

  // More than came in is capped rather than refused, so a fat finger cannot
  // put the customer in debt.
  const over = await call(orders.refundOrder, {
    user: seller, params: { orderId: a.orderId }, body: { amount: a.paid * 5 },
  });
  check(over.statusCode === 200, "an over large refund is accepted", { s: over.statusCode });
  check(num(over.body?.refundAmount) === a.paid,
    "but capped at what was actually received", { asked: a.paid * 5, gave: over.body?.refundAmount });
  check((await statusOf(a.orderId)) === "refunded", "the order is now refunded", {});

  const after = await balance(a.partyId);
  check(after === 0, "and their account comes back to zero", { balance: after });
  const totals = await owedBack();
  check(totals.owedBack === 0, "the Overview no longer says you are holding their money", totals);
  check(totals.outstanding === 0, "and nothing is to collect either", totals);

  // The breakdown page has to agree with the card that sent them there.
  const rows = await call(overview.getBreakdown, { user: seller, query: { metric: "outstanding" } });
  const hisRow = (rows.body?.rows || []).find((r) => String(r.id) === String(a.partyId));
  check(!hisRow, "a settled customer drops off the breakdown", { n: (rows.body?.rows || []).length });

  // Refunding twice must not double up.
  const again = await call(orders.refundOrder, { user: seller, params: { orderId: a.orderId }, body: {} });
  check(again.statusCode === 400, "an order cannot be refunded twice", { s: again.statusCode });
  check((await balance(a.partyId)) === 0, "and the balance is untouched by the attempt", {});

  // An order nobody paid for has nothing to refund.
  const c = await deliveredOrder("9820011003");
  await q("UPDATE orders SET amount_paid = 0, remaining_amount = total_amount WHERE id=$1", [c.orderId]);
  await call(orders.requestReturn, {
    user: { id: c.buyer, role: "buyer" }, params: { orderId: c.orderId }, body: { reason: "Torn" },
  });
  await call(orders.updateOrderStatus, { user: seller, params: { orderId: c.orderId }, body: { status: "return_approved" } });
  await call(orders.updateOrderStatus, { user: seller, params: { orderId: c.orderId }, body: { status: "return_completed" } });
  const nothing = await call(orders.refundOrder, { user: seller, params: { orderId: c.orderId }, body: {} });
  check(nothing.statusCode === 400, "an unpaid order has nothing to refund", { s: nothing.statusCode });

  console.log(fails ? `\n${fails} FAILED\n` : "\nall good\n");
  await testPool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("THREW", e); process.exit(1); });

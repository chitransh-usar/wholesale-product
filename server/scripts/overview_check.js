/**
 * Does the Overview agree with the customer page about money?
 *
 * It did not, and the way it failed was the worst kind: a plausible number
 * with a minus in front of it. The Overview billed from sales alone but
 * subtracted every payment including the ones taken through the shop, so a
 * wholesaler whose customers had paid through the marketplace was shown a
 * negative amount still to collect. The payment came off the total and the
 * order behind it was never added on.
 *
 * So this does not check the Overview against a figure typed into this file.
 * It checks it against the customer pages, one by one, because two screens
 * answering the same question differently is the actual bug.
 *
 *     node scripts/overview_check.js <database>
 */
const Module = require("module");
const { Pool } = require("pg");

const DB = process.argv[2] || "qa_overview";
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
  console.log(`\n=== overview money, ${DB} ===`);
  partyService.resetPartyLink();
  saleService.resetSaleLink();

  const wid = await mkUser("seller", "9000000001");
  await q(
    `INSERT INTO wholesaler_profiles (user_id, company_name, upi_id, contact_phone, city)
     VALUES ($1,'Ram Textiles','ram@upi','9000000001','Surat')`,
    [wid],
  );
  const seller = { id: wid, role: "seller" };

  const prod = (await q(`INSERT INTO products (name,category) VALUES ('Cotton','Fabric') RETURNING id`)).rows[0].id;
  const inv = (await q(
    `INSERT INTO supplier_inventory (supplier_id,product_id,price,moq,stock,status,visibility,shipping_days,unit,gst_percent)
     VALUES ($1,$2,100,1,0,'Active','public',5,'mtr',5) RETURNING id`,
    [wid, prod],
  )).rows[0].id;

  const seen = async () => {
    const r = await call(overview.getOverview, { user: seller });
    return r.body;
  };
  const partyBalance = async (id) =>
    Number((await call(parties.getPartyById, { user: seller, params: { id } })).body?.party?.outstanding);

  const emptyBook = await seen();
  check(Number(emptyBook.money.outstanding) === 0, "a new account is owed nothing", emptyBook.money.outstanding);

  // ---- the exact shape that produced a minus sign -----------------------
  // A shop order, paid in full, never accepted. The payment is in the khata;
  // the order is on the billed side until it becomes a sale.
  const buyer = await mkUser("buyer", "9820011223");
  const placed = await call(orders.createOrder, {
    user: { id: buyer },
    body: {
      products: [{ productId: prod, inventoryId: inv, quantity: 10 }],
      deliveryAddress: { name: "Kishan Cloth House", phone: "9820011223", city: "Surat" },
    },
  });
  const orderId = placed.body.orderId;
  const partyId = (await q("SELECT party_id FROM orders WHERE id=$1", [orderId])).rows[0].party_id;

  await call(orders.initiatePayment, { user: { id: buyer }, params: { orderId }, body: {} });
  await call(orders.updatePaymentStatus, {
    user: { id: buyer }, params: { orderId }, body: { paymentStatus: "paid" },
  });

  const paidOrder = await seen();
  check(
    Number(paidOrder.money.outstanding) >= 0,
    "a paid shop order never makes the total go negative",
    paidOrder.money.outstanding,
  );
  check(
    Number(paidOrder.money.outstanding) === (await partyBalance(partyId)),
    "and the Overview agrees with the customer page",
    { overview: paidOrder.money.outstanding, customer: await partyBalance(partyId) },
  );
  check(
    Number(paidOrder.money.receivedThisMonth) === 1000,
    "the money received is counted",
    paidOrder.money.receivedThisMonth,
  );
  check(
    Number(paidOrder.money.billedThisMonth) === 1000,
    "and so is what they were billed for it",
    paidOrder.money.billedThisMonth,
  );

  // ---- accepting turns it into a sale, and must not double the debt -----
  await call(orders.updateOrderStatus, {
    user: seller, params: { orderId }, body: { status: "supplier_accepted" },
  });
  const accepted = await seen();
  check(
    Number(accepted.money.outstanding) === (await partyBalance(partyId)),
    "still agrees once the order becomes a sale",
    { overview: accepted.money.outstanding, customer: await partyBalance(partyId) },
  );
  check(
    Number(accepted.money.billedThisMonth) === 1000,
    "billed once, not twice",
    accepted.money.billedThisMonth,
  );

  // ---- an unpaid shop order is a debt the Overview must show ------------
  const buyer2 = await mkUser("buyer", "9820044556");
  const owing = await call(orders.createOrder, {
    user: { id: buyer2 },
    body: {
      products: [{ productId: prod, inventoryId: inv, quantity: 5 }],
      deliveryAddress: { name: "Modern Fabrics", phone: "9820044556", city: "Surat" },
    },
  });
  const owingParty = (await q("SELECT party_id FROM orders WHERE id=$1", [owing.body.orderId])).rows[0].party_id;
  await call(orders.initiatePayment, { user: { id: buyer2 }, params: { orderId: owing.body.orderId }, body: {} });
  await call(orders.updatePaymentStatus, {
    user: { id: buyer2 }, params: { orderId: owing.body.orderId }, body: { paymentStatus: "paid" },
  });
  await call(orders.updateOrderStatus, {
    user: seller, params: { orderId: owing.body.orderId }, body: { status: "supplier_accepted" },
  });
  // Wipe the payment to leave a customer who genuinely owes.
  await q("DELETE FROM party_payments WHERE party_id = $1", [owingParty]);

  const withDebt = await seen();
  const sumOfCustomers =
    (await partyBalance(partyId)) + (await partyBalance(owingParty));
  check(
    Number(withDebt.money.outstanding) === sumOfCustomers,
    "the total is what the customer pages add up to",
    { overview: withDebt.money.outstanding, customers: sumOfCustomers },
  );
  check(Number(withDebt.money.outstanding) === 500, "which is the 500 they are owed", withDebt.money.outstanding);

  const top = withDebt.topDues || withDebt.lists?.topDues || [];
  check(
    top.length === 1 && Number(top[0].outstanding) === 500,
    "and the same customer heads the who owes you list",
    top.map((t) => ({ name: t.name, out: t.outstanding })),
  );

  // ---- a cancelled order is owed by nobody ------------------------------
  await call(orders.cancelOrderHandler, {
    user: seller, params: { orderId: owing.body.orderId }, body: { reason: "Out of stock" },
  });
  const cancelled = await seen();
  check(Number(cancelled.money.outstanding) === 0, "cancelling clears the debt", cancelled.money.outstanding);
  check(
    Number(cancelled.money.outstanding) ===
      (await partyBalance(partyId)) + (await partyBalance(owingParty)),
    "and the two screens still agree",
    {},
  );

  // ---- a customer in credit must not go on the "still to collect" card ---
  // This is the shape that put a large minus sign on the dashboard: money
  // taken for an order that was later cancelled. The customer is genuinely
  // owed it back, so it must be reported, but not as a negative amount to
  // collect and not by cancelling out what other customers owe.
  const creditBuyer = await mkUser("buyer", "9820099887");
  const refunded = await call(orders.createOrder, {
    user: { id: creditBuyer },
    body: {
      products: [{ productId: prod, inventoryId: inv, quantity: 20 }],
      deliveryAddress: { name: "Credit Traders", phone: "9820099887", city: "Surat" },
    },
  });
  const creditParty = (await q("SELECT party_id FROM orders WHERE id=$1", [refunded.body.orderId])).rows[0].party_id;
  await call(orders.initiatePayment, { user: { id: creditBuyer }, params: { orderId: refunded.body.orderId }, body: {} });
  await call(orders.updatePaymentStatus, {
    user: { id: creditBuyer }, params: { orderId: refunded.body.orderId }, body: { paymentStatus: "paid" },
  });
  await call(orders.cancelOrderHandler, {
    user: seller, params: { orderId: refunded.body.orderId }, body: { reason: "Out of stock" },
  });
  check((await partyBalance(creditParty)) === -2000, "they paid 2000 for an order that was cancelled", { bal: await partyBalance(creditParty) });

  // And somebody who genuinely owes, at the same time.
  const debtBuyer = await mkUser("buyer", "9820055443");
  const unpaid = await call(orders.createOrder, {
    user: { id: debtBuyer },
    body: {
      products: [{ productId: prod, inventoryId: inv, quantity: 30 }],
      deliveryAddress: { name: "Debt Traders", phone: "9820055443", city: "Surat" },
    },
  });
  const debtParty = (await q("SELECT party_id FROM orders WHERE id=$1", [unpaid.body.orderId])).rows[0].party_id;
  await call(orders.initiatePayment, { user: { id: debtBuyer }, params: { orderId: unpaid.body.orderId }, body: {} });
  await call(orders.updatePaymentStatus, {
    user: { id: debtBuyer }, params: { orderId: unpaid.body.orderId }, body: { paymentStatus: "paid" },
  });
  await call(orders.updateOrderStatus, {
    user: seller, params: { orderId: unpaid.body.orderId }, body: { status: "supplier_accepted" },
  });
  await q("DELETE FROM party_payments WHERE party_id = $1", [debtParty]);
  check((await partyBalance(debtParty)) === 3000, "and somebody else owes 3000", { bal: await partyBalance(debtParty) });

  const mixed = await seen();
  check(Number(mixed.money.outstanding) === 3000, "still to collect is the 3000, not 1000", mixed.money.outstanding);
  check(Number(mixed.money.outstanding) >= 0, "and it can never be negative", mixed.money.outstanding);
  check(Number(mixed.money.owedBack) === 2000, "the 2000 owed back is reported separately", mixed.money.owedBack);

  // ---- the breakdown rows add up to the cards ---------------------------
  const detail = await call(overview.getBreakdown, { user: seller, query: { metric: "outstanding" } });
  const rows = detail.body.rows;
  const sumOwed = rows.reduce((t, r) => t + Math.max(Number(r.outstanding), 0), 0);
  const sumCredit = rows.reduce((t, r) => t + Math.max(-Number(r.outstanding), 0), 0);
  check(sumOwed === Number(mixed.money.outstanding), "the rows behind the card add up to the card", { rows: sumOwed, card: mixed.money.outstanding });
  check(sumCredit === Number(mixed.money.owedBack), "and the credits add up to the money owed back", { rows: sumCredit, card: mixed.money.owedBack });
  const oneRow = rows.find((r) => r.id === debtParty);
  check(
    Number(oneRow.billed_sales) + Number(oneRow.billed_orders) - Number(oneRow.received) === 3000,
    "each row shows the arithmetic that makes its balance",
    { sales: oneRow.billed_sales, orders: oneRow.billed_orders, received: oneRow.received },
  );

  const billed = await call(overview.getBreakdown, { user: seller, query: { metric: "billed" } });
  const billedSum = billed.body.rows.reduce((t, r) => t + Number(r.amount), 0);
  check(billedSum === Number(mixed.money.billedThisMonth), "billed rows add up to the billed card", { rows: billedSum, card: mixed.money.billedThisMonth });

  const received = await call(overview.getBreakdown, { user: seller, query: { metric: "received" } });
  const receivedSum = received.body.rows.reduce((t, r) => t + Number(r.amount), 0);
  check(receivedSum === Number(mixed.money.receivedThisMonth), "received rows add up to the received card", { rows: receivedSum, card: mixed.money.receivedThisMonth });

  const junk = await call(overview.getBreakdown, { user: seller, query: { metric: "whatever" } });
  check(junk.statusCode === 400, "an unknown metric is refused", { s: junk.statusCode });

  console.log(fails === 0 ? "\nall good\n" : `\n${fails} failure(s)\n`);
  process.exitCode = fails === 0 ? 0 : 1;
  await testPool.end();
})();

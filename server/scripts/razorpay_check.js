/**
 * The Razorpay scaffold, driven end to end.
 *
 * The gateway is a stub and order creation makes no network call, so what is
 * worth testing is not the happy path. It is everything the scaffold REFUSES,
 * because the whole argument for signing fake payments with real HMAC is that
 * the verify endpoint must be honest before anybody wires a real key to it.
 *
 * What has to hold:
 *   - a forged signature is refused and settles nothing
 *   - so is a signature that is valid for a DIFFERENT pair, which is the
 *     mistake of trusting the order id in the request body
 *   - a buyer cannot drive another buyer's payment
 *   - the amount comes from the session the server wrote, never the browser
 *   - a genuine payment settles through the normal path, so the order, the
 *     khata and the bill all move exactly as they do for a UPI payment
 *   - the same handler payload cannot be replayed to pay twice
 *   - "simulate" is unreachable once a real secret exists
 *
 *     node scripts/razorpay_check.js <database>
 */
const Module = require("module");
const { Pool } = require("pg");

const DB = process.argv[2] || "qa_rzp";
const dbPath = require.resolve("../src/config/db");
const testPool = new Pool({ connectionString: `postgres://postgres@127.0.0.1:5433/${DB}` });
const stub = new Module(dbPath, null);
stub.exports = testPool;
stub.loaded = true;
require.cache[dbPath] = stub;

const orders = require("../src/controllers/orderController");
const rzp = require("../src/controllers/razorpayController");
const razorpay = require("../src/services/razorpayService");
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
  console.log(`  ${cond ? "PASS" : "FAIL"} ${String(label).padEnd(58)} ${JSON.stringify(v ?? "")}`);
};
const q = (sql, args) => testPool.query(sql, args);
const money = (n) => Number(Number(n || 0).toFixed(2));

const stamp = Date.now();
let seq = 0;
const mkUser = async (role, phone) =>
  (await q(
    `INSERT INTO users (first_name,last_name,email,role,phone,password_hash)
     VALUES ($1,'T',$2,$3,$4,'x') RETURNING id`,
    [role === "seller" ? "Ram" : "Kishan", `rzp${role}${stamp}${seq++}@x.local`, role, phone],
  )).rows[0].id;

(async () => {
  console.log(`\n=== the razorpay scaffold, against ${DB} ===\n`);
  partyService.resetPartyLink();
  saleService.resetSaleLink();

  check(razorpay.isStub(), "running in stub mode, since no secret is set", {});

  const seller = await mkUser("seller", `90${String(stamp).slice(-8)}`);
  await q(
    `INSERT INTO wholesaler_profiles (user_id, company_name, upi_id, contact_phone, city, gstin)
     VALUES ($1,'Ram Textiles','ram@upi',$2,'Surat','24AAAAA0000A1Z8')`,
    [seller, `90${String(stamp).slice(-8)}`],
  );

  const product = (await q(
    `INSERT INTO products (name,category) VALUES ($1,'Fabric') RETURNING id`,
    [`Cotton shirting ${stamp}`])).rows[0].id;
  const listing = (await q(
    `INSERT INTO supplier_inventory (supplier_id,product_id,price,moq,stock,status,visibility,shipping_days,unit,gst_percent)
     VALUES ($1,$2,200,1,500,'Active','public',5,'mtr',5) RETURNING id`,
    [seller, product])).rows[0].id;

  const buyer = await mkUser("buyer", `98${String(stamp).slice(-8)}`);
  const intruder = await mkUser("buyer", `97${String(stamp).slice(-8)}`);

  const placed = await call(orders.createOrder, {
    user: { id: buyer },
    body: {
      products: [{ productId: product, inventoryId: listing, quantity: 10 }],
      deliveryAddress: { name: "Kishan Cloth House", phone: "9820011223", city: "Surat" },
    },
  });
  const orderId = placed.body?.orderId;
  check(!!orderId, "an order was placed", { s: placed.statusCode });
  const orderTotal = money((await q("SELECT total_amount FROM orders WHERE id=$1", [orderId])).rows[0].total_amount);

  const asBuyer = { user: { id: buyer }, params: { orderId } };
  const asIntruder = { user: { id: intruder }, params: { orderId } };

  // ---------------------------------------------------------------
  console.log("\n-- opening a gateway order --");

  const early = await call(rzp.createRazorpayOrder, { ...asBuyer });
  check(early.statusCode === 409 && early.body?.code === "NO_PAYMENT_SESSION",
    "refused before a payment session exists", { got: early.statusCode, code: early.body?.code });

  await call(orders.initiatePayment, { ...asBuyer, body: {} });

  const notYours = await call(rzp.createRazorpayOrder, { ...asIntruder });
  check(notYours.statusCode === 403, "another buyer cannot open it", { got: notYours.statusCode });

  const opened = await call(rzp.createRazorpayOrder, { ...asBuyer });
  check(opened.statusCode === 200, "the buyer can", { got: opened.statusCode, msg: opened.body?.message });
  check(opened.body?.stub === true, "and is told plainly that it is a stub", { stub: opened.body?.stub });
  check(/^order_stub/.test(opened.body?.orderId || ""), "a gateway order id comes back", { id: opened.body?.orderId });
  check(!("keySecret" in (opened.body || {})) && !JSON.stringify(opened.body).includes("secret"),
    "and no secret is anywhere in the reply", {});

  // The amount is the SERVER's, in paise, and matches what is owed.
  check(opened.body?.amount === Math.round(orderTotal * 100),
    "the amount is the order's own, in paise", { sent: opened.body?.amount, owed: Math.round(orderTotal * 100) });

  // ---------------------------------------------------------------
  console.log("\n-- the browser cannot name an amount --");

  await q("UPDATE payment_transactions SET payment_status='superseded' WHERE order_id=$1", [orderId]);
  await call(orders.initiatePayment, { ...asBuyer, body: {} });
  const greedy = await call(rzp.createRazorpayOrder, { ...asBuyer, body: { amount: 1, amountRupees: 1 } });
  check(greedy.body?.amount === Math.round(orderTotal * 100),
    "an amount in the body is ignored", { got: greedy.body?.amount, owed: Math.round(orderTotal * 100) });
  const gatewayOrderId = greedy.body.orderId;

  // ---------------------------------------------------------------
  console.log("\n-- verification refuses what it should --");

  const paid = async () =>
    money((await q("SELECT amount_paid FROM orders WHERE id=$1", [orderId])).rows[0].amount_paid);
  check((await paid()) === 0, "nothing is paid yet", { paid: await paid() });

  const forged = await call(rzp.verifyRazorpayPayment, {
    ...asBuyer,
    body: { razorpay_payment_id: "pay_madeup", razorpay_signature: "f".repeat(64) },
  });
  check(forged.statusCode === 400 && forged.body?.code === "SIGNATURE_INVALID",
    "a forged signature is refused", { got: forged.statusCode, code: forged.body?.code });
  check((await paid()) === 0, "and settles nothing", { paid: await paid() });

  // A signature that is perfectly valid, for a pair the attacker chose. This
  // is what catches the mistake of verifying against the posted order id
  // rather than the one the server stored on the session.
  const otherOrder = "order_stubattacker";
  const otherPayment = razorpay.stubPaymentId
    ? require("../src/services/razorpayService").stubPaymentId()
    : "pay_x";
  const selfConsistent = require("../src/services/razorpayService").signStub(otherOrder, otherPayment);
  const swapped = await call(rzp.verifyRazorpayPayment, {
    ...asBuyer,
    body: {
      razorpay_order_id: otherOrder,
      razorpay_payment_id: otherPayment,
      razorpay_signature: selfConsistent,
    },
  });
  check(swapped.statusCode === 400 && swapped.body?.code === "SIGNATURE_INVALID",
    "a signature valid for another pair is refused too", { got: swapped.statusCode, code: swapped.body?.code });
  check((await paid()) === 0, "and settles nothing either", { paid: await paid() });

  const noSig = await call(rzp.verifyRazorpayPayment, { ...asBuyer, body: {} });
  check(noSig.statusCode === 400, "an empty payload is refused", { got: noSig.statusCode });

  // ---------------------------------------------------------------
  console.log("\n-- the stub gateway, and a genuine payment --");

  const failed = await call(rzp.simulateRazorpayPayment, { ...asBuyer, body: { outcome: "failure" } });
  check(failed.body?.outcome === "failure" && !failed.body?.razorpay_signature,
    "a declined payment returns no signature", { outcome: failed.body?.outcome });
  check((await paid()) === 0, "so nothing is recorded for it", { paid: await paid() });

  const intruderSim = await call(rzp.simulateRazorpayPayment, { ...asIntruder, body: {} });
  check(intruderSim.statusCode === 403, "another buyer cannot drive the gateway", { got: intruderSim.statusCode });

  const sim = await call(rzp.simulateRazorpayPayment, { ...asBuyer, body: {} });
  check(sim.body?.outcome === "success" && !!sim.body?.razorpay_signature,
    "a successful stub payment is signed", { id: sim.body?.razorpay_payment_id });
  check(sim.body?.razorpay_order_id === gatewayOrderId,
    "against the order the server opened", { got: sim.body?.razorpay_order_id });

  const verified = await call(rzp.verifyRazorpayPayment, {
    ...asBuyer,
    body: {
      razorpay_payment_id: sim.body.razorpay_payment_id,
      razorpay_signature: sim.body.razorpay_signature,
    },
  });
  check(verified.statusCode === 200, "a genuine payment verifies", { got: verified.statusCode, msg: verified.body?.message });
  check((await paid()) === orderTotal, "and settles the whole order", { paid: await paid(), owed: orderTotal });

  const orderRow = (await q("SELECT status, payment_status, remaining_amount FROM orders WHERE id=$1", [orderId])).rows[0];
  check(money(orderRow.remaining_amount) === 0, "nothing remains owing", { left: orderRow.remaining_amount });
  check(String(orderRow.payment_status).toLowerCase().includes("paid"),
    "the order reads paid", { status: orderRow.payment_status });

  const stored = (await q(
    `SELECT payment_method, payment_status, transaction_id, gateway_response
       FROM payment_transactions WHERE order_id=$1 AND payment_status='completed'
       ORDER BY updated_at DESC LIMIT 1`, [orderId])).rows[0];
  check(!!stored, "the transaction row is settled", { method: stored?.payment_method });
  check(stored?.gateway_response?.razorpayPaymentId === sim.body.razorpay_payment_id,
    "and carries the gateway's payment id for looking up later",
    { kept: stored?.gateway_response?.razorpayPaymentId });

  // ---------------------------------------------------------------
  console.log("\n-- the same payment cannot be used twice --");

  const replay = await call(rzp.verifyRazorpayPayment, {
    ...asBuyer,
    body: {
      razorpay_payment_id: sim.body.razorpay_payment_id,
      razorpay_signature: sim.body.razorpay_signature,
    },
  });
  check(replay.statusCode !== 200, "replaying the handler payload is refused", { got: replay.statusCode, code: replay.body?.code });
  check((await paid()) === orderTotal, "and the order is not paid twice", { paid: await paid(), owed: orderTotal });

  console.log(fails ? `\n${fails} FAILED\n` : "\nall good\n");
  await testPool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("THREW", e); process.exit(1); });

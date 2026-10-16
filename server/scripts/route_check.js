/**
 * Razorpay Route: the buyer's money reaching the wholesaler it belongs to.
 *
 * Every rupee taken through Razorpay used to land in ONE account, because the
 * service reads a single key pair from the environment. Route splits it to a
 * linked account per wholesaler.
 *
 * The dangerous state is the middle one. A linked account EXISTS from the
 * moment it is created, long before Razorpay will settle to it, and transfers
 * to an unactivated account are held. So the thing most worth testing is that
 * a wholesaler who is merely `created` cannot be paid: taking that payment
 * would leave a buyer's money in the platform's account and a wholesaler
 * shipping goods against it.
 *
 * Razorpay itself is stubbed at the transport, the same way razorpay_live_check
 * does it. Nothing here proves their API behaves as documented, only that we
 * call it correctly and act on the answer correctly.
 *
 *     node scripts/route_check.js <database>
 */
const Module = require("module");
const http = require("http");
const crypto = require("crypto");
const { Pool } = require("pg");

process.env.RAZORPAY_KEY_ID = "rzp_test_fakekeyid";
process.env.RAZORPAY_KEY_SECRET = "fakesecret123";
process.env.RAZORPAY_WEBHOOK_SECRET = "whsec_fake";

const DB = process.argv[2] || "rt1";
const dbPath = require.resolve("../src/config/db");
const testPool = new Pool({ connectionString: `postgres://postgres@127.0.0.1:5433/${DB}` });
const stub = new Module(dbPath, null);
stub.exports = testPool;
stub.loaded = true;
require.cache[dbPath] = stub;

let fails = 0;
const check = (cond, label, detail) => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"} ${String(label).padEnd(58)} ${JSON.stringify(detail ?? {})}`);
};
const uniq = () => String(Date.now()) + Math.floor(Math.random() * 1000);

const mk = () => {
  const r = { statusCode: 200, body: null, headers: {} };
  r.status = (c) => ((r.statusCode = c), r);
  r.json = (b) => ((r.body = b), r);
  return r;
};
const call = async (fn, req) => { const r = mk(); await fn(req, r); return r; };

// A stand-in for api.razorpay.com. Records what we sent so the body can be
// asserted, which is the only part of a live call that is ours to get right.
const seen = [];
let accountStatus = "created";

(async () => {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null,
                  auth: req.headers.authorization });
      res.setHeader("Content-Type", "application/json");

      if (req.url === "/v1/orders") {
        return res.end(JSON.stringify({
          id: `order_${uniq()}`, amount: JSON.parse(body).amount,
          currency: "INR", status: "created",
        }));
      }
      if (/^\/v2\/accounts$/.test(req.url)) {
        return res.end(JSON.stringify({ id: `acc_${uniq()}`, status: "created" }));
      }
      if (/stakeholders$/.test(req.url)) {
        return res.end(JSON.stringify({ id: `sth_${uniq()}` }));
      }
      if (/\/products$/.test(req.url)) {
        return res.end(JSON.stringify({ id: `acc_prd_${uniq()}`, product_name: "route" }));
      }
      if (/\/products\//.test(req.url)) {
        return res.end(JSON.stringify({ id: "acc_prd_x", activation_status: "pending" }));
      }
      if (/^\/v2\/accounts\/acc_/.test(req.url)) {
        return res.end(JSON.stringify({ id: req.url.split("/").pop(), status: accountStatus }));
      }
      res.end("{}");
    });
  });
  await new Promise((r) => server.listen(0, r));
  process.env.RAZORPAY_API_BASE = `http://127.0.0.1:${server.address().port}`;

  const razorpay = require("../src/services/razorpayService");
  const route = require("../src/controllers/routeController");
  const rzpOrders = require("../src/controllers/razorpayController");
  const webhook = require("../src/controllers/razorpayWebhookController");

  console.log(`\n=== Razorpay Route, against ${DB} ===\n`);

  // ---------------------------------------------------------------
  console.log("-- the split itself --");

  check(razorpay.transferAmount(100000, 0) === 100000,
    "with no commission the wholesaler gets all of it", { got: razorpay.transferAmount(100000, 0) });
  check(razorpay.transferAmount(100000, 2) === 98000,
    "two per cent leaves them 98,000 paise of a lakh", { got: razorpay.transferAmount(100000, 2) });
  check(razorpay.transferAmount(333, 1) === 329,
    "a stray paisa is kept by the platform, never invented for them",
    { got: razorpay.transferAmount(333, 1) });
  let threw = null;
  try { razorpay.transferAmount(1000, 100); } catch (e) { threw = e.message; }
  check(Boolean(threw), "a commission of the whole payment is refused", { msg: threw });

  await (async () => {
    let caught = null;
    try {
      await razorpay.createOrder({
        amountRupees: 100, receipt: "r",
        transfers: [{ account: "acc_1", amount: 20000, currency: "INR" }],
      });
    } catch (e) { caught = e.message; }
    check(Boolean(caught),
      "a transfer larger than the payment is refused before it is sent", { msg: caught });
  })();

  // ---------------------------------------------------------------
  console.log("\n-- the status map never invents permission --");

  check(razorpay.mapAccountStatus("activated") === "activated", "activated maps through");
  check(razorpay.mapAccountStatus("created") === "created", "created maps through");
  check(razorpay.mapAccountStatus("some_new_state_razorpay_invented") === "under_review",
    "an unknown state is under_review, NOT activated",
    { got: razorpay.mapAccountStatus("some_new_state_razorpay_invented") });
  check(razorpay.mapAccountStatus(undefined) === "under_review",
    "and so is no state at all", { got: razorpay.mapAccountStatus(undefined) });

  // ---------------------------------------------------------------
  console.log("\n-- onboarding --");

  const sellerId = (await testPool.query(
    `INSERT INTO users (first_name,last_name,email,phone,password_hash,role)
     VALUES ('Ram','T',$1,$2,'x','seller') RETURNING id`,
    [`ram${uniq()}@rt.local`, `9${uniq().slice(-9)}`])).rows[0].id;
  await testPool.query(
    `INSERT INTO wholesaler_profiles (user_id, company_name, warehouse_state, city)
     VALUES ($1,'Ram Textiles','Gujarat','Surat')`, [sellerId]);
  const asSeller = {
    user: { id: sellerId, role: "seller" },
    business: { id: sellerId, isOwner: true, staffId: null, name: null, permissions: [] },
  };

  const before = await call(route.getRouteStatus, { ...asSeller, body: {} });
  check(before.body?.status === "not_started" && before.body?.canBePaid === false,
    "a wholesaler starts not set up and cannot be paid", before.body?.status);

  const badPan = await call(route.startOnboarding, {
    ...asSeller,
    body: { legalBusinessName: "Ram Textiles", businessType: "proprietorship",
            pan: "NOTAPAN", contactName: "Ram", email: "ram@x.com", phone: "9900011122",
            accountNumber: "50100123", ifsc: "HDFC0001234",
            city: "Surat", state: "Gujarat", pincode: "395004" },
  });
  check(badPan.statusCode === 400, "a malformed PAN is refused before Razorpay is called",
    { got: badPan.statusCode });

  const noAddress = await call(route.startOnboarding, {
    ...asSeller,
    body: { legalBusinessName: "Ram Textiles", businessType: "proprietorship",
            pan: "AAAPZ1234C", contactName: "Ram", email: "ram@x.com", phone: "9900011122",
            accountNumber: "50100123", ifsc: "HDFC0001234" },
  });
  check(noAddress.statusCode === 400, "and so is a missing registered address",
    { got: noAddress.statusCode });

  const onboarded = await call(route.startOnboarding, {
    ...asSeller,
    body: { legalBusinessName: "Ram Textiles", businessType: "proprietorship",
            pan: "AAAPZ1234C", gstin: "24AAACC1206D1ZM", contactName: "Ram Thakkar",
            email: "ram@x.com", phone: "9900011122",
            accountNumber: "50100123456789", ifsc: "HDFC0001234",
            address: "Plot 8", city: "Surat", state: "Gujarat", pincode: "395004" },
  });
  check(onboarded.statusCode === 200 && String(onboarded.body?.accountId).startsWith("acc_"),
    "onboarding creates a linked account", { got: onboarded.body?.accountId, code: onboarded.statusCode,
      msg: onboarded.body?.message });
  check(onboarded.body?.canBePaid === false,
    "and they STILL cannot be paid, because Razorpay has not activated them",
    { status: onboarded.body?.status });

  const created = seen.find((s) => s.url === "/v2/accounts");
  check(created?.body?.reference_id === String(sellerId),
    "the linked account carries our own id, so it can always be traced back",
    { got: created?.body?.reference_id });
  check(created?.body?.type === "route", "and is asked for as a route account",
    { got: created?.body?.type });
  check(String(created?.auth || "").startsWith("Basic "),
    "sent with basic auth, not the key in the body", { got: String(created?.auth).slice(0, 6) });
  const settle = seen.find((s) => s.method === "PATCH");
  check(settle?.body?.settlements?.account_number === "50100123456789",
    "and their own bank account is what Razorpay settles to",
    { got: settle?.body?.settlements?.account_number });

  // ---------------------------------------------------------------
  console.log("\n-- THE GATE --");

  const buyerId = (await testPool.query(
    `INSERT INTO users (first_name,last_name,email,phone,password_hash,role)
     VALUES ('Kishan','B',$1,$2,'x','buyer') RETURNING id`,
    [`kishan${uniq()}@rt.local`, `8${uniq().slice(-9)}`])).rows[0].id;

  // quantity is a NOT NULL leftover from the single-item era, alongside
  // inventory_item_id. order_items is the real content; this is here because
  // the column still refuses a NULL.
  const orderId = (await testPool.query(
    `INSERT INTO orders (buyer_id, supplier_id, total_amount, subtotal, quantity,
                         status, payment_status, order_number)
     VALUES ($1,$2,5000,5000,1,'pending','pending',$3) RETURNING id`,
    [buyerId, sellerId, `ORD${uniq()}`])).rows[0].id;
  // payment_method is NOT NULL, and a BEFORE INSERT trigger copies it into
  // payment_type. That is exactly why the session query discriminates on
  // buyer_id rather than payment_type.
  await testPool.query(
    `INSERT INTO payment_transactions
       (order_id, buyer_id, amount, payment_method, payment_status, installment_number)
     VALUES ($1,$2,5000,'upi','pending',1)`, [orderId, buyerId]);

  /**
   * The rule is narrow on purpose: never attach a transfer to an account that
   * cannot receive it. The payment itself still goes through exactly as it
   * did before Route, into the platform's account, to be reconciled by a
   * person. Blocking checkout instead would break every existing seller the
   * moment the migration is run, which is not what a migration may do here.
   */
  const beforeActivation = await call(rzpOrders.createRazorpayOrder, {
    params: { orderId }, user: { id: buyerId }, body: {},
  });
  check(beforeActivation.statusCode === 200,
    "a payment still works while they are only created, as it did before Route",
    { got: beforeActivation.statusCode });
  const noTransferYet = seen.filter((s) => s.url === "/v1/orders").pop();
  check(noTransferYet?.body?.transfers === undefined,
    "but NO transfer is attached, so nothing is held by Razorpay",
    { transfers: noTransferYet?.body?.transfers });

  // Razorpay activates them.
  accountStatus = "activated";
  const after = await call(route.getRouteStatus, { ...asSeller, body: {} });
  check(after.body?.status === "activated" && after.body?.canBePaid === true,
    "once Razorpay activates them the status follows", { got: after.body?.status });

  const allowed = await call(rzpOrders.createRazorpayOrder, {
    params: { orderId }, user: { id: buyerId }, body: {},
  });
  check(allowed.statusCode === 200 && allowed.body?.success,
    "and the payment is allowed", { got: allowed.statusCode, msg: allowed.body?.message });

  const sentOrder = seen.filter((s) => s.url === "/v1/orders").pop();
  check(Array.isArray(sentOrder?.body?.transfers) && sentOrder.body.transfers.length === 1,
    "the gateway order carries exactly one transfer", {
      transfers: sentOrder?.body?.transfers?.length });
  check(sentOrder?.body?.transfers?.[0]?.account === onboarded.body.accountId,
    "addressed to THEIR linked account", { got: sentOrder?.body?.transfers?.[0]?.account });
  check(sentOrder?.body?.transfers?.[0]?.amount === 500000,
    "for the whole 5,000 rupees, since no commission is set",
    { got: sentOrder?.body?.transfers?.[0]?.amount });

  // ---------------------------------------------------------------
  console.log("\n-- the webhook --");

  const post = async (payload, { signature, raw } = {}) => {
    const body = raw || Buffer.from(JSON.stringify(payload));
    const sig = signature !== undefined
      ? signature
      : crypto.createHmac("sha256", "whsec_fake").update(body).digest("hex");
    const req = {
      body,
      get: (h) => (h === "X-Razorpay-Signature" ? sig
        : h === "X-Razorpay-Event-Id" ? payload?.__id || `evt_${uniq()}` : undefined),
    };
    return call(webhook.handleWebhook, req);
  };

  const forged = await post({ event: "payment.captured" }, { signature: "deadbeef" });
  check(forged.statusCode === 400,
    "an unsigned or wrongly signed delivery is refused", { got: forged.statusCode });

  const accEvent = {
    __id: `evt_acc_${uniq()}`,
    event: "account.activated",
    payload: { account: { entity: { id: onboarded.body.accountId, status: "activated" } } },
  };
  const ok = await post(accEvent);
  check(ok.statusCode === 200, "a properly signed one is accepted", { got: ok.statusCode });

  const repeat = await post(accEvent);
  check(repeat.body?.duplicate === true,
    "and the same delivery twice is recognised, not applied twice",
    { got: repeat.body });

  const transferEvent = {
    __id: `evt_tr_${uniq()}`,
    event: "transfer.processed",
    payload: { transfer: { entity: {
      id: `trf_${uniq()}`, recipient: onboarded.body.accountId, source: "pay_123",
      amount: 500000, fees: 1180, tax: 180, status: "processed",
      notes: { orderId },
    } } },
  };
  await post(transferEvent);
  const transfers = await call(route.listTransfers, { ...asSeller, body: {} });
  check(transfers.body?.length === 1 && Number(transfers.body[0].amount_paise) === 500000,
    "a transfer Razorpay reports reaches their own list",
    { got: transfers.body?.length, amount: transfers.body?.[0]?.amount_paise });
  check(transfers.body?.[0]?.order_number,
    "tied back to the order it came from", { got: transfers.body?.[0]?.order_number });

  server.close();
  await testPool.end();
  console.log(fails ? `\n${fails} FAILED\n` : "\nall good\n");
  process.exit(fails ? 1 : 0);
})().catch((err) => { console.error("THREW", err); process.exit(1); });

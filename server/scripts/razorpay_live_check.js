/**
 * The order call this makes once there are real keys.
 *
 * It has never been run against api.razorpay.com, which needs an account, so
 * the contract is what gets tested: the method, the URL, the Basic auth header,
 * the body, and what happens when Razorpay says no. A local server stands in
 * for theirs through RAZORPAY_API_BASE.
 *
 * Separate from razorpay_check.js because live mode is decided from the
 * environment at module load, and that suite has to run in stub mode. Two
 * modes, two processes.
 *
 *     node scripts/razorpay_live_check.js
 */
process.env.RAZORPAY_KEY_ID = "rzp_test_fakekeyid";
process.env.RAZORPAY_KEY_SECRET = "fakesecret123";

const http = require("http");

let fails = 0;
const check = (cond, label, detail) => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"} ${String(label).padEnd(58)} ${JSON.stringify(detail ?? "")}`);
};

const received = [];
let reply = { status: 200, body: {} };

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (d) => (raw += d));
  req.on("end", () => {
    received.push({
      method: req.method,
      url: req.url,
      auth: req.headers.authorization || "",
      contentType: req.headers["content-type"] || "",
      body: raw ? JSON.parse(raw) : null,
    });
    res.statusCode = reply.status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(reply.body));
  });
});

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.RAZORPAY_API_BASE = `http://127.0.0.1:${server.address().port}`;

  // Required AFTER the environment is set: the module reads it once.
  const razorpay = require("../src/services/razorpayService");

  console.log("\n=== the live order call, against a stand in for Razorpay ===\n");

  check(!razorpay.isStub(), "keys present, so not in stub mode", {});
  check(
    razorpay.publicConfig().keyId === "rzp_test_fakekeyid" &&
      razorpay.publicConfig().stub === false,
    "the public config carries the real key id and no secret",
    razorpay.publicConfig(),
  );
  check(
    !JSON.stringify(razorpay.publicConfig()).includes("fakesecret"),
    "and the secret is not in it",
    {},
  );

  // ---------------------------------------------------------------
  console.log("\n-- a successful order --");
  reply = {
    status: 200,
    body: { id: "order_RealAbc123", amount: 2100000, currency: "INR", status: "created" },
  };
  const order = await razorpay.createOrder({
    amountRupees: 21000,
    receipt: "ORD123-1",
    notes: { orderId: "abc" },
  });

  const sent = received[0];
  check(sent?.method === "POST", "POSTs", { method: sent?.method });
  check(sent?.url === "/v1/orders", "to /v1/orders", { url: sent?.url });
  check(
    sent?.auth === `Basic ${Buffer.from("rzp_test_fakekeyid:fakesecret123").toString("base64")}`,
    "with Basic auth over key id and secret",
    { auth: sent?.auth?.slice(0, 12) + "..." },
  );
  check(sent?.contentType.includes("application/json"), "as JSON", { ct: sent?.contentType });
  check(sent?.body?.amount === 2100000, "the amount in PAISE, not rupees", { amount: sent?.body?.amount });
  check(sent?.body?.currency === "INR", "in rupees as the currency", { cur: sent?.body?.currency });
  check(sent?.body?.receipt === "ORD123-1", "carrying the receipt", { r: sent?.body?.receipt });
  check(sent?.body?.notes?.orderId === "abc", "and the notes", { n: sent?.body?.notes });
  check(order?.id === "order_RealAbc123", "and Razorpay's order id comes back", { id: order?.id });
  check(order?.stub === false, "marked as not a stub", { stub: order?.stub });

  // ---------------------------------------------------------------
  console.log("\n-- Razorpay refuses --");
  reply = {
    status: 401,
    body: { error: { code: "BAD_REQUEST_ERROR", description: "Authentication failed" } },
  };
  let refused = null;
  try {
    await razorpay.createOrder({ amountRupees: 100, receipt: "x" });
  } catch (err) {
    refused = err;
  }
  check(refused !== null, "the call throws rather than returning a fake order", {});
  check(refused?.code === "RAZORPAY_REFUSED", "with a code the controller can map", { code: refused?.code });
  check(
    /Authentication failed/.test(refused?.message || ""),
    "and Razorpay's own words, so a wrong key says so",
    { message: refused?.message },
  );

  // ---------------------------------------------------------------
  console.log("\n-- a zero or negative amount never leaves --");
  const before = received.length;
  for (const bad of [0, -5, null, undefined, "abc"]) {
    let threw = false;
    try {
      await razorpay.createOrder({ amountRupees: bad, receipt: "x" });
    } catch {
      threw = true;
    }
    if (!threw) fails++;
  }
  check(received.length === before, "nothing was sent for any of them", {
    calls: received.length - before,
  });

  // ---------------------------------------------------------------
  console.log("\n-- signing is refused in live mode --");
  let signErr = null;
  try {
    razorpay.signStub("order_x", "pay_x");
  } catch (err) {
    signErr = err;
  }
  check(
    signErr !== null,
    "minting a signature is the gateway's job once keys exist",
    { message: signErr?.message },
  );

  // Verification still works, with the real secret rather than the stub one.
  const crypto = require("crypto");
  const good = crypto
    .createHmac("sha256", "fakesecret123")
    .update("order_A|pay_B")
    .digest("hex");
  check(
    razorpay.verifySignature({ orderId: "order_A", paymentId: "pay_B", signature: good }),
    "a signature made with the real secret verifies",
    {},
  );
  check(
    !razorpay.verifySignature({ orderId: "order_A", paymentId: "pay_B", signature: "f".repeat(64) }),
    "and a forged one does not",
    {},
  );

  server.close();
  console.log(fails ? `\n${fails} FAILED\n` : "\nall good\n");
  process.exit(fails ? 1 : 0);
})().catch((err) => {
  console.error("THREW", err);
  process.exit(1);
});

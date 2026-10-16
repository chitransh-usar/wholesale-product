const crypto = require("crypto");

/**
 * Razorpay, scaffolded.
 *
 * There is no payment gateway in this product. A buyer scans a UPI QR code and
 * presses a button to say they paid, and the server caps what they can claim at
 * what is owed. That is honest for a closed network where the two parties know
 * each other, and it is not going to be enough forever.
 *
 * This is the shape of the real thing with the network call left out, asked
 * for on 12 Sept as "absolutely no need to make it working, just setup fake".
 *
 * ---------------------------------------------------------------------------
 * THE ONE DECISION THAT MATTERS HERE
 * ---------------------------------------------------------------------------
 * The stub signs its fake payments with REAL HMAC-SHA256, using the same
 * string Razorpay signs and the same comparison Razorpay documents. It would
 * have been less code to have verifySignature() return true in stub mode.
 *
 * That shortcut is how a fake gateway becomes a live hole. Somebody sets
 * RAZORPAY_KEY_ID one afternoon, the stub flag is still on or the branch is
 * the wrong way round, and the verify endpoint accepts a payment id posted by
 * anybody with the order number. Money is the one place in this codebase where
 * the untested path must not be the one that says yes.
 *
 * So verification is the real algorithm in both modes, and it is the same
 * function. Going live changes the keys and the order-creation call, and
 * changes nothing about what is trusted.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS NOT BUILT, deliberately
 * ---------------------------------------------------------------------------
 * createOrder DOES call api.razorpay.com once there are keys, because
 * Razorpay's own checkout window will not open without an order id from that
 * endpoint. It has never been exercised against the real host from here, which
 * needs an account; it is written to the documented contract and covered by a
 * test that stubs the transport. The first live call is the real test.
 *
 * Webhooks are not built either. The handler flow below is the browser telling
 * the server it succeeded, which Razorpay itself treats as a hint: the payment
 * is authoritative only over the webhook, because a buyer whose browser dies
 * after paying never sends the handler. Before this goes live it needs
 * POST /api/webhooks/razorpay verifying X-Razorpay-Signature over the raw body.
 *
 * Settlement across wholesalers is not addressed. Every rupee here would land
 * in ONE Razorpay account, and this is a marketplace where the money belongs
 * to whichever wholesaler was bought from. That is Razorpay Route and linked
 * accounts, it needs each wholesaler onboarded and KYC'd, and it is the real
 * work behind "the UPI needs to be of each wholesaler we are buying from".
 */

const KEY_ID = process.env.RAZORPAY_KEY_ID || "";
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";

// Overridable so a test can point the order call at a local server rather
// than reaching the internet.
const API_BASE = process.env.RAZORPAY_API_BASE || "https://api.razorpay.com";

/**
 * Stub mode is the absence of a secret, not a flag somebody can leave set.
 *
 * Deliberately not a FEATURES-style boolean. A flag and a credential can
 * disagree, and the failure when they do is the expensive one. If there is a
 * secret we are not pretending; if there is not, we cannot be.
 */
const isStub = () => KEY_SECRET === "";

/**
 * What the stub signs with.
 *
 * Generated per process because there is no secret to use. That means a server
 * restart orphans any checkout already open in a browser: verification fails,
 * the buyer is told to start again, and nothing is recorded. For a stub that
 * is the right failure, and it is one more reason this cannot quietly become
 * production.
 */
const STUB_SECRET = crypto.randomBytes(32).toString("hex");
const secret = () => (isStub() ? STUB_SECRET : KEY_SECRET);

/** What the browser needs to open a checkout. Never the secret. */
const publicConfig = () => ({
  keyId: isStub() ? "rzp_test_stub0000000000" : KEY_ID,
  stub: isStub(),
});

/**
 * Razorpay works in paise, like the rest of this codebase.
 * See utils/money for why rupees are never summed as floats.
 */
const toPaise = (rupees) => Math.round(Number(rupees || 0) * 100);

/**
 * Opens a Razorpay order for an amount the SERVER decided.
 *
 * `amountRupees` comes from the order row, never from the browser, exactly as
 * initiatePayment already arranges: the client naming its own amount is how a
 * gateway integration turns into a discount coupon.
 */
const createOrder = async ({ amountRupees, receipt, notes = {}, transfers }) => {
  const amount = toPaise(amountRupees);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("A payment must be for more than zero.");
  }

  // A transfer can never exceed what is being captured. Razorpay enforces
  // this too and would refuse the order, but a caller's arithmetic slip is
  // better caught here where the numbers are, than as a gateway error a
  // buyer sees at checkout.
  if (Array.isArray(transfers)) {
    const total = transfers.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    if (total > amount) {
      throw new Error("The transfers come to more than the payment.");
    }
  }

  if (isStub()) {
    return {
      id: `order_stub${crypto.randomBytes(9).toString("hex")}`,
      amount,
      currency: "INR",
      receipt,
      notes,
      transfers,
      status: "created",
      stub: true,
    };
  }

  /**
   * The real call.
   *
   * Razorpay's own checkout window will not open without an order id minted by
   * this endpoint, so once there are keys this has to be real. It is a plain
   * Basic-auth POST and needs no SDK, which is why there is no dependency here.
   *
   * NOT EXERCISED AGAINST api.razorpay.com from this repository, because that
   * needs a real account. Written to the documented contract and covered by a
   * test that stubs fetch and asserts the method, the auth header, the URL and
   * the body. Treat the first live call as the real test.
   *
   * The amount sent is the one computed above from the order row. Razorpay
   * checks the amount its window displays against the order it holds, so a
   * browser cannot alter what is charged even if it alters what it asks for.
   */
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${API_BASE}/v1/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")}`,
      },
      body: JSON.stringify({
        amount,
        currency: "INR",
        receipt,
        notes,
        ...(Array.isArray(transfers) && transfers.length ? { transfers } : {}),
      }),
      signal: controller.signal,
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      // Razorpay puts the readable part under error.description. Surfaced
      // rather than swallowed: "could not start payment" tells a wholesaler
      // nothing, and this is the message that says which key is wrong.
      const err = new Error(
        body?.error?.description || `Razorpay refused the order (${response.status}).`,
      );
      err.code = "RAZORPAY_REFUSED";
      err.status = response.status;
      throw err;
    }

    if (!body?.id) {
      const err = new Error("Razorpay returned no order id.");
      err.code = "RAZORPAY_REFUSED";
      throw err;
    }

    return { ...body, stub: false };
  } catch (err) {
    if (err.name === "AbortError") {
      const timeout = new Error("Razorpay did not answer in time. Try again.");
      timeout.code = "RAZORPAY_TIMEOUT";
      throw timeout;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * The signature Razorpay returns to the browser on success.
 *
 * HMAC-SHA256 of "<order_id>|<payment_id>" keyed on the secret, which is what
 * Razorpay documents and what verifySignature below checks. Only reachable in
 * stub mode: in live mode this is Razorpay's to produce and knowing how to
 * make one here would defeat the point of checking it.
 */
const signStub = (orderId, paymentId) => {
  if (!isStub()) throw new Error("Signatures are the gateway's to issue.");
  return crypto
    .createHmac("sha256", secret())
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
};

/** A payment id shaped like Razorpay's, for the stub checkout. */
const stubPaymentId = () => `pay_stub${crypto.randomBytes(9).toString("hex")}`;

/**
 * Is this handler payload really from the gateway?
 *
 * The real algorithm in both modes. timingSafeEqual rather than === because
 * comparing a secret-derived value byte by byte with an early exit leaks its
 * length and, given enough attempts, its content. It throws on a length
 * mismatch, so that is checked first and a wrong length is simply a wrong
 * signature.
 */
const verifySignature = ({ orderId, paymentId, signature }) => {
  if (!orderId || !paymentId || !signature) return false;

  const expected = crypto
    .createHmac("sha256", secret())
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  const given = String(signature);
  if (given.length !== expected.length) return false;

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given));
  } catch {
    return false;
  }
};

/**
 * ---------------------------------------------------------------------------
 * ROUTE: the money reaching the wholesaler it belongs to
 * ---------------------------------------------------------------------------
 * Everything above takes money INTO one account. Everything below splits it
 * out to the wholesaler who was actually bought from, through Razorpay Route.
 *
 * A linked account is created by the platform on their behalf, Razorpay does
 * the KYC, and only once it says `activated` may a transfer be attached to a
 * payment. The gap between "created" and "activated" is the dangerous one:
 * transfers to an unactivated account are held, so a payment taken then is a
 * buyer's money sitting in the platform's account with no way out.
 *
 * NOT EXERCISED AGAINST api.razorpay.com, for the same reason createOrder is
 * not: it needs a real account with Route enabled. Written to the documented
 * contract, covered by tests that stub the transport and assert the method,
 * the auth, the URL and the body. Treat the first live call as the real test.
 */

/** One place for the Basic-auth JSON calls, so the auth and the error shape
 *  are written once rather than five times. */
const apiCall = async (method, path, body) => {
  if (isStub()) {
    const err = new Error("Razorpay is not configured on this server.");
    err.code = "RAZORPAY_NOT_CONFIGURED";
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const parsed = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(
        parsed?.error?.description ||
          `Razorpay refused that request (${response.status}).`,
      );
      err.code = "RAZORPAY_REFUSED";
      err.status = response.status;
      // Kept, because Razorpay names the offending field here and a
      // wholesaler retyping their PAN needs to be told which one it is.
      err.field = parsed?.error?.field || null;
      throw err;
    }
    return parsed;
  } catch (err) {
    if (err.name === "AbortError") {
      const timeout = new Error("Razorpay did not answer in time. Try again.");
      timeout.code = "RAZORPAY_TIMEOUT";
      throw timeout;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Creates the wholesaler's linked account.
 *
 * `reference_id` is our own user id, so a row here can always be tied back to
 * a wholesaler even if the local record is lost. Razorpay requires it unique
 * per account, which our ids already are.
 */
const createLinkedAccount = ({
  email,
  phone,
  legalBusinessName,
  businessType,
  referenceId,
  gstin,
  pan,
  address = {},
}) =>
  apiCall("POST", "/v2/accounts", {
    email,
    phone,
    type: "route",
    reference_id: referenceId,
    legal_business_name: legalBusinessName,
    business_type: businessType,
    profile: {
      category: "ecommerce",
      subcategory: "wholesale",
      addresses: {
        registered: {
          street1: address.street1 || "",
          street2: address.street2 || "",
          city: address.city || "",
          state: address.state || "",
          postal_code: String(address.postalCode || ""),
          country: "IN",
        },
      },
    },
    legal_info: {
      // Razorpay wants these absent rather than empty when unknown.
      ...(pan ? { pan } : {}),
      ...(gstin ? { gst: gstin } : {}),
    },
  });

/** The human behind the business. Razorpay will not activate without one. */
const createStakeholder = (accountId, { name, email, pan, phone }) =>
  apiCall("POST", `/v2/accounts/${accountId}/stakeholders`, {
    name,
    email,
    ...(pan ? { kyc: { pan } } : {}),
    ...(phone ? { phone: { primary: phone } } : {}),
  });

/**
 * Asks for the route product and gives Razorpay the bank account to settle
 * into. Two calls because that is the documented shape: the first creates the
 * configuration and returns its id, the second fills it in.
 */
const requestRouteProduct = (accountId) =>
  apiCall("POST", `/v2/accounts/${accountId}/products`, {
    product_name: "route",
    tnc_accepted: true,
  });

const setSettlementAccount = (accountId, productId, { beneficiaryName, accountNumber, ifsc }) =>
  apiCall("PATCH", `/v2/accounts/${accountId}/products/${productId}`, {
    settlements: {
      account_number: accountNumber,
      ifsc_code: ifsc,
      beneficiary_name: beneficiaryName,
    },
    tnc_accepted: true,
  });

/** What Razorpay currently thinks of them. The source of truth for the gate. */
const fetchLinkedAccount = (accountId) =>
  apiCall("GET", `/v2/accounts/${accountId}`);

/**
 * Razorpay's account states, mapped to ours.
 *
 * Anything unrecognised becomes 'under_review' rather than 'activated'. A new
 * state name appearing in their API must never be read as permission to move
 * money.
 */
const mapAccountStatus = (status) => {
  switch (String(status || "").toLowerCase()) {
    case "activated":
      return "activated";
    case "created":
    case "pending":
      return "created";
    case "needs_clarification":
      return "needs_clarification";
    case "suspended":
    case "rejected":
      return "suspended";
    default:
      return "under_review";
  }
};

/**
 * Verifies a webhook against the webhook secret.
 *
 * A DIFFERENT SECRET from the API key: Razorpay signs webhooks with the one
 * set on the webhook itself. Signed over the RAW BODY, so the route must not
 * have been through a JSON parser first, because re-serialising an object
 * changes bytes (key order, spacing, unicode escapes) and the signature is
 * over bytes.
 *
 * Returns false rather than throwing when no secret is set. An unverifiable
 * webhook is not a trusted one, and the endpoint must not be open when the
 * server is half configured.
 */
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "";

const verifyWebhook = (rawBody, signature) => {
  if (!WEBHOOK_SECRET || !signature || !rawBody) return false;

  const expected = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  const given = String(signature);
  if (given.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given));
  } catch {
    return false;
  }
};

const webhookConfigured = () => WEBHOOK_SECRET !== "";

/**
 * What the platform keeps, in paise.
 *
 * Deliberately defaults to nothing. A commission is a commercial decision
 * somebody has to make, and inventing a plausible five per cent here would be
 * money taken from a wholesaler that nobody agreed to.
 */
const transferAmount = (totalPaise, commissionPercent = 0) => {
  const pct = Number(commissionPercent) || 0;
  if (pct <= 0) return totalPaise;
  if (pct >= 100) throw new Error("A commission cannot be the whole payment.");
  // Rounded DOWN, so the platform's share absorbs the stray paisa and the
  // transfer can never exceed what was captured.
  return Math.floor(totalPaise * (1 - pct / 100));
};

module.exports = {
  isStub,
  publicConfig,
  createOrder,
  signStub,
  stubPaymentId,
  verifySignature,
  toPaise,
  // Route
  apiCall,
  createLinkedAccount,
  createStakeholder,
  requestRouteProduct,
  setSettlementAccount,
  fetchLinkedAccount,
  mapAccountStatus,
  verifyWebhook,
  webhookConfigured,
  transferAmount,
};

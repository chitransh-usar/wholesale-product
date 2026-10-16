const express = require("express");
const { handleWebhook } = require("../controllers/razorpayWebhookController");

const router = express.Router();

/**
 * NO AUTHENTICATION, and that is correct: Razorpay cannot hold a token. The
 * signature over the raw body IS the authentication, and it is checked before
 * anything in the payload is believed.
 *
 * express.raw, not express.json, and mounted in app.js BEFORE the global JSON
 * parser. The signature is an HMAC over the exact bytes Razorpay sent, and a
 * parsed-then-reserialised object is different bytes: key order, spacing and
 * unicode escaping all move. Parsing first would make every real webhook look
 * forged.
 *
 * The limit is deliberate. This endpoint is unauthenticated by necessity, so
 * it must not be a way to make the server allocate as much memory as somebody
 * feels like sending.
 */
router.post(
  "/razorpay",
  express.raw({ type: "application/json", limit: "1mb" }),
  handleWebhook,
);

module.exports = router;

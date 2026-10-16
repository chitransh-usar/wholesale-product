const pool = require("../config/db");
const razorpay = require("../services/razorpayService");
const orderController = require("./orderController");
const invoiceRepository = require("../repositories/invoiceRepository");
const masterService = require("../services/masterService");

/**
 * Where this wholesaler's share of a payment should go, if anywhere.
 *
 * Returns an account id ONLY when Razorpay has activated them. Every other
 * case returns none, and the payment is taken exactly as it was before Route
 * existed: no transfer, money into the platform's account, reconciled by a
 * person. That covers the migration not having been run, a wholesaler who
 * never onboarded, and one Razorpay has not cleared yet.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT REFUSE THE PAYMENT INSTEAD
 * ---------------------------------------------------------------------------
 * The first cut of this blocked checkout for anybody not activated, on the
 * reasoning that money the platform cannot forward should not be taken. That
 * was wrong twice over. It broke every existing seller the moment the
 * migration was run, which is not what running a migration is allowed to do
 * here. And it was solving a problem that only arises if a transfer is
 * attached anyway: the danger is a transfer to an UNACTIVATED account, which
 * Razorpay holds with nobody able to release it. Simply not attaching one
 * leaves the payment exactly as good as it was yesterday.
 *
 * So the rule is narrow: never attach a transfer to an account that cannot
 * receive it.
 */
const routeTarget = async (supplierId) => {
  const none = { accountId: null, commissionPercent: 0 };

  const has = await invoiceRepository.schemaExtras();
  if (!has.has_razorpay_route) return none;

  const found = await pool.query(
    `SELECT razorpay_account_id, razorpay_kyc_status
       FROM wholesaler_profiles WHERE user_id = $1`,
    [supplierId],
  );
  const row = found.rows[0];
  if (!row?.razorpay_account_id || row.razorpay_kyc_status !== "activated") {
    return none;
  }

  let commissionPercent = 0;
  try {
    const settings = await masterService.settings();
    commissionPercent = Number(settings?.platform_commission_percent) || 0;
  } catch {
    // No settings row, or the migration is not in. Nothing is the right
    // default: a commission is a commercial decision, and inventing one takes
    // money from a wholesaler nobody agreed to take.
    commissionPercent = 0;
  }

  return { accountId: row.razorpay_account_id, commissionPercent };
};

/**
 * The three endpoints a Razorpay checkout needs.
 *
 *   POST /api/orders/:orderId/razorpay/order    open a gateway order
 *   POST /api/orders/:orderId/razorpay/simulate stub only: act as the gateway
 *   POST /api/orders/:orderId/razorpay/verify   check the handler payload
 *
 * See services/razorpayService.js for what is and is not built. The short
 * version is that verification is real in both modes and order creation is a
 * stub, so nothing here can be mistaken for a working gateway.
 *
 * NOTHING HERE SETTLES MONEY ITSELF. Once a signature checks out, this hands
 * over to orderController.updatePaymentStatus, which is the one place that
 * knows how much is actually owed, caps a payment at it, mirrors it into the
 * customer's khata, reconciles the invoice and moves the order's status. A
 * second settlement path would be a second set of those rules, and this
 * codebase has been bitten by exactly that more than once.
 */

/**
 * Opens a gateway order for the pending payment session.
 *
 * The amount is READ FROM THE SESSION that initiatePayment already wrote, and
 * never taken from the request body. That is the existing rule in this file
 * and it is the whole reason the browser cannot name a figure.
 */
const createRazorpayOrder = async (req, res) => {
  const { orderId } = req.params;
  const userId = req.user.id;

  try {
    const session = await pool.query(
      `SELECT pt.id, pt.amount, pt.installment_number, o.order_number,
              o.buyer_id, o.supplier_id
         FROM payment_transactions pt
         JOIN orders o ON o.id = pt.order_id
        WHERE pt.order_id = $1 AND pt.payment_status = 'pending'
          -- Only a session opened by initiatePayment, which is the only
          -- writer that fills buyer_id. Order creation ALSO leaves a pending
          -- row behind, for the whole subtotal, and opening a gateway order
          -- against that one would ask a buyer on the 50/50 plan for the full
          -- amount instead of their first half.
          --
          -- Not discriminated on payment_type, which looks like the obvious
          -- choice and is not: a legacy BEFORE INSERT trigger on this table
          -- copies payment_method into payment_type, so the placeholder row
          -- comes out with a type nobody set.
          AND pt.buyer_id IS NOT NULL
        ORDER BY pt.created_at DESC
        LIMIT 1`,
      [orderId],
    );

    if (session.rows.length === 0) {
      return res.status(409).json({
        success: false,
        code: "NO_PAYMENT_SESSION",
        message: "Start the payment first, so the amount is set by the server.",
      });
    }

    const row = session.rows[0];
    if (String(row.buyer_id) !== String(userId)) {
      return res.status(403).json({ success: false, message: "This order belongs to someone else." });
    }

    // Who gets the money, if the gateway can send it to them at all. See
    // routeTarget: no account means no transfer, and the payment is taken
    // exactly as it was before Route.
    const route = await routeTarget(row.supplier_id);
    const amountPaise = razorpay.toPaise(row.amount);
    const gatewayOrder = await razorpay.createOrder({
      amountRupees: row.amount,
      receipt: `${row.order_number || orderId}-${row.installment_number || 1}`,
      notes: { orderId, sessionId: String(row.id) },
      transfers: route.accountId
        ? [
            {
              account: route.accountId,
              amount: razorpay.transferAmount(amountPaise, route.commissionPercent),
              currency: "INR",
              notes: { orderId, orderNumber: row.order_number || "" },
              // Settled to them on Razorpay's ordinary schedule. Holding it
              // would need somebody to release it, and there is no screen
              // that does and no rule saying when.
              on_hold: false,
            },
          ]
        : undefined,
    });

    await pool.query(
      `UPDATE payment_transactions
          SET transaction_id = $2,
              gateway_response = COALESCE(gateway_response, '{}'::jsonb) || $3::jsonb,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [row.id, gatewayOrder.id, JSON.stringify({ razorpayOrder: gatewayOrder })],
    );

    return res.json({
      success: true,
      ...razorpay.publicConfig(),
      orderId: gatewayOrder.id,
      amount: gatewayOrder.amount,
      currency: gatewayOrder.currency,
      sessionId: row.id,
    });
  } catch (err) {
    // Razorpay's own words, passed through. A wrong key or a disabled account
    // says so here, and "could not open a payment" would hide the one sentence
    // that says which.
    if (err.code === "RAZORPAY_REFUSED" || err.code === "RAZORPAY_TIMEOUT") {
      return res.status(502).json({ success: false, code: err.code, message: err.message });
    }
    console.error("createRazorpayOrder error:", err);
    return res.status(500).json({ success: false, message: "Could not open a payment." });
  }
};

/**
 * Stands in for the gateway, so the stub checkout has something to return.
 *
 * REFUSED OUTRIGHT the moment a real secret exists. This mints a valid
 * signature, which is precisely the thing the verify endpoint is there to
 * demand, so it must be impossible to reach on a deployment taking real money.
 * Guarded on the same isStub() as the signing itself rather than on a separate
 * flag, because a flag and a credential can disagree.
 */
const simulateRazorpayPayment = async (req, res) => {
  if (!razorpay.isStub()) {
    return res.status(404).json({ success: false, message: "Not found." });
  }

  const { orderId } = req.params;
  const userId = req.user.id;
  const { outcome = "success" } = req.body || {};

  try {
    const session = await pool.query(
      `SELECT pt.id, pt.transaction_id, o.buyer_id
         FROM payment_transactions pt
         JOIN orders o ON o.id = pt.order_id
        WHERE pt.order_id = $1 AND pt.payment_status = 'pending'
          -- Only a session opened by initiatePayment, which is the only
          -- writer that fills buyer_id. Order creation ALSO leaves a pending
          -- row behind, for the whole subtotal, and opening a gateway order
          -- against that one would ask a buyer on the 50/50 plan for the full
          -- amount instead of their first half.
          --
          -- Not discriminated on payment_type, which looks like the obvious
          -- choice and is not: a legacy BEFORE INSERT trigger on this table
          -- copies payment_method into payment_type, so the placeholder row
          -- comes out with a type nobody set.
          AND pt.buyer_id IS NOT NULL
        ORDER BY pt.created_at DESC
        LIMIT 1`,
      [orderId],
    );
    if (session.rows.length === 0) {
      return res.status(409).json({ success: false, message: "No payment is open." });
    }
    const row = session.rows[0];
    if (String(row.buyer_id) !== String(userId)) {
      return res.status(403).json({ success: false, message: "This order belongs to someone else." });
    }
    if (!row.transaction_id) {
      return res.status(409).json({ success: false, message: "Open a gateway order first." });
    }

    // A card that the bank declines is the commoner outcome in practice, and a
    // checkout that can only succeed is not worth testing against.
    if (outcome === "failure") {
      return res.json({
        success: true,
        outcome: "failure",
        error: { code: "BAD_REQUEST_ERROR", description: "Payment failed. Please try another method." },
      });
    }

    const paymentId = razorpay.stubPaymentId();
    return res.json({
      success: true,
      outcome: "success",
      razorpay_order_id: row.transaction_id,
      razorpay_payment_id: paymentId,
      razorpay_signature: razorpay.signStub(row.transaction_id, paymentId),
    });
  } catch (err) {
    console.error("simulateRazorpayPayment error:", err);
    return res.status(500).json({ success: false, message: "Could not simulate that payment." });
  }
};

/**
 * Checks the handler payload and, if it is genuine, settles the payment.
 *
 * The signature is checked against the order id THIS SERVER stored on the
 * session, not against the one in the request body. Trusting the posted order
 * id would let somebody sign a pair of their own choosing and have it verify
 * against itself, which is a correct HMAC of the wrong thing.
 */
const verifyRazorpayPayment = async (req, res) => {
  const { orderId } = req.params;
  const userId = req.user.id;
  const { razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body || {};

  try {
    const session = await pool.query(
      `SELECT pt.id, pt.transaction_id, o.buyer_id
         FROM payment_transactions pt
         JOIN orders o ON o.id = pt.order_id
        WHERE pt.order_id = $1 AND pt.payment_status = 'pending'
          -- Only a session opened by initiatePayment, which is the only
          -- writer that fills buyer_id. Order creation ALSO leaves a pending
          -- row behind, for the whole subtotal, and opening a gateway order
          -- against that one would ask a buyer on the 50/50 plan for the full
          -- amount instead of their first half.
          --
          -- Not discriminated on payment_type, which looks like the obvious
          -- choice and is not: a legacy BEFORE INSERT trigger on this table
          -- copies payment_method into payment_type, so the placeholder row
          -- comes out with a type nobody set.
          AND pt.buyer_id IS NOT NULL
        ORDER BY pt.created_at DESC
        LIMIT 1`,
      [orderId],
    );
    if (session.rows.length === 0) {
      return res.status(409).json({
        success: false,
        code: "NO_PAYMENT_SESSION",
        message: "That payment is no longer open. Start it again.",
      });
    }
    const row = session.rows[0];
    if (String(row.buyer_id) !== String(userId)) {
      return res.status(403).json({ success: false, message: "This order belongs to someone else." });
    }

    const ok = razorpay.verifySignature({
      orderId: row.transaction_id,
      paymentId,
      signature,
    });

    if (!ok) {
      // Recorded rather than only refused. A failed signature is either a bug
      // or somebody trying it on, and both are worth being able to look up.
      await pool.query(
        `UPDATE payment_transactions
            SET gateway_response = COALESCE(gateway_response, '{}'::jsonb) || $2::jsonb,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [row.id, JSON.stringify({ verificationFailedAt: new Date().toISOString() })],
      );
      return res.status(400).json({
        success: false,
        code: "SIGNATURE_INVALID",
        message: "That payment could not be verified. Nothing has been recorded.",
      });
    }

    await pool.query(
      `UPDATE payment_transactions
          SET gateway_response = COALESCE(gateway_response, '{}'::jsonb) || $2::jsonb,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [
        row.id,
        JSON.stringify({ razorpayPaymentId: paymentId, verifiedAt: new Date().toISOString() }),
      ],
    );

    // Hand over. See the note at the top: what is owed, the cap, the khata and
    // the invoice are all decided in one place and it is not this one.
    req.body = {
      paymentStatus: "paid",
      paymentMethod: "razorpay",
      paymentId: row.id,
      remarks: `Razorpay ${paymentId}`,
    };
    return orderController.updatePaymentStatus(req, res);
  } catch (err) {
    console.error("verifyRazorpayPayment error:", err);
    return res.status(500).json({ success: false, message: "Could not verify that payment." });
  }
};

module.exports = {
  createRazorpayOrder,
  simulateRazorpayPayment,
  verifyRazorpayPayment,
};

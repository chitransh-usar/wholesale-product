const pool = require("../config/db");
const razorpay = require("../services/razorpayService");
const invoiceRepository = require("../repositories/invoiceRepository");
const orderController = require("./orderController");

/**
 * Razorpay talking to the server directly, rather than through the buyer.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS HAS TO EXIST ONCE REAL MONEY MOVES
 * ---------------------------------------------------------------------------
 * Settlement used to depend entirely on the browser posting back to /verify
 * after checkout. That is Razorpay's own "hint", and it is lost whenever the
 * buyer's browser dies, their phone sleeps mid-UPI, or they closes the tab on the
 * bank's page. The money moved and the order did not, and nobody found out
 * until they complained.
 *
 * That was survivable while every rupee sat in one account a person could
 * reconcile by hand. With Route it is not: the money has already been
 * transferred to the wholesaler, who has an order still showing unpaid.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT DO
 * ---------------------------------------------------------------------------
 * It does not settle money itself, any more than the verify endpoint does.
 * Once an event is genuine it hands over to orderController.updatePaymentStatus,
 * which is the one place that knows what is owed, caps a payment at it,
 * mirrors it into the khata, reconciles the invoice and moves the order's
 * status. A second settlement path would be a second set of those rules.
 */

/**
 * Every delivery is recorded before it is acted on, and the unique index on
 * event_id is what makes a retry harmless.
 *
 * Razorpay retries until it gets a 2xx, and a retry after a slow success is
 * ordinary. Without this, a buyer's payment could be applied twice.
 */
const alreadySeen = async (eventId, eventType, payload) => {
  const inserted = await pool.query(
    `INSERT INTO razorpay_webhook_events (event_id, event_type, payload)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING id`,
    [eventId, eventType, JSON.stringify(payload || {})],
  );
  return inserted.rows.length === 0;
};

const markHandled = (eventId, error) =>
  pool.query(
    `UPDATE razorpay_webhook_events
        SET handled_at = CURRENT_TIMESTAMP, error = $2
      WHERE event_id = $1`,
    [eventId, error || null],
  );

/**
 * Settles the order behind a captured payment.
 *
 * Finds the payment session by the Razorpay order id this server stored when
 * it opened the gateway order, never by anything the event claims about our
 * own records. The event is authenticated, but it is still the outside world
 * describing our database.
 */
const settleCapturedPayment = async (payment) => {
  const gatewayOrderId = payment?.order_id;
  const paymentId = payment?.id;
  if (!gatewayOrderId || !paymentId) return;

  const session = await pool.query(
    `SELECT pt.id, pt.order_id, pt.payment_status, o.buyer_id
       FROM payment_transactions pt
       JOIN orders o ON o.id = pt.order_id
      WHERE pt.transaction_id = $1
      ORDER BY pt.created_at DESC
      LIMIT 1`,
    [gatewayOrderId],
  );
  if (session.rows.length === 0) {
    // A payment for an order this server does not know about. Recorded by the
    // caller as handled with a note rather than retried forever.
    throw new Error(`No payment session for Razorpay order ${gatewayOrderId}`);
  }

  const row = session.rows[0];

  // Already settled by the browser getting back first, which is the common
  // case and not a problem. The webhook is the safety net, not the race.
  if (row.payment_status === "completed") return;

  await pool.query(
    `UPDATE payment_transactions
        SET gateway_response = COALESCE(gateway_response, '{}'::jsonb) || $2::jsonb,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [
      row.id,
      JSON.stringify({
        razorpayPaymentId: paymentId,
        settledByWebhookAt: new Date().toISOString(),
      }),
    ],
  );

  // The same handover the verify endpoint makes. A fake req carrying the
  // buyer, because updatePaymentStatus is written against a request and the
  // authority for who this is comes from our own order row, not the event.
  const req = {
    params: { orderId: row.order_id },
    user: { id: row.buyer_id },
    body: {
      paymentStatus: "paid",
      paymentMethod: "razorpay",
      paymentId: row.id,
      remarks: `Razorpay ${paymentId} (webhook)`,
    },
  };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await orderController.updatePaymentStatus(req, res);
  if (res.statusCode >= 400) {
    throw new Error(
      `updatePaymentStatus refused the webhook settlement: ${res.body?.message || res.statusCode}`,
    );
  }
};

/** Keeps our copy of a transfer in step with Razorpay's. */
const recordTransfer = async (transfer) => {
  if (!transfer?.id) return;

  const orderId = transfer?.notes?.orderId || null;
  const supplier = await pool.query(
    `SELECT user_id FROM wholesaler_profiles WHERE razorpay_account_id = $1`,
    [transfer.recipient],
  );

  await pool.query(
    `INSERT INTO razorpay_transfers
       (order_id, supplier_id, razorpay_transfer_id, razorpay_payment_id,
        razorpay_account_id, amount_paise, fee_paise, tax_paise,
        status, settlement_status, failure_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (razorpay_transfer_id) DO UPDATE SET
       status = EXCLUDED.status,
       settlement_status = EXCLUDED.settlement_status,
       failure_reason = EXCLUDED.failure_reason,
       razorpay_payment_id = COALESCE(EXCLUDED.razorpay_payment_id, razorpay_transfers.razorpay_payment_id),
       updated_at = CURRENT_TIMESTAMP`,
    [
      orderId,
      supplier.rows[0]?.user_id || null,
      transfer.id,
      transfer.source || null,
      transfer.recipient,
      Number(transfer.amount) || 0,
      Number(transfer.fees) || 0,
      Number(transfer.tax) || 0,
      transfer.status || null,
      transfer.settlement_status || null,
      transfer.error?.description || null,
    ],
  );
};

/** Razorpay telling us a linked account changed state. */
const updateAccountStatus = async (account) => {
  if (!account?.id) return;
  await pool.query(
    `UPDATE wholesaler_profiles
        SET razorpay_kyc_status = $2::varchar,
            razorpay_status_note = $3,
            razorpay_checked_at = CURRENT_TIMESTAMP,
            razorpay_onboarded_at = CASE WHEN $2::varchar = 'activated'
              THEN COALESCE(razorpay_onboarded_at, CURRENT_TIMESTAMP)
              ELSE razorpay_onboarded_at END
      WHERE razorpay_account_id = $1`,
    [account.id, razorpay.mapAccountStatus(account.status), account.status_note || null],
  );
};

/**
 * The endpoint.
 *
 * `req.body` here is a Buffer, not an object, because this route is mounted
 * with express.raw ahead of express.json. The signature is over the bytes
 * Razorpay sent, and re-serialising a parsed object changes them.
 */
exports.handleWebhook = async (req, res) => {
  // An unverifiable endpoint must not be an open one. Without a secret there
  // is no way to tell Razorpay from anybody who found the URL, and this
  // endpoint moves money.
  if (!razorpay.webhookConfigured()) {
    return res.status(503).json({ message: "Webhooks are not configured." });
  }

  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
  const signature = req.get("X-Razorpay-Signature");

  if (!razorpay.verifyWebhook(raw, signature)) {
    // Deliberately terse. Telling an unauthenticated caller why its signature
    // failed helps it make a better one.
    return res.status(400).json({ message: "Invalid signature." });
  }

  let event;
  try {
    event = JSON.parse(raw.toString("utf8"));
  } catch {
    return res.status(400).json({ message: "Malformed payload." });
  }

  // Razorpay's own delivery id, which is what makes a retry recognisable.
  // Falling back to the event's contents when absent is better than treating
  // every delivery as new.
  const eventId =
    req.get("X-Razorpay-Event-Id") ||
    `${event.event}:${event?.payload?.payment?.entity?.id || event.created_at}`;

  try {
    if (!(await invoiceRepository.schemaExtras()).has_razorpay_route) {
      // Answered 200 rather than 503: Razorpay would otherwise retry this for
      // hours against a server that structurally cannot store it yet.
      console.warn("Razorpay webhook received before wholesale3_razorpay_route.sql");
      return res.json({ received: true, stored: false });
    }

    if (await alreadySeen(eventId, event.event, event)) {
      return res.json({ received: true, duplicate: true });
    }
  } catch (err) {
    console.error("Webhook bookkeeping failed:", err);
    return res.status(500).json({ message: "Could not record that event." });
  }

  try {
    switch (event.event) {
      case "payment.captured":
        await settleCapturedPayment(event?.payload?.payment?.entity);
        break;

      case "transfer.processed":
      case "transfer.failed":
      case "transfer.settled":
        await recordTransfer(event?.payload?.transfer?.entity);
        break;

      case "account.activated":
      case "account.needs_clarification":
      case "account.suspended":
      case "account.updated":
        await updateAccountStatus(event?.payload?.account?.entity);
        break;

      default:
        // Recorded and ignored. Razorpay sends whatever the dashboard has
        // subscribed to, and an unknown event is not a failure.
        break;
    }
    await markHandled(eventId, null);
    return res.json({ received: true });
  } catch (err) {
    console.error(`Razorpay webhook ${event.event} failed:`, err.message);
    await markHandled(eventId, err.message).catch(() => {});
    // 200 on purpose. The delivery IS recorded, so a retry would be dropped
    // as a duplicate and achieve nothing but noise. The row carries the error
    // for somebody to look at.
    return res.json({ received: true, handled: false });
  }
};

const pool = require("../config/db");
const razorpay = require("../services/razorpayService");
const invoiceRepository = require("../repositories/invoiceRepository");
const { clean } = require("../utils/money");
const { businessId } = require("../middlewares/businessContext");

/**
 * Getting a wholesaler ready to be paid.
 *
 * Razorpay Route puts each wholesaler under the platform account as a LINKED
 * ACCOUNT. The platform creates it and submits what Razorpay asks for; the
 * KYC itself is Razorpay's and their banking partner's, and nothing in this
 * file verifies anybody. That is the right way round: this product has no
 * business deciding whether a PAN is real, and a self-certified marketplace
 * is how buyers' money goes missing.
 *
 * ---------------------------------------------------------------------------
 * THE GATE
 * ---------------------------------------------------------------------------
 * Only `activated` may receive a transfer. A linked account exists from the
 * moment it is created, long before Razorpay will settle to it, and transfers
 * to an unactivated account are HELD. So taking a Razorpay payment for a
 * wholesaler who is merely `created` means a buyer's money sits in the
 * platform's account with no way out and a wholesaler who has shipped goods.
 *
 * Every other state falls back to the UPI QR, which pays them directly and has
 * worked all along.
 */

const routeReady = async (res) => {
  const has = await invoiceRepository.schemaExtras();
  if (has.has_razorpay_route) return true;
  res.status(503).json({
    code: "ROUTE_NOT_SET_UP",
    message:
      "Razorpay Route has not been set up on this database yet. Run wholesale3_razorpay_route.sql.",
  });
  return false;
};

/** PAN is five letters, four digits, a letter. Checkable offline. */
const badPan = (pan) =>
  /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(String(pan || "").toUpperCase())
    ? null
    : "That does not look like a PAN. It is ten characters, like AAAPZ1234C.";

const badIfsc = (ifsc) =>
  /^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(ifsc || "").toUpperCase())
    ? null
    : "That does not look like an IFSC code. It is 11 characters, like HDFC0001234.";

const BUSINESS_TYPES = [
  "individual",
  "proprietorship",
  "partnership",
  "private_limited",
  "public_limited",
  "llp",
  "trust",
  "society",
  "ngo",
  "not_yet_registered",
];

/**
 * Where their onboarding stands.
 *
 * Re-reads Razorpay when there is an account id and the local copy is stale,
 * because activation happens on their side and nothing tells us unless a
 * webhook is configured. Failure to reach them is NOT an error here: the
 * stored status is still the last thing we were told, and a wholesaler
 * checking their status should not see a 500 because Razorpay is slow.
 */
exports.getRouteStatus = async (req, res) => {
  const wholesalerId = businessId(req);
  try {
    if (!(await routeReady(res))) return;

    const found = await pool.query(
      `SELECT razorpay_account_id, razorpay_kyc_status, razorpay_status_note,
              razorpay_onboarded_at, razorpay_checked_at,
              company_name, gstin, city, warehouse_state, warehouse_address,
              warehouse_pincode, contact_phone
         FROM wholesaler_profiles WHERE user_id = $1`,
      [wholesalerId],
    );
    const row = found.rows[0] || {};

    let status = row.razorpay_kyc_status || "not_started";
    let note = row.razorpay_status_note;

    if (row.razorpay_account_id && !razorpay.isStub() && status !== "activated") {
      try {
        const live = await razorpay.fetchLinkedAccount(row.razorpay_account_id);
        status = razorpay.mapAccountStatus(live.status);
        note = live.status_note || note || null;
        await pool.query(
          `UPDATE wholesaler_profiles
              SET razorpay_kyc_status = $2::varchar,
                  razorpay_status_note = $3,
                  razorpay_checked_at = CURRENT_TIMESTAMP,
                  razorpay_onboarded_at = CASE WHEN $2::varchar = 'activated'
                    THEN COALESCE(razorpay_onboarded_at, CURRENT_TIMESTAMP)
                    ELSE razorpay_onboarded_at END
            WHERE user_id = $1`,
          [wholesalerId, status, note],
        );
      } catch (err) {
        // Logged, not surfaced. The stored status is still the truth as we
        // last knew it.
        console.warn("Razorpay status check failed:", err.message);
      }
    }

    return res.json({
      configured: !razorpay.isStub(),
      webhookConfigured: razorpay.webhookConfigured(),
      accountId: row.razorpay_account_id || null,
      status,
      note: note || null,
      canBePaid: status === "activated",
      onboardedAt: row.razorpay_onboarded_at || null,
      // So the form can be filled in from what they have already told us rather
      // than asking them to type their own address a second time.
      prefill: {
        companyName: row.company_name || "",
        gstin: row.gstin || "",
        city: row.city || "",
        state: row.warehouse_state || "",
        address: row.warehouse_address || "",
        pincode: row.warehouse_pincode || "",
        phone: row.contact_phone || "",
      },
    });
  } catch (err) {
    console.error("getRouteStatus error:", err);
    return res.status(500).json({ message: "Could not read your payment status." });
  }
};

/**
 * Creates the linked account and submits everything Razorpay asks for.
 *
 * Written so it can be run again. Onboarding fails halfway for ordinary
 * reasons, a mistyped PAN most often, and a wholesaler who cannot press the
 * button a second time is stuck forever. So an existing account id is reused
 * rather than creating a second one, which would also trip the unique index
 * that stops two profiles sharing an account.
 */
exports.startOnboarding = async (req, res) => {
  const wholesalerId = businessId(req);

  const legalBusinessName = clean(req.body.legalBusinessName);
  const businessType = clean(req.body.businessType);
  const pan = clean(req.body.pan) ? clean(req.body.pan).toUpperCase() : "";
  const gstin = clean(req.body.gstin) ? clean(req.body.gstin).toUpperCase() : "";
  const contactName = clean(req.body.contactName);
  const email = clean(req.body.email);
  const phone = clean(req.body.phone);
  const accountNumber = clean(req.body.accountNumber);
  const ifsc = clean(req.body.ifsc) ? clean(req.body.ifsc).toUpperCase() : "";
  const beneficiaryName = clean(req.body.beneficiaryName) || legalBusinessName;
  const address = {
    street1: clean(req.body.address),
    city: clean(req.body.city),
    state: clean(req.body.state),
    postalCode: clean(req.body.pincode),
  };

  if (!legalBusinessName) {
    return res.status(400).json({ message: "Enter the name your business is registered as." });
  }
  if (!BUSINESS_TYPES.includes(businessType)) {
    return res.status(400).json({ message: "Choose what kind of business this is." });
  }
  if (!contactName) return res.status(400).json({ message: "Enter the owner's name." });
  if (!email) return res.status(400).json({ message: "Enter an email Razorpay can reach you on." });
  if (!phone) return res.status(400).json({ message: "Enter a phone number." });

  const panError = badPan(pan);
  if (panError) return res.status(400).json({ message: panError });
  const ifscError = badIfsc(ifsc);
  if (ifscError) return res.status(400).json({ message: ifscError });
  if (!accountNumber) {
    return res.status(400).json({ message: "Enter the bank account to be paid into." });
  }
  if (!address.city || !address.state || !address.postalCode) {
    return res.status(400).json({
      message: "Razorpay needs the registered address, including the state and PIN code.",
    });
  }

  try {
    if (!(await routeReady(res))) return;

    if (razorpay.isStub()) {
      return res.status(503).json({
        code: "RAZORPAY_NOT_CONFIGURED",
        message:
          "Razorpay is not configured on this server, so an account cannot be opened yet.",
      });
    }

    const existing = await pool.query(
      "SELECT razorpay_account_id FROM wholesaler_profiles WHERE user_id = $1",
      [wholesalerId],
    );
    if (existing.rows.length === 0) {
      return res.status(400).json({ message: "Finish your business profile first." });
    }

    let accountId = existing.rows[0].razorpay_account_id;

    if (!accountId) {
      const account = await razorpay.createLinkedAccount({
        email,
        phone,
        legalBusinessName,
        businessType,
        referenceId: String(wholesalerId),
        gstin,
        pan,
        address,
      });
      accountId = account.id;

      // Stored BEFORE the calls that follow. If a stakeholder call fails, the
      // account still exists at Razorpay, and forgetting its id here would
      // orphan it and make the retry create a second one.
      await pool.query(
        `UPDATE wholesaler_profiles
            SET razorpay_account_id = $2,
                razorpay_kyc_status = 'created',
                razorpay_checked_at = CURRENT_TIMESTAMP
          WHERE user_id = $1`,
        [wholesalerId, accountId],
      );
    }

    await razorpay.createStakeholder(accountId, {
      name: contactName,
      email,
      pan,
      phone,
    });

    const product = await razorpay.requestRouteProduct(accountId);
    if (product?.id) {
      await razorpay.setSettlementAccount(accountId, product.id, {
        beneficiaryName,
        accountNumber,
        ifsc,
      });
    }

    const live = await razorpay.fetchLinkedAccount(accountId);
    const status = razorpay.mapAccountStatus(live.status);

    await pool.query(
      `UPDATE wholesaler_profiles
          SET razorpay_kyc_status = $2::varchar,
              razorpay_status_note = $3,
              razorpay_checked_at = CURRENT_TIMESTAMP,
              razorpay_onboarded_at = CASE WHEN $2::varchar = 'activated'
                THEN COALESCE(razorpay_onboarded_at, CURRENT_TIMESTAMP)
                ELSE razorpay_onboarded_at END
        WHERE user_id = $1`,
      [wholesalerId, status, live.status_note || null],
    );

    return res.json({
      success: true,
      accountId,
      status,
      canBePaid: status === "activated",
      message:
        status === "activated"
          ? "Your account is ready. Buyers paying by card or UPI now reach you."
          : "Sent to Razorpay. They will check your details, which usually takes a day or two. Until then buyers pay you by UPI as before.",
    });
  } catch (err) {
    if (err.code === "RAZORPAY_REFUSED" || err.code === "RAZORPAY_TIMEOUT") {
      // Razorpay's own words, and the field it objected to. "Could not set up
      // payments" would hide the one sentence that says which box is wrong.
      return res.status(502).json({
        code: err.code,
        field: err.field || undefined,
        message: err.message,
      });
    }
    console.error("startOnboarding error:", err);
    return res.status(500).json({ message: "Could not set up payments." });
  }
};

/** What they have actually been sent, as Razorpay reported it. */
exports.listTransfers = async (req, res) => {
  const wholesalerId = businessId(req);
  try {
    if (!(await routeReady(res))) return;

    const rows = await pool.query(
      `SELECT t.razorpay_transfer_id, t.razorpay_payment_id, t.amount_paise,
              t.fee_paise, t.tax_paise, t.status, t.settlement_status,
              t.failure_reason, t.created_at, o.order_number
         FROM razorpay_transfers t
         LEFT JOIN orders o ON o.id = t.order_id
        WHERE t.supplier_id = $1
        ORDER BY t.created_at DESC
        LIMIT 200`,
      [wholesalerId],
    );
    return res.json(rows.rows);
  } catch (err) {
    console.error("listTransfers error:", err);
    return res.status(500).json({ message: "Could not read your transfers." });
  }
};

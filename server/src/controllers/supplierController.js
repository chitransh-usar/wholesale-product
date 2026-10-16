const pool = require("../config/db");
const { clean, toPaise, fromPaise } = require("../utils/money");
const { businessId } = require("../middlewares/businessContext");
const invoiceRepository = require("../repositories/invoiceRepository");
const { balanceExpression, payableTotals } = require("../services/supplierBalance");

/**
 * The supplier book: who the wholesaler buys from, and what they owe each.
 *
 * The mirror of partyController, and kept separate for the reason written at
 * the top of the purchases migration: a party balance means "they owe me" in
 * seventeen existing queries, and a supplier balance means the opposite.
 *
 * Every query is scoped by the wholesaler id from the token, so a supplier id
 * arriving in a request body can never reach somebody else's book.
 */

/**
 * Whether the purchase migration has been run.
 *
 * Answered as a 503 with a code rather than a 500, so the screen can say "this
 * has not been set up yet" instead of showing a wholesaler a server error for
 * a feature that simply is not switched on in their database. Migrations here
 * are applied by hand, so this state is normal, not exceptional.
 */
const purchasesReady = async (res) => {
  const has = await invoiceRepository.schemaExtras();
  if (has.has_purchases) return true;
  res.status(503).json({
    code: "PURCHASES_NOT_SET_UP",
    message:
      "The purchase book has not been set up on this database yet. Run wholesale3_purchases.sql.",
  });
  return false;
};

exports.listSuppliers = async (req, res) => {
  const wholesalerId = businessId(req);
  const { search, status } = req.query;

  try {
    if (!(await purchasesReady(res))) return;

    const params = [wholesalerId];
    let where = "sup.wholesaler_id = $1";

    if (clean(status)) {
      params.push(status);
      where += ` AND sup.status = $${params.length}`;
    }
    if (clean(search)) {
      params.push(`%${clean(search)}%`);
      where += ` AND (sup.name ILIKE $${params.length}
                   OR sup.business_name ILIKE $${params.length}
                   OR sup.phone ILIKE $${params.length}
                   OR sup.city ILIKE $${params.length})`;
    }

    const result = await pool.query(
      `SELECT sup.id, sup.name, sup.business_name, sup.phone, sup.city,
              sup.gstin, sup.status,
              ${balanceExpression({ supplierRef: "sup.id" })} AS balance,
              (SELECT COUNT(*) FROM purchases pu
                WHERE pu.supplier_id = sup.id AND pu.status <> 'cancelled') AS purchase_count,
              (SELECT MAX(pu.purchase_date) FROM purchases pu
                WHERE pu.supplier_id = sup.id AND pu.status <> 'cancelled') AS last_purchase_on
         FROM suppliers sup
        WHERE ${where}
        ORDER BY sup.name ASC
        LIMIT 500`,
      params,
    );

    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Error listing suppliers:", err);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * The two figures for the top of the purchase screens.
 *
 * Never a single netted number. See payableTotals for why: an advance sitting
 * with one mill must not hide a bill overdue at another.
 */
exports.getSupplierStats = async (req, res) => {
  const wholesalerId = businessId(req);
  try {
    if (!(await purchasesReady(res))) return;

    const [totals, counts] = await Promise.all([
      pool.query(payableTotals(), [wholesalerId]),
      pool.query(
        `SELECT
           (SELECT COUNT(*) FROM suppliers WHERE wholesaler_id = $1 AND status = 'active') AS suppliers,
           (SELECT COUNT(*) FROM purchases WHERE wholesaler_id = $1 AND status = 'received') AS purchases`,
        [wholesalerId],
      ),
    ]);

    res.status(200).json({
      owedByYou: Number(totals.rows[0].owed_by_you || 0),
      onAccount: Number(totals.rows[0].on_account || 0),
      suppliers: Number(counts.rows[0].suppliers || 0),
      purchases: Number(counts.rows[0].purchases || 0),
    });
  } catch (err) {
    console.error("Error reading supplier totals:", err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getSupplierById = async (req, res) => {
  const wholesalerId = businessId(req);
  const { id } = req.params;

  try {
    if (!(await purchasesReady(res))) return;

    const supplier = await pool.query(
      `SELECT sup.*, ${balanceExpression({ supplierRef: "sup.id" })} AS balance
         FROM suppliers sup
        WHERE sup.id = $1 AND sup.wholesaler_id = $2`,
      [id, wholesalerId],
    );
    if (supplier.rows.length === 0) {
      return res.status(404).json({ message: "Supplier not found" });
    }

    const [purchases, payments] = await Promise.all([
      pool.query(
        `SELECT id, purchase_number, purchase_date, supplier_invoice_number,
                supplier_invoice_date, status, total,
                COALESCE((SELECT SUM(sp.amount) FROM supplier_payments sp
                           WHERE sp.purchase_id = purchases.id), 0) AS paid
           FROM purchases
          WHERE supplier_id = $1 AND wholesaler_id = $2
          ORDER BY purchase_date DESC, created_at DESC
          LIMIT 100`,
        [id, wholesalerId],
      ),
      pool.query(
        `SELECT id, amount, method, paid_on, note, purchase_id
           FROM supplier_payments
          WHERE supplier_id = $1 AND wholesaler_id = $2
          ORDER BY paid_on DESC, created_at DESC
          LIMIT 100`,
        [id, wholesalerId],
      ),
    ]);

    res.status(200).json({
      supplier: supplier.rows[0],
      purchases: purchases.rows,
      payments: payments.rows,
    });
  } catch (err) {
    console.error("Error fetching supplier:", err);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * What you already owed them when the book was opened. Mirrors parseOpening on
 * the customer side, with the sign meaning what it means everywhere on this
 * side: positive is money YOU owe them.
 */
const parseOpening = (amount, on, res) => {
  const hasAmount = amount !== undefined && amount !== null && String(amount).trim() !== "";
  const value = hasAmount ? Number(amount) : 0;

  if (hasAmount && !Number.isFinite(value)) {
    res.status(400).json({ message: "Enter the opening balance as a number." });
    return undefined;
  }
  if (Math.abs(value) >= 10000000000) {
    res.status(400).json({ message: "That opening balance is too large." });
    return undefined;
  }
  const date = clean(on);
  if (value !== 0 && !date) {
    res.status(400).json({
      message: "Say which date the opening balance is as at, or the statement cannot start from it.",
    });
    return undefined;
  }
  if (date && Number.isNaN(new Date(date).getTime())) {
    res.status(400).json({ message: "That opening balance date is not a date." });
    return undefined;
  }
  return { amount: Number(value.toFixed(2)), on: date };
};

const supplierFields = (body) => ({
  name: clean(body.name),
  businessName: clean(body.businessName ?? body.business_name),
  phone: clean(body.phone),
  city: clean(body.city),
  address: clean(body.address),
  gstin: clean(body.gstin) ? clean(body.gstin).toUpperCase() : null,
  notes: clean(body.notes),
});

/**
 * A GSTIN is fifteen characters and its first two are a state code. Checked
 * for shape only, not for existence: there is no lookup here, and refusing a
 * real number because a check digit routine was wrong is worse than storing
 * one that turns out to be wrong.
 *
 * Blank is allowed and common. A great many small suppliers are unregistered,
 * and a purchase from one is a real purchase, just one carrying no input
 * credit.
 */
const badGstin = (gstin) => {
  if (!gstin) return null;
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][Z][0-9A-Z]$/.test(gstin)) {
    return "That does not look like a GST number. It is 15 characters, like 24AAACC1206D1ZM.";
  }
  return null;
};

exports.createSupplier = async (req, res) => {
  const wholesalerId = businessId(req);
  const fields = supplierFields(req.body);

  if (!fields.name) {
    return res.status(400).json({ message: "Give this supplier a name" });
  }
  const gstinError = badGstin(fields.gstin);
  if (gstinError) return res.status(400).json({ message: gstinError });

  const opening = parseOpening(req.body.openingBalance, req.body.openingBalanceOn, res);
  if (opening === undefined) return;

  try {
    if (!(await purchasesReady(res))) return;

    const result = await pool.query(
      `INSERT INTO suppliers
         (wholesaler_id, name, business_name, phone, city, address, gstin, notes,
          opening_balance, opening_balance_on)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date)
       RETURNING *`,
      [
        wholesalerId,
        fields.name,
        fields.businessName,
        fields.phone,
        fields.city,
        fields.address,
        fields.gstin,
        fields.notes,
        opening.amount,
        opening.on,
      ],
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    // The partial unique index on (wholesaler_id, phone). Told plainly,
    // because the alternative is a second row for the same mill and a balance
    // split across both.
    if (err.code === "23505") {
      return res.status(409).json({
        message: "You already have a supplier with that phone number.",
      });
    }
    console.error("Error creating supplier:", err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.updateSupplier = async (req, res) => {
  const wholesalerId = businessId(req);
  const { id } = req.params;
  const fields = supplierFields(req.body);

  if (!fields.name) {
    return res.status(400).json({ message: "Give this supplier a name" });
  }
  const gstinError = badGstin(fields.gstin);
  if (gstinError) return res.status(400).json({ message: gstinError });

  const status = clean(req.body.status);
  if (status && !["active", "inactive"].includes(status)) {
    return res.status(400).json({ message: "Unknown status" });
  }

  const opening = parseOpening(req.body.openingBalance, req.body.openingBalanceOn, res);
  if (opening === undefined) return;

  try {
    if (!(await purchasesReady(res))) return;

    const result = await pool.query(
      `UPDATE suppliers SET
         name          = $3,
         business_name = $4,
         phone         = $5,
         city          = $6,
         address       = $7,
         gstin         = $8,
         notes         = $9,
         status        = COALESCE($10, status),
         opening_balance    = $11,
         opening_balance_on = $12::date,
         updated_at    = CURRENT_TIMESTAMP
       WHERE id = $1 AND wholesaler_id = $2
       RETURNING *`,
      [
        id,
        wholesalerId,
        fields.name,
        fields.businessName,
        fields.phone,
        fields.city,
        fields.address,
        fields.gstin,
        fields.notes,
        status,
        opening.amount,
        opening.on,
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Supplier not found" });
    }
    res.status(200).json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        message: "You already have a supplier with that phone number.",
      });
    }
    console.error("Error updating supplier:", err);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * Records money paid OUT to a supplier.
 *
 * `purchaseId` is optional and that is the point: a trader pays a round sum
 * against several old bills without saying which, exactly as on the customer
 * side. A payment with no purchase against it sits on the supplier's account
 * and comes off customer balance.
 *
 * Deliberately NOT capped at the outstanding balance. Paying a mill in advance
 * is ordinary trade, and the balance simply goes negative, which the screens
 * read as money on account. A payment tied to a specific purchase IS capped at
 * what that purchase still owes, because paying 60,000 against a 50,000 bill
 * is a typo, not an advance.
 */
exports.recordSupplierPayment = async (req, res) => {
  const wholesalerId = businessId(req);
  const { id } = req.params;
  const { amount, method, paidOn, note, purchaseId } = req.body;

  const amountPaise = toPaise(amount);
  if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
    return res.status(400).json({ message: "Enter how much was paid" });
  }
  if (method && !["cash", "upi", "bank", "cheque", "other"].includes(method)) {
    return res.status(400).json({ message: "Unknown payment method" });
  }

  // Checked BEFORE a client is taken from the pool. Inside the try below, the
  // early return would fall through the finally and release the client a
  // second time, which corrupts the pool rather than failing this one request.
  if (!(await purchasesReady(res))) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const supplier = await client.query(
      "SELECT id FROM suppliers WHERE id = $1 AND wholesaler_id = $2",
      [id, wholesalerId],
    );
    if (supplier.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Supplier not found" });
    }

    let purchase = null;
    if (clean(purchaseId)) {
      // Locked, so two payments recorded at the same moment cannot both read
      // the same outstanding figure and both pass the check below. The same
      // read-modify-write race that was fixed on the sale side.
      const found = await client.query(
        `SELECT id, total, status FROM purchases
          WHERE id = $1 AND wholesaler_id = $2 AND supplier_id = $3
          FOR UPDATE`,
        [purchaseId, wholesalerId, id],
      );
      if (found.rows.length === 0) {
        await client.query("ROLLBACK");
        return res
          .status(404)
          .json({ message: "That purchase is not against this supplier" });
      }
      purchase = found.rows[0];

      if (purchase.status === "cancelled") {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message:
            "That purchase was cancelled. Record this against the supplier instead and it will sit on their account.",
        });
      }

      const paid = await client.query(
        "SELECT COALESCE(SUM(amount), 0) AS total FROM supplier_payments WHERE purchase_id = $1",
        [purchaseId],
      );
      const outstandingPaise =
        toPaise(purchase.total) - toPaise(paid.rows[0].total);
      if (amountPaise > outstandingPaise) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: `Only ₹${fromPaise(outstandingPaise)} is still owed on that purchase. Record the rest against the supplier and it will sit on their account.`,
        });
      }
    }

    const result = await client.query(
      `INSERT INTO supplier_payments
         (wholesaler_id, supplier_id, purchase_id, amount, method, paid_on, note)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6::date, CURRENT_DATE), $7)
       RETURNING *`,
      [
        wholesalerId,
        id,
        purchase ? purchase.id : null,
        fromPaise(amountPaise),
        method || "cash",
        clean(paidOn),
        clean(note),
      ],
    );

    await client.query("COMMIT");
    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error recording supplier payment:", err);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
};

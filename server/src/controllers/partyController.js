const pool = require("../config/db");
const { clean, fromPaise, toPaise } = require("../utils/money");
const saleInvoiceService = require("../services/saleInvoiceService");
const creditApplyService = require("../services/creditApplyService");
const { hasPartyLink } = require("../services/partyService");
const { hasSaleLink } = require("../services/orderSaleService");
const { checkGstin } = require("../utils/gstin");
const { asState } = require("../services/placeOfSupply");
const invoiceRepository = require("../repositories/invoiceRepository");
const {
  NOT_OWED_SQL,
  bridgedGuard,
  balanceExpression,
  collectionTotals,
  hasOpeningBalance,
  totalsExpression,
} = require("../services/khataBalance");
const pdfService = require("../services/pdfService");
const { businessId } = require("../middlewares/businessContext");

/**
 * Parties are a wholesaler's own customer book. Every query in this file is
 * scoped by wholesaler_id from the token, never from the request body, so one
 * wholesaler can never read or write another's book.
 *
 * See server/migrations/wholesale3_parties_and_sales.sql for why a party is
 * private per wholesaler and does not need a login.
 */

/**
 * What a customer owes is defined in services/khataBalance, not here.
 *
 * It used to live in this file, and overviewController answered the same
 * question its own way and got a different answer. Both now read one rule.
 */
/**
 * The opening balance a form sent, checked.
 *
 * SIGNED: positive means they owed you when the book was opened, negative means
 * you were holding their money. Both are ordinary, so neither is refused.
 *
 * A figure with no date is refused. "They owe 2 lakh" is not a fact until you
 * say as at when: the statement draws its line at that date, and without one
 * the opening figure and the transactions after it count the same goods twice.
 * A date with no figure is fine and means zero as at that date.
 *
 * Returns undefined once it has answered the request, the same shape
 * gstinToStore uses in this file.
 */
const parseOpening = (amount, on, res) => {
  const hasAmount = amount !== undefined && amount !== null && String(amount).trim() !== "";
  const value = hasAmount ? Number(amount) : 0;

  if (hasAmount && !Number.isFinite(value)) {
    res.status(400).json({ message: "Enter the opening balance as a number." });
    return undefined;
  }
  // NUMERIC(12,2) tops out below a hundred crore. Refused with a sentence
  // rather than by the database, which would say "numeric field overflow".
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

const balanceSelect = (hasOrderParty, hasBridge, hasOpening) =>
  `${balanceExpression({ hasOrderParty, hasBridge, hasOpening })} AS outstanding`;

exports.listParties = async (req, res) => {
  const wholesalerId = businessId(req);
  const search = clean(req.query.search);

  try {
    const params = [wholesalerId];
    let where = "pt.wholesaler_id = $1";

    // Someone marked "not dealing with them any more" drops out of the book
    // by default. Their sales and balance are untouched, and passing
    // includeInactive brings them back into view.
    const includeInactive =
      String(req.query.includeInactive || "") === "1" ||
      String(req.query.includeInactive || "").toLowerCase() === "true";
    if (!includeInactive) {
      where += " AND pt.status = 'active'";
    }

    if (search) {
      params.push(`%${search}%`);
      where += ` AND (pt.name ILIKE $2 OR pt.business_name ILIKE $2 OR pt.phone ILIKE $2 OR pt.city ILIKE $2)`;
    }

    const hasOrders = await hasPartyLink(pool);
    const hasBridge = await hasSaleLink(pool);
    const hasOpening = await hasOpeningBalance(pool);
    const result = await pool.query(
      `SELECT
         pt.id, pt.name, pt.business_name, pt.phone, pt.city, pt.gstin,
         pt.status, pt.created_at,
         (SELECT MAX(s.sale_date) FROM sales s
           WHERE s.party_id = pt.id AND s.status <> 'cancelled') AS last_sale_date,
         ${balanceSelect(hasOrders, hasBridge, hasOpening)}
       FROM parties pt
       WHERE ${where}
       ORDER BY pt.name ASC`,
      params,
    );

    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Error listing parties:", err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getPartyById = async (req, res) => {
  const wholesalerId = businessId(req);
  const { id } = req.params;

  try {
    const hasOrders = await hasPartyLink(pool);
    const hasBridge = await hasSaleLink(pool);
    const hasOpening = await hasOpeningBalance(pool);
    const result = await pool.query(
      `SELECT pt.*, ${balanceSelect(hasOrders, hasBridge, hasOpening)}
         FROM parties pt
        WHERE pt.id = $1 AND pt.wholesaler_id = $2`,
      [id, wholesalerId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Party not found" });
    }

    // The party page shows the running account, so the history comes with it
    // rather than in a second request.
    const [sales, payments] = await Promise.all([
      pool.query(
        `SELECT id, sale_number, sale_date, status, source, total
           FROM sales
          WHERE party_id = $1 AND wholesaler_id = $2
          ORDER BY sale_date DESC, created_at DESC
          LIMIT 50`,
        [id, wholesalerId],
      ),
      pool.query(
        `SELECT id, amount, method, paid_on, note, sale_id
           FROM party_payments
          WHERE party_id = $1 AND wholesaler_id = $2
          ORDER BY paid_on DESC, created_at DESC
          LIMIT 50`,
        [id, wholesalerId],
      ),
    ]);

    res.status(200).json({
      party: result.rows[0],
      sales: sales.rows,
      payments: payments.rows,
    });
  } catch (err) {
    console.error("Error fetching party:", err);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * A GST number that is present has to be a real one.
 *
 * Blank is fine: most small retailers are not registered, and insisting would
 * make the customer book unusable. But a number that IS entered goes onto
 * invoices, and a mistyped one there is the wholesaler's problem at filing
 * time, not the typist's. The check is arithmetic on the number itself, so it
 * costs nothing and needs no account anywhere.
 *
 * Returns the tidied number to store, or sends the error and returns
 * undefined.
 */
const gstinToStore = (raw, res) => {
  if (raw === undefined) return undefined;
  const value = clean(raw);
  if (!value) return null;
  const result = checkGstin(value);
  if (!result.ok) {
    res.status(400).json({ message: result.reason });
    return undefined;
  }
  return result.gstin;
};

/** Is the state column there yet? wholesale3_party_state.sql adds it. */
const hasPartyState = async () =>
  Boolean((await invoiceRepository.schemaExtras()).has_party_state);

/**
 * A state, canonicalised, or an answer already sent.
 *
 * Refused rather than stored as typed when it is not a state this system
 * knows. The value decides CGST plus SGST against IGST on a legal document,
 * and a misspelling kept verbatim would resolve to null later and quietly
 * bill as a local sale. Empty clears it, which is the honest "not told".
 */
const stateToStore = (value, res) => {
  if (!clean(value)) return null;
  const canonical = asState(value);
  if (!canonical) {
    res.status(400).json({
      message:
        "That is not a state we recognise. Type the state name, for example Gujarat.",
    });
    return undefined;
  }
  return canonical;
};

exports.createParty = async (req, res) => {
  const wholesalerId = businessId(req);
  const {
    name, businessName, phone, city, state, address, gstin, notes,
    openingBalance, openingBalanceOn, creditLimit,
  } = req.body;

  if (!clean(name)) {
    return res.status(400).json({ message: "Name is required" });
  }

  const gstinValue = gstin === undefined ? null : gstinToStore(gstin, res);
  if (gstinValue === undefined) return;

  const hasState = await hasPartyState();
  if (!hasState && clean(state)) {
    return res.status(503).json({
      code: "PARTY_STATE_NOT_SET_UP",
      message:
        "Customer state has not been set up yet. Run wholesale3_party_state.sql.",
    });
  }
  const stateValue = hasState ? stateToStore(state, res) : null;
  if (stateValue === undefined) return;

  const hasOpening = await hasOpeningBalance(pool);
  const opening = hasOpening
    ? parseOpening(openingBalance, openingBalanceOn, res)
    : { amount: 0, on: null };
  if (opening === undefined) return;

  try {
    // Built up rather than written out, because two columns here depend on a
    // migration having been run and hand counted placeholders drift the moment
    // a third one does.
    const columns = [
      "wholesaler_id", "name", "business_name", "phone", "city",
      "address", "gstin", "notes",
    ];
    const values = [
      wholesalerId,
      clean(name),
      clean(businessName),
      clean(phone),
      clean(city),
      clean(address),
      gstinValue,
      clean(notes),
    ];
    const casts = [];

    if (hasState) {
      columns.push("state");
      values.push(stateValue);
      casts.push("");
    }
    if (hasOpening) {
      columns.push("opening_balance", "opening_balance_on");
      values.push(opening.amount, opening.on);
      casts.push("", "::date");
    }
    // How much this customer may owe before the sale form says something. A
    // blank or a zero means no limit, which is what almost every row carries.
    // Nothing is ever refused on it, see creditWarning in saleController.
    if (creditLimit !== undefined && String(creditLimit).trim() !== "") {
      const limit = Number(creditLimit);
      if (Number.isFinite(limit) && limit >= 0) {
        columns.push("credit_limit");
        values.push(limit);
        casts.push("::numeric");
      }
    }

    const placeholders = values.map((_, i) => {
      const cast = i >= 8 ? casts[i - 8] || "" : "";
      return `$${i + 1}${cast}`;
    });

    const result = await pool.query(
      `INSERT INTO parties (${columns.join(", ")})
       VALUES (${placeholders.join(", ")})
       RETURNING *`,
      values,
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    // The partial unique index on (wholesaler_id, phone) is what catches a
    // customer being added twice, which is easy to do from a phone book.
    if (err.code === "23505") {
      return res
        .status(409)
        .json({ message: "This phone number is already in your customer list" });
    }
    console.error("Error creating party:", err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.updateParty = async (req, res) => {
  const wholesalerId = businessId(req);
  const { id } = req.params;
  const {
    name, businessName, phone, city, state, address, gstin, notes, status,
    openingBalance, openingBalanceOn, creditLimit,
  } = req.body;

  if (name !== undefined && !clean(name)) {
    return res.status(400).json({ message: "Name is required" });
  }

  if (status !== undefined && !["active", "inactive"].includes(status)) {
    return res.status(400).json({ message: "Unknown status" });
  }

  // Built one column at a time rather than with COALESCE, because COALESCE
  // cannot express "clear this field". A wholesaler who empties the phone box
  // means to remove a wrong number, and the old version silently kept it. A
  // key that is absent is left alone; a key sent empty or null is cleared.
  // Name is the exception, since a party must have one.
  const sets = [];
  const values = [id, wholesalerId];
  const put = (column, value) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (name !== undefined) put("name", clean(name));
  if (businessName !== undefined) put("business_name", clean(businessName));
  if (phone !== undefined) put("phone", clean(phone));
  if (city !== undefined) put("city", clean(city));
  if (state !== undefined) {
    // Refused before the migration rather than accepted and dropped: a
    // wholesaler told their customer's state saved when it was not gets the
    // wrong tax on the next bill and no sign of why.
    //
    // Only when they actually typed one, though. The edit form sends every
    // field including the empty ones, so refusing an empty state would make
    // every customer uneditable on a database that has not been migrated, to
    // protect a value that is not there.
    if (!(await hasPartyState())) {
      if (clean(state)) {
        return res.status(503).json({
          code: "PARTY_STATE_NOT_SET_UP",
          message:
            "Customer state has not been set up yet. Run wholesale3_party_state.sql.",
        });
      }
    } else {
      const stateValue = stateToStore(state, res);
      if (stateValue === undefined) return;
      put("state", stateValue);
    }
  }
  if (address !== undefined) put("address", clean(address));
  if (gstin !== undefined) {
    const gstinValue = gstinToStore(gstin, res);
    if (gstinValue === undefined) return;
    put("gstin", gstinValue);
  }
  if (notes !== undefined) put("notes", clean(notes));
  if (status !== undefined) put("status", status);

  /**
   * What they already owed when this book was opened.
   *
   * Guarded on the column existing, and not offered at all before the
   * migration, rather than silently dropped: a wholesaler who types 2 lakh and
   * is told it saved when it did not has a khata that is wrong by 2 lakh.
   */
  if (openingBalance !== undefined || openingBalanceOn !== undefined) {
    if (!(await hasOpeningBalance(pool))) {
      return res.status(503).json({
        code: "OPENING_BALANCE_NOT_SET_UP",
        message: "Opening balances are not set up on this database yet. Run wholesale3_opening_balance.sql.",
      });
    }
    const parsed = parseOpening(openingBalance, openingBalanceOn, res);
    if (parsed === undefined) return;
    if (openingBalance !== undefined) put("opening_balance", parsed.amount);
    if (openingBalanceOn !== undefined) put("opening_balance_on", parsed.on);
  }

  // Emptying the box clears the limit, the same way emptying a phone number
  // removes it. A blank is "no limit", not "leave it alone".
  if (creditLimit !== undefined) {
    const blank = String(creditLimit).trim() === "";
    const limit = blank ? null : Number(creditLimit);
    if (!blank && (!Number.isFinite(limit) || limit < 0)) {
      return res.status(400).json({ message: "Enter a credit limit of zero or more, or leave it empty." });
    }
    put("credit_limit", limit);
  }

  if (sets.length === 0) {
    return res.status(400).json({ message: "Nothing to update" });
  }

  try {
    const result = await pool.query(
      `UPDATE parties
          SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND wholesaler_id = $2
        RETURNING *`,
      values,
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Party not found" });
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res
        .status(409)
        .json({ message: "This phone number is already in your customer list" });
    }
    console.error("Error updating party:", err);
    res.status(500).json({ message: "Server error" });
  }
};

const PAYMENT_METHODS = ["cash", "upi", "bank", "cheque", "other"];

/**
 * Money received from a customer. The sale it settles is optional on purpose:
 * a trader hands over a lump sum against several old bills without saying
 * which, so a payment can sit against the running balance instead.
 */
exports.recordPayment = async (req, res) => {
  const wholesalerId = businessId(req);
  const { id } = req.params;
  const { amount, method, paidOn, note, saleId } = req.body;

  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    return res.status(400).json({ message: "Enter an amount" });
  }

  if (method && !PAYMENT_METHODS.includes(method)) {
    return res.status(400).json({ message: "Unknown payment method" });
  }

  try {
    const party = await pool.query(
      "SELECT id FROM parties WHERE id = $1 AND wholesaler_id = $2",
      [id, wholesalerId],
    );
    if (party.rows.length === 0) {
      return res.status(404).json({ message: "Customer not found" });
    }

    // A payment may name a sale, but only one of this wholesaler's own.
    if (clean(saleId)) {
      const sale = await pool.query(
        "SELECT id FROM sales WHERE id = $1 AND wholesaler_id = $2 AND party_id = $3",
        [saleId, wholesalerId, id],
      );
      if (sale.rows.length === 0) {
        return res
          .status(404)
          .json({ message: "That sale is not on this customer's account" });
      }
    }

    const result = await pool.query(
      `INSERT INTO party_payments
         (wholesaler_id, party_id, sale_id, amount, method, paid_on, note)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6::date, CURRENT_DATE), $7)
       RETURNING *`,
      [
        wholesalerId,
        id,
        clean(saleId),
        value.toFixed(2),
        method || "cash",
        clean(paidOn),
        clean(note),
      ],
    );

    // Money against a billed sale has to move that bill's status too, or the
    // invoice and the customer's balance start telling different stories.
    //
    // And if this payment settled the sale, the bill is raised here rather
    // than waiting for somebody to press a button. That button could be
    // forgotten, and a settled sale with no bill is a customer with nothing
    // to put in their books. The order side has always worked this way.
    if (clean(saleId)) {
      try {
        await saleInvoiceService.billIfSettled(saleId, wholesalerId);
        await saleInvoiceService.syncInvoiceFromLedger(saleId);
      } catch (syncError) {
        // The payment is recorded and that is what matters. A stale invoice
        // status is recoverable; losing the payment is not.
        console.error("Could not refresh the bill after payment:", syncError);
      }
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error recording payment:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// Rupees are summed in paise. A statement is a running total down a column,
// so a paisa lost per row shows up as a closing balance that disagrees with
// the customer's own page, and that is the one number they will check.

/**
 * One customer's account over a date range: what they were carrying at the
 * start, every bill and every payment since, and what they owe now.
 *
 * This is the thing a wholesaler sends on WhatsApp when they want paying, so
 * it has to reconcile exactly with the balance on the customer page. It is
 * built from the same two facts that balance is: confirmed and delivered
 * sales on one side, party_payments on the other.
 *
 * Cancelled and draft sales are left out, for the same reason they are left
 * out of the balance. A draft is not yet a debt and a cancelled bill is not
 * owed, so listing either would show the customer a figure they do not owe.
 * A payment that was made against a sale later cancelled still appears,
 * because the money really did change hands, and its line says so.
 *
 * Leaving `from` off means "since the beginning", which makes the opening
 * balance zero rather than a number nobody can check.
 */
const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * Validates the window and builds the statement. Shared by the screen and by
 * the PDF, so the document and the page can never disagree.
 *
 * Returns { error } for anything the caller should refuse, otherwise the
 * statement itself.
 */
const buildStatement = async (id, wholesalerId, rawFrom, rawTo) => {
  const from = clean(rawFrom);
  const to = clean(rawTo);

  if ((from && !isDate(from)) || (to && !isDate(to))) {
    return { error: { status: 400, message: "Dates must be YYYY-MM-DD" } };
  }
  if (from && to && from > to) {
    return {
      error: { status: 400, message: "The From date is after the To date" },
    };
  }

  {
    const hasOrders = await hasPartyLink(pool);
    const hasBridge = await hasSaleLink(pool);
    const hasOpening = await hasOpeningBalance(pool);
    const party = await pool.query(
      `SELECT pt.*, ${balanceSelect(hasOrders, hasBridge, hasOpening)}
         FROM parties pt
        WHERE pt.id = $1 AND pt.wholesaler_id = $2`,
      [id, wholesalerId],
    );
    if (party.rows.length === 0) {
      return { error: { status: 404, message: "Customer not found" } };
    }

    // Everything before the window, netted into one number. Marketplace
    // orders are on the billed side here for the same reason they are on the
    // customer page: this statement is what the wholesaler sends when they
    // wants paying, and it has to reconcile with the page exactly.
    const opening = from
      ? await pool.query(
          `SELECT
             COALESCE((SELECT SUM(s.total) FROM sales s
                        WHERE s.party_id = $1 AND s.wholesaler_id = $2
                          AND s.status IN ('confirmed', 'delivered')
                          AND s.sale_date < $3::date), 0)
             ${
               hasOrders
                 ? `+ COALESCE((SELECT SUM(o.total_amount) FROM orders o
                        WHERE o.party_id = $1 AND o.supplier_id = $2
                          AND o.status NOT IN (${NOT_OWED_SQL})
                          ${bridgedGuard(hasBridge)}
                          AND o.created_at::date < $3::date), 0)`
                 : ""
             } AS billed,
             COALESCE((SELECT SUM(pp.amount) FROM party_payments pp
                        WHERE pp.party_id = $1 AND pp.wholesaler_id = $2
                          AND pp.paid_on < $3::date), 0) AS received,
             COALESCE((SELECT SUM(cn.grand_total) FROM credit_notes cn
                        WHERE cn.party_id = $1 AND cn.wholesaler_id = $2
                          AND cn.issue_date < $3::date
                          AND (cn.sale_id IS NULL OR EXISTS (
                                SELECT 1 FROM sales s2 WHERE s2.id = cn.sale_id
                                  AND s2.status IN ('confirmed', 'delivered')))
                       ), 0) AS credited`,
          [id, wholesalerId, from],
        )
      : null;

    /**
     * What he owed when the window opens.
     *
     * Two things were missing and both made the statement disagree with the
     * customer's own page, which is the one thing a statement must never do.
     *
     * The party's OPENING BALANCE, what he already owed before this book
     * began, was left out entirely, so a customer carried over from an old
     * ledger got a statement short by that amount.
     *
     * And CREDIT NOTES before the window were not deducted, for the same
     * reason they were missing from the balance itself.
     */
    const openingPaise = opening
      ? toPaise(opening.rows[0].billed)
        - toPaise(opening.rows[0].received)
        - toPaise(opening.rows[0].credited || 0)
        + (hasOpening ? toPaise(party.rows[0].opening_balance || 0) : 0)
      : (hasOpening ? toPaise(party.rows[0].opening_balance || 0) : 0);

    const [sales, payments, creditNotes, marketOrders] = await Promise.all([
      pool.query(
        `SELECT s.id, s.sale_number, s.sale_date AS on_date, s.total, s.created_at,
                (SELECT COUNT(*) FROM sale_lines sl WHERE sl.sale_id = s.id) AS line_count
           FROM sales s
          WHERE s.party_id = $1 AND s.wholesaler_id = $2
            AND s.status IN ('confirmed', 'delivered')
            AND ($3::date IS NULL OR s.sale_date >= $3::date)
            AND ($4::date IS NULL OR s.sale_date <= $4::date)
          ORDER BY s.sale_date ASC, s.created_at ASC`,
        [id, wholesalerId, from, to],
      ),
      pool.query(
        `SELECT pp.id, pp.amount, pp.method, pp.paid_on AS on_date, pp.note,
                pp.created_at, s.sale_number, s.status AS sale_status
           FROM party_payments pp
           LEFT JOIN sales s ON s.id = pp.sale_id
          WHERE pp.party_id = $1 AND pp.wholesaler_id = $2
            AND ($3::date IS NULL OR pp.paid_on >= $3::date)
            AND ($4::date IS NULL OR pp.paid_on <= $4::date)
          ORDER BY pp.paid_on ASC, pp.created_at ASC`,
        [id, wholesalerId, from, to],
      ),
      // Credit notes inside the window, which reduce what he owes. Listed as
      // their own kind rather than folded into payments, because returned
      // goods and cash handed over are different events and a customer
      // reading his own statement needs to tell them apart.
      pool.query(
        `SELECT cn.id, cn.note_number, cn.issue_date AS on_date,
                cn.grand_total, cn.reason, cn.created_at
           FROM credit_notes cn
          WHERE cn.party_id = $1 AND cn.wholesaler_id = $2
            -- A note against a cancelled sale is left off, because that sale
            -- is not on the statement either: listing the reversal of a bill
            -- the customer was never shown reads as a credit from nowhere.
            AND (cn.sale_id IS NULL OR EXISTS (
                  SELECT 1 FROM sales s2 WHERE s2.id = cn.sale_id
                    AND s2.status IN ('confirmed', 'delivered')))
            AND ($3::date IS NULL OR cn.issue_date >= $3::date)
            AND ($4::date IS NULL OR cn.issue_date <= $4::date)
          ORDER BY cn.issue_date ASC, cn.created_at ASC`,
        [id, wholesalerId, from, to],
      ),
      // Orders the customer placed through the shop. They read as a line on
      // the statement exactly like a sale does, because to the man being
      // billed they are the same thing: goods they took and owes for.
      hasOrders
        ? pool.query(
            `SELECT o.id, o.order_number, o.created_at::date AS on_date,
                    o.total_amount AS total, o.created_at,
                    (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS line_count
               FROM orders o
              WHERE o.party_id = $1 AND o.supplier_id = $2
                AND o.status NOT IN (${NOT_OWED_SQL})
                -- Once accepted it appears as its sale instead, so listing it
                -- here as well would show the customer the same goods twice.
                ${bridgedGuard(hasBridge)}
                AND ($3::date IS NULL OR o.created_at::date >= $3::date)
                AND ($4::date IS NULL OR o.created_at::date <= $4::date)
              ORDER BY o.created_at ASC`,
            [id, wholesalerId, from, to],
          )
        : { rows: [] },
    ]);

    const entries = [
      ...sales.rows.map((row) => ({
        kind: "sale",
        id: row.id,
        date: row.on_date,
        createdAt: row.created_at,
        ref: row.sale_number,
        lineCount: Number(row.line_count),
        debitPaise: toPaise(row.total),
        creditPaise: 0,
      })),
      ...marketOrders.rows.map((row) => ({
        // Marked as an order rather than a sale so the screen can say where
        // it came from. A customer looking at their own statement should be
        // able to recognise the order they placed on their phone.
        kind: "order",
        id: row.id,
        date: row.on_date,
        createdAt: row.created_at,
        ref: row.order_number,
        lineCount: Number(row.line_count),
        debitPaise: toPaise(row.total),
        creditPaise: 0,
      })),
      ...creditNotes.rows.map((row) => ({
        kind: "credit_note",
        id: row.id,
        date: row.on_date,
        createdAt: row.created_at,
        ref: row.note_number,
        note: row.reason,
        debitPaise: 0,
        creditPaise: toPaise(row.grand_total),
      })),
      ...payments.rows.map((row) => ({
        kind: "payment",
        id: row.id,
        date: row.on_date,
        createdAt: row.created_at,
        ref: row.sale_number,
        method: row.method,
        note: row.note,
        // Worth saying on the line. Money against a bill that was later
        // cancelled is why a customer can end up in credit, and without this
        // the statement looks like a payment against nothing.
        againstCancelled: row.sale_status === "cancelled",
        debitPaise: 0,
        creditPaise: toPaise(row.amount),
      })),
    ].sort(
      (a, b) =>
        new Date(a.date) - new Date(b.date) ||
        new Date(a.createdAt) - new Date(b.createdAt),
    );

    let runningPaise = openingPaise;
    let billedPaise = 0;
    let receivedPaise = 0;
    const rows = entries.map((entry) => {
      runningPaise += entry.debitPaise - entry.creditPaise;
      billedPaise += entry.debitPaise;
      receivedPaise += entry.creditPaise;
      return {
        kind: entry.kind,
        id: entry.id,
        date: entry.date,
        ref: entry.ref,
        lineCount: entry.lineCount,
        method: entry.method,
        note: entry.note,
        againstCancelled: entry.againstCancelled,
        debit: fromPaise(entry.debitPaise),
        credit: fromPaise(entry.creditPaise),
        balance: fromPaise(runningPaise),
      };
    });

    return {
      statement: {
        party: party.rows[0],
        from: from || null,
        to: to || null,
        openingBalance: fromPaise(openingPaise),
        rows,
        totals: {
          billed: fromPaise(billedPaise),
          received: fromPaise(receivedPaise),
        },
        closingBalance: fromPaise(runningPaise),
      },
    };
  }
};

exports.getPartyStatement = async (req, res) => {
  try {
    const result = await buildStatement(
      req.params.id,
      businessId(req),
      req.query.from,
      req.query.to,
    );
    if (result.error) {
      return res.status(result.error.status).json({ message: result.error.message });
    }
    res.status(200).json(result.statement);
  } catch (err) {
    console.error("Error building statement:", err);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * The same statement as a document, so it can be handed over or sent on.
 */
exports.getPartyStatementPDF = async (req, res) => {
  const wholesalerId = businessId(req);
  try {
    const result = await buildStatement(
      req.params.id,
      wholesalerId,
      req.query.from,
      req.query.to,
    );
    if (result.error) {
      return res.status(result.error.status).json({ message: result.error.message });
    }

    const supplier = await pool.query(
      `SELECT u.first_name, u.last_name, u.email, u.phone,
              wp.company_name, wp.gstin, wp.city
         FROM users u
         LEFT JOIN wholesaler_profiles wp ON wp.user_id = u.id
        WHERE u.id = $1`,
      [wholesalerId],
    );

    await pdfService.generateStatementPDF(
      result.statement,
      supplier.rows[0] || {},
      res,
    );
  } catch (err) {
    console.error("Error generating statement PDF:", err);
    res.status(500).json({ message: "Could not generate the statement" });
  }
};

/**
 * Headline numbers for the customer book. Every value here is computed from
 * real rows. A wholesaler with no data sees zeroes, which is the truth.
 */
exports.getPartyStats = async (req, res) => {
  const wholesalerId = businessId(req);

  try {
    // This carried a third copy of the balance rule, with the same fault the
    // Overview had: billed from sales alone, less every payment including
    // money taken through the shop. It now reads the one rule, and asks for
    // what is owed per customer rather than netting the whole book, so a
    // customer in credit cannot cancel out another customer's debt.
    const hasOrderParty = await hasPartyLink(pool);
    const hasBridge = await hasSaleLink(pool);
    const hasOpening = await hasOpeningBalance(pool);

    /**
     * Billed and received read the one rule as well, not just the balance.
     *
     * These two were still counting sales alone, while "still to collect"
     * beside them counted shop orders too. A wholesaler with an order they had
     * not accepted yet read "Total billed 0" next to "Still to collect 710" on
     * the same header: nothing billed, 710 to go and get. Both true under
     * their own sums, and together nonsense.
     */
    const totals = totalsExpression({ hasOrderParty, hasBridge });

    const [result, collect] = await Promise.all([
      pool.query(
        `SELECT
           (SELECT COUNT(*) FROM parties
             WHERE wholesaler_id = $1 AND status = 'active') AS active_parties,
           (SELECT COUNT(*) FROM parties WHERE wholesaler_id = $1) AS total_parties,
           ${totals.billed} AS total_billed,
           ${totals.received} AS total_received`,
        [wholesalerId],
      ),
      pool.query(collectionTotals({ hasOrderParty, hasBridge, hasOpening }), [wholesalerId]),
    ]);

    const row = result.rows[0];
    res.status(200).json({
      activeParties: Number(row.active_parties),
      totalParties: Number(row.total_parties),
      totalBilled: Number(row.total_billed),
      totalReceived: Number(row.total_received),
      outstanding: Number(collect.rows[0].owed_to_you),
      owedBack: Number(collect.rows[0].owed_by_you),
    });
  } catch (err) {
    console.error("Error fetching party stats:", err);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * The credit this customer has, and what it could be set against.
 *
 * See services/creditApplyService.js for what a credit is and why setting it
 * against an order is a re-addressing of money rather than a new payment.
 */
exports.getCreditOffer = async (req, res) => {
  try {
    const party = await pool.query(
      "SELECT id FROM parties WHERE id = $1 AND wholesaler_id = $2",
      [req.params.id, businessId(req)],
    );
    if (party.rows.length === 0) {
      return res.status(404).json({ message: "Customer not found" });
    }
    res.status(200).json(await creditApplyService.offer(req.params.id, businessId(req)));
  } catch (err) {
    console.error("Error reading a customer's credit:", err);
    res.status(500).json({ message: "Server error" });
  }
};

const CREDIT_REASONS = {
  notFound: [404, "That sale is not on this customer's account"],
  noCredit: [400, "You are not holding any of this customer's money"],
  settled: [400, "That sale is already paid"],
  dead: [400, "That sale is cancelled or still a draft"],
  nothing: [400, "There is nothing to set against it"],
};

exports.applyCredit = async (req, res) => {
  const wholesalerId = businessId(req);
  const { saleId, amount } = req.body || {};

  if (!clean(saleId)) {
    return res.status(400).json({ message: "Choose what to set it against" });
  }

  try {
    const party = await pool.query(
      "SELECT id FROM parties WHERE id = $1 AND wholesaler_id = $2",
      [req.params.id, wholesalerId],
    );
    if (party.rows.length === 0) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const result = await creditApplyService.apply(
      req.params.id,
      wholesalerId,
      clean(saleId),
      amount === undefined || amount === null || amount === "" ? null : Number(amount),
    );

    if (result.error) {
      const [status, message] = CREDIT_REASONS[result.error] || [400, "Could not set this credit"];
      return res.status(status).json({ message, code: result.error });
    }

    // The sale may now be settled, in which case the bill follows, exactly as
    // it does when cash comes in. Best effort: the money has moved and that is
    // what matters, a stale bill is recoverable.
    try {
      await saleInvoiceService.billIfSettled(clean(saleId), wholesalerId);
      await saleInvoiceService.syncInvoiceFromLedger(clean(saleId));
    } catch (billErr) {
      console.error("Could not refresh the bill after setting credit:", billErr.message);
    }

    res.status(200).json(result);
  } catch (err) {
    console.error("Error setting a customer's credit:", err);
    res.status(500).json({ message: "Server error" });
  }
};

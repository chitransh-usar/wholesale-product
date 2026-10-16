const pool = require("../config/db");
const invoiceRepository = require("../repositories/invoiceRepository");
const { receivedOn } = require("./saleSettlement");
const { nextChallanNumber } = require("./seriesNumbers");
const { fromPaise } = require("../utils/money");

/**
 * Raising a challan FROM a sale that is already in the book.
 *
 * SUPERSEDED IN PART, 17 SEPT 2026. This file was built on 10 Sept around a
 * rule that no longer holds: that an unpaid sale gets a challan INSTEAD of a
 * tax invoice, and the invoice waits for the money. The challan has since
 * been rebuilt as a movement document in services/challanBook.js, the way
 * Marg, Tally and Busy all have it, and `invoiceWaitsForPayment()` below now
 * defaults OFF.
 *
 * That reversal also fixed the part that was never compliant. Section 31(1)
 * ties the tax invoice to REMOVAL of the goods, not to payment, so holding it
 * back understated outward supply in GSTR-1 and left the customer unable to
 * claim input credit.
 *
 * WHAT IS STILL LIVE HERE, and why it was not deleted: sending goods out
 * against a sale that has ALREADY been recorded. That is a real thing and the
 * order screen reaches it too. It just no longer asks whether anybody has
 * paid. A new challan typed from scratch, in either direction, goes through
 * challanBook instead.
 *
 * Rule 55 challans cover movement that is NOT a supply: job work, goods on
 * approval, quantity unknown at removal. Nothing here is written as one,
 * which is why every row carries is_rule_55 false and the printed document
 * says in plain words that it is not a tax invoice.
 */

const REASONS = new Set([
  "payment_pending",
  "job_work",
  "on_approval",
  "quantity_unknown",
  "other",
]);

/**
 * Does an unpaid sale HOLD BACK its tax invoice?
 *
 * DEFAULTS OFF SINCE 17 SEPT 2026, which is a reversal of what this file was
 * built for. The challan was rebuilt as a movement document, the way Marg,
 * Tally and Busy all have it: goods moved, so a challan exists, and whether
 * anybody has paid has nothing to do with it. See services/challanBook.js.
 *
 * Holding the invoice back was also the part that was never compliant.
 * Section 31(1) ties the invoice to REMOVAL of the goods, not to payment, so
 * waiting for money understated outward supply in GSTR-1 and left the
 * customer unable to claim input credit. Defaulting it off fixes that.
 *
 * Kept as a flag rather than deleted because a wholesaler already running
 * this way may want the old behaviour until they have re-trained their
 * counter: CHALLAN_WHEN_UNPAID=true restores it exactly.
 *
 * NOTE the name. This decides ONE thing, whether the invoice waits. It no
 * longer decides whether challans exist at all, which is why challanBook
 * checks nothing.
 */
const invoiceWaitsForPayment = () =>
  String(process.env.CHALLAN_WHEN_UNPAID ?? "false").toLowerCase() === "true";

/**
 * Kept under its old name for the callers that ask "are challans available",
 * which is a different question and is now answered by the tables existing.
 */
const challanEnabled = () => true;

/** Does this database have the tables yet? Cached, like every other probe. */
let ready = null;
const challanTablesExist = async (db = pool) => {
  if (ready !== null) return ready;
  try {
    const probe = await db.query(
      "SELECT to_regclass('public.delivery_challans') IS NOT NULL AS yes",
    );
    ready = Boolean(probe.rows[0]?.yes);
  } catch {
    ready = false;
  }
  return ready;
};
const resetChallanTables = () => {
  ready = null;
  hasStatusColumn = false;
  hasLineExtrasColumn = false;
};

/**
 * Does this database have delivery_challans.status yet?
 *
 * It arrives with wholesale3_challans_two_kinds.sql. Without it the stampers
 * set invoice_id alone, exactly as they did before, rather than failing on a
 * column that is not there.
 *
 * ONLY A TRUE ANSWER IS CACHED, and that is the whole point.
 *
 * Migrations here are run by hand against a database the server is already
 * connected to. Caching a false would pin "the column is not there" for the
 * life of the process, so a wholesaler who runs the migration would see no
 * change until somebody restarted the server, with nothing on any screen
 * saying that is what was needed. A probe on a column that does not exist yet
 * is cheap, and it stops being asked the moment the answer becomes yes.
 */
let hasStatusColumn = false;
const hasStatus = async (db = pool) => {
  if (hasStatusColumn) return true;
  try {
    const { rows } = await db.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'delivery_challans' AND column_name = 'status'`);
    hasStatusColumn = rows.length > 0;
  } catch {
    return false;
  }
  return hasStatusColumn;
};

/**
 * The line columns that arrive with wholesale3_challans_two_kinds.sql.
 *
 * Same rule as above, only a true answer is cached. These are read back into
 * the edit form, so without them opening a challan and saving it again
 * silently dropped the GST rate off every line and, once the picker existed,
 * the product link with it.
 */
let hasLineExtrasColumn = false;
const hasLineExtras = async (db = pool) => {
  if (hasLineExtrasColumn) return true;
  try {
    const { rows } = await db.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'delivery_challan_items' AND column_name = 'product_id'`);
    hasLineExtrasColumn = rows.length > 0;
  } catch {
    return false;
  }
  return hasLineExtrasColumn;
};

/**
 * The next number in this wholesaler's own challan run.
 *
 * Its own series, not the invoice run. Gaps in the invoice series look like
 * missing bills, and the two documents are counted separately.
 *
 * Must be called inside a transaction: the upsert locks the row until commit.
 */

/**
 * What has been received against a sale, and what it comes to.
 *
 * The rule lives in services/saleSettlement.js, which explains why it is not
 * the sum of the two places money sits and not the greater of them either.
 * This used to keep its own copy taking the greater, which swallowed cash the
 * wholesaler took at the counter and typed into the khata.
 */
const settlementOf = async (db, sale) => {
  const received = fromPaise(await receivedOn(db, sale));
  const total = Number(sale.total || 0);
  // A paisa of slack. Money is stored to two places and a 50/50 split of an
  // odd total can land a paisa out; refusing to bill over that would strand
  // a sale nobody can settle.
  return { total, received, settled: received >= total - 0.01 && total > 0 };
};

class ChallanService {
  /**
   * Raise a challan for a sale whose money has not fully arrived.
   *
   * Returns { challan, created } or { error } with one of:
   *   notReady   the migration has not been run
   *   notFound   the sale is not this wholesaler's
   *   cancelled  a cancelled sale has nothing to send out
   *   draft      confirm it first, same rule as billing
   *   empty      no lines
   *   reason     the reason given is not one this module knows
   */
  async createChallanForSale(saleId, wholesalerId, reason = "payment_pending", reasonNote = null) {
    if (!(await challanTablesExist())) return { error: "notReady" };
    if (!REASONS.has(reason)) return { error: "reason" };

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const found = await client.query(
        `SELECT s.*, p.id AS party_id, p.name AS party_name,
                p.business_name AS party_business_name, p.gstin AS party_gstin,
                p.city AS party_city, p.address AS party_address,
                p.phone AS party_phone
           FROM sales s
           JOIN parties p ON p.id = s.party_id
          WHERE s.id = $1 AND s.wholesaler_id = $2`,
        [saleId, wholesalerId],
      );
      const sale = found.rows[0];
      if (!sale) {
        await client.query("ROLLBACK");
        return { error: "notFound" };
      }
      if (sale.status === "cancelled") {
        await client.query("ROLLBACK");
        return { error: "cancelled" };
      }
      if (sale.status === "draft") {
        await client.query("ROLLBACK");
        return { error: "draft" };
      }

      const lines = await client.query(
        `SELECT item_name, quantity, unit, rate, amount, hsn_code
           FROM sale_lines WHERE sale_id = $1 ORDER BY created_at ASC`,
        [saleId],
      );
      if (lines.rows.length === 0) {
        await client.query("ROLLBACK");
        return { error: "empty" };
      }

      // The money is read for the SNAPSHOT the document carries, not as a
      // gate. It used to refuse a settled sale, on the old rule that a
      // challan was what an unpaid sale got instead of a bill. Goods going
      // out of the gate has nothing to do with whether they have been paid
      // for, and a wholesaler who takes the money and then sends the lorry
      // still needs a note to send with it.
      const money = await settlementOf(client, sale);

      const challanNumber = await nextChallanNumber(client, wholesalerId);

      const created = await client.query(
        `INSERT INTO delivery_challans
           (wholesaler_id, sale_id, order_id, party_id, challan_number,
            reason, reason_note, is_rule_55, total_value, amount_paid,
            recipient_name, recipient_gstin, recipient_city,
            recipient_address, recipient_phone, issue_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,FALSE,$8,$9,$10,$11,$12,$13,$14,CURRENT_DATE)
         RETURNING *`,
        [
          wholesalerId,
          sale.id,
          sale.order_id || null,
          sale.party_id,
          challanNumber,
          reason,
          reasonNote,
          money.total,
          money.received,
          // The firm first, the person as the fallback. Same rule the invoice
          // follows, so the two documents name the customer identically.
          sale.party_business_name || sale.party_name,
          sale.party_gstin,
          sale.party_city,
          sale.party_address,
          sale.party_phone,
        ],
      );
      const challan = created.rows[0];

      for (const line of lines.rows) {
        await client.query(
          `INSERT INTO delivery_challan_items
             (challan_id, item_name, hsn_code, quantity, unit, unit_price, total)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            challan.id,
            line.item_name,
            line.hsn_code,
            line.quantity,
            line.unit,
            line.rate,
            line.amount,
          ],
        );
      }

      /**
       * Goods going out against a sale that has ALREADY been billed.
       *
       * Ordinary now that the invoice no longer waits for payment: a sale is
       * recorded and billed at the counter, and the lorry leaves on Thursday.
       * Such a challan is born billed, pointing at the bill that already
       * covers it. Left pending it would sit in "not billed yet" for ever and,
       * worse, be offered up for billing a second time on the sale form.
       */
      const already = await client.query(
        `SELECT id FROM invoices WHERE sale_id = $1 LIMIT 1`, [sale.id]);
      if (already.rows.length > 0 && (await hasStatus(client))) {
        await client.query(
          `UPDATE delivery_challans SET invoice_id = $2, status = 'billed'
            WHERE id = $1`, [challan.id, already.rows[0].id]);
        challan.invoice_id = already.rows[0].id;
        challan.status = "billed";
      }

      await client.query("COMMIT");
      return { challan, created: true };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * The same thing, reached from the order rather than the sale.
   *
   * A shop order writes a sale when it is accepted, and that sale is what
   * carries the lines and the money. So this finds it and delegates: the
   * challan belongs to the sale either way, and a wholesaler looking at an
   * order should not have to go and find the sale first.
   *
   * Extra error: `noSale`, for an order that has not been accepted yet and so
   * has nothing in the book to send out against.
   */
  async createChallanForOrder(orderId, wholesalerId, reason = "payment_pending", reasonNote = null) {
    if (!(await challanTablesExist())) return { error: "notReady" };

    const saleId = await this.saleIdForOrder(orderId, wholesalerId);
    if (!saleId) return { error: "noSale" };

    return this.createChallanForSale(saleId, wholesalerId, reason, reasonNote);
  }

  /**
   * The sale an order wrote when it was accepted, if it has one.
   *
   * An order that is still waiting on the wholesaler has nothing in the book
   * behind it, so there is nothing to send goods out against. The order screen
   * asks this so it knows whether to offer the button at all.
   */
  async saleIdForOrder(orderId, wholesalerId) {
    const found = await pool.query(
      "SELECT id FROM sales WHERE order_id = $1 AND wholesaler_id = $2",
      [orderId, wholesalerId],
    );
    return found.rows.length > 0 ? found.rows[0].id : null;
  }

  /** Every challan against an order, through its sale. */
  async listForOrder(orderId, wholesalerId) {
    if (!(await challanTablesExist())) return [];
    // Same reason as listForSale: status is the authority on billed, and
    // invoice_id alone answers it wrongly for a challan closed by a sale.
    const withStatus = await hasStatus();
    const rows = await pool.query(
      `SELECT dc.id, dc.challan_number, dc.issue_date, dc.total_value,
              dc.amount_paid, dc.invoice_id${withStatus ? ", dc.status" : ""}
         FROM delivery_challans dc
        WHERE dc.wholesaler_id = $1
          AND (dc.order_id = $2
               OR dc.sale_id IN (SELECT id FROM sales WHERE order_id = $2))
        ORDER BY dc.created_at DESC`,
      [wholesalerId, orderId],
    );
    return rows.rows;
  }

  /**
   * Is this order settled, and what is outstanding?
   *
   * Read off the order rather than the sale, because that is where a shop
   * payment lands and it is the figure the order screen already shows.
   */
  async settlementForOrder(orderId, wholesalerId) {
    const found = await pool.query(
      `SELECT total_amount, COALESCE(amount_paid, 0) AS amount_paid
         FROM orders WHERE id = $1 AND supplier_id = $2`,
      [orderId, wholesalerId],
    );
    if (found.rows.length === 0) return null;
    const total = Number(found.rows[0].total_amount || 0);
    const received = Number(found.rows[0].amount_paid || 0);
    return { total, received, settled: received >= total - 0.01 && total > 0 };
  }

  /** One challan with its lines, scoped to its owner. */
  async findById(challanId, wholesalerId) {
    if (!(await challanTablesExist())) return null;
    const found = await pool.query(
      `SELECT dc.*, s.sale_number, o.order_number
         FROM delivery_challans dc
         LEFT JOIN sales s ON s.id = dc.sale_id
         LEFT JOIN orders o ON o.id = dc.order_id
        WHERE dc.id = $1 AND dc.wholesaler_id = $2`,
      [challanId, wholesalerId],
    );
    if (found.rows.length === 0) return null;

    // Two separate strings rather than one with a conditional column list,
    // because Postgres parses the whole statement before it runs any of it. A
    // CASE or a COALESCE naming product_id still fails on a database that has
    // not had the migration, which is the mistake this file already made once
    // with `status`.
    const items = (await hasLineExtras())
      ? await pool.query(
          `SELECT item_name, hsn_code, quantity, unit, unit_price, total,
                  gst_percent, cess_percent, product_id
             FROM delivery_challan_items WHERE challan_id = $1 ORDER BY id`,
          [challanId],
        )
      : await pool.query(
          `SELECT item_name, hsn_code, quantity, unit, unit_price, total
             FROM delivery_challan_items WHERE challan_id = $1 ORDER BY id`,
          [challanId],
        );

    const supplier = await pool.query(
      `SELECT u.first_name, u.last_name, u.email, u.phone,
              wp.company_name, wp.gstin, wp.city, wp.warehouse_state,
              wp.warehouse_address, wp.contact_phone
         FROM users u
         LEFT JOIN wholesaler_profiles wp ON wp.user_id = u.id
        WHERE u.id = $1`,
      [wholesalerId],
    );

    return {
      ...found.rows[0],
      items: items.rows,
      supplier: supplier.rows[0] || {},
    };
  }

  /**
   * Every challan raised against one sale, newest first.
   *
   * `status` comes back where the column exists, because invoice_id alone is
   * not the answer to "is this billed". A challan billed through a SALE gets
   * status 'billed' and a sale_id and never an invoice_id, so a screen
   * reading invoice_id showed no badge at all on a challan the sale it is
   * sitting on had just closed. Two separate strings rather than one with a
   * conditional column: Postgres parses before it runs.
   */
  async listForSale(saleId, wholesalerId) {
    if (!(await challanTablesExist())) return [];
    const rows = (await hasStatus())
      ? await pool.query(
          `SELECT id, challan_number, issue_date, total_value, amount_paid,
                  invoice_id, status
             FROM delivery_challans
            WHERE sale_id = $1 AND wholesaler_id = $2
            ORDER BY created_at DESC`,
          [saleId, wholesalerId],
        )
      : await pool.query(
          `SELECT id, challan_number, issue_date, total_value, amount_paid, invoice_id
             FROM delivery_challans
            WHERE sale_id = $1 AND wholesaler_id = $2
            ORDER BY created_at DESC`,
          [saleId, wholesalerId],
        );
    return rows.rows;
  }

  /** This wholesaler's challans, newest first. */
  async list(wholesalerId, limit = 100) {
    if (!(await challanTablesExist())) return [];
    const rows = await pool.query(
      `SELECT dc.id, dc.challan_number, dc.issue_date, dc.total_value,
              dc.amount_paid, dc.invoice_id, dc.recipient_name,
              s.sale_number, o.order_number
         FROM delivery_challans dc
         LEFT JOIN sales s ON s.id = dc.sale_id
         LEFT JOIN orders o ON o.id = dc.order_id
        WHERE dc.wholesaler_id = $1
        ORDER BY dc.created_at DESC
        LIMIT $2`,
      [wholesalerId, limit],
    );
    return rows.rows;
  }

  /**
   * Is this sale fully paid, and may it therefore be invoiced?
   *
   * The one question the invoice services ask before raising a bill, kept
   * here so the rule lives in one place and switching the flag off changes
   * one function rather than three.
   */
  async settlementForSale(saleId, wholesalerId, db = pool) {
    const found = await db.query(
      "SELECT id, total, order_id FROM sales WHERE id = $1 AND wholesaler_id = $2",
      [saleId, wholesalerId],
    );
    if (found.rows.length === 0) return null;
    return settlementOf(db, found.rows[0]);
  }

  /**
   * Point a challan at the bill that finally superseded it.
   *
   * Called when the money lands and the invoice is raised, so the challan
   * stops looking outstanding. Every challan against the sale is stamped:
   * goods that went out in three lorries are billed by one invoice.
   */
  async markInvoiced(client, saleId, invoiceId) {
    if (!(await challanTablesExist(client))) return 0;
    /**
     * Two statements, not one with a CASE.
     *
     * `SET status = CASE WHEN $3 THEN ... END` looks like it guards the column
     * but does not: Postgres PARSES the whole statement before it runs, so a
     * database without wholesale3_challans_two_kinds.sql answered
     * `column "status" does not exist` however the flag was set. Migrations
     * here are applied by hand, so degrading properly is not optional.
     */
    const withStatus = await hasStatus(client);
    const done = await client.query(
      withStatus
        ? `UPDATE delivery_challans
              SET invoice_id = $2, status = 'billed', updated_at = CURRENT_TIMESTAMP
            WHERE sale_id = $1 AND invoice_id IS NULL`
        : `UPDATE delivery_challans
              SET invoice_id = $2, updated_at = CURRENT_TIMESTAMP
            WHERE sale_id = $1 AND invoice_id IS NULL`,
      [saleId, invoiceId],
    );
    return done.rowCount;
  }

  /**
   * The same, reached from the order.
   *
   * A shop order raises its own bill, from invoiceService, which knows nothing
   * about sales and so never stamped anything. So goods that went out on a
   * challan against an order stayed "Not billed" on the Challans screen for
   * ever, long after the bill for the same goods existed. Caught by
   * flow_check, walking one order the whole way through.
   *
   * Matched both ways, because a challan can be written with an order_id or
   * with the sale_id of the sale behind that order depending on which screen
   * raised it, and both describe the same goods.
   */
  async markInvoicedForOrder(client, orderId, invoiceId) {
    if (!orderId || !invoiceId) return 0;
    if (!(await challanTablesExist(client))) return 0;
    // Two statements for the same reason as markInvoiced above.
    const withStatus = await hasStatus(client);
    const done = await client.query(
      withStatus
        ? `UPDATE delivery_challans
              SET invoice_id = $2, status = 'billed', updated_at = CURRENT_TIMESTAMP
            WHERE invoice_id IS NULL
              AND (order_id = $1
                   OR sale_id IN (SELECT id FROM sales WHERE order_id = $1))`
        : `UPDATE delivery_challans
              SET invoice_id = $2, updated_at = CURRENT_TIMESTAMP
            WHERE invoice_id IS NULL
              AND (order_id = $1
                   OR sale_id IN (SELECT id FROM sales WHERE order_id = $1))`,
      [orderId, invoiceId],
    );
    return done.rowCount;
  }
}

module.exports = new ChallanService();
module.exports.challanEnabled = challanEnabled;
module.exports.invoiceWaitsForPayment = invoiceWaitsForPayment;
module.exports.challanTablesExist = challanTablesExist;
module.exports.resetChallanTables = resetChallanTables;
module.exports.settlementOf = settlementOf;
module.exports.REASONS = REASONS;

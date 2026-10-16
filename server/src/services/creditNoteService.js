const pool = require("../config/db");

/**
 * Credit notes: the correct way to reverse a bill that has already been
 * issued.
 *
 * Marking an invoice Cancelled is only defensible while it is still sitting
 * on the wholesaler's own screen. Once the bill has gone to the customer, or
 * the month's return has been filed, the invoice is a fact and stays a fact.
 * What reverses it is a separate document with its own number, referring back
 * to the invoice it credits, which both sides put in their books.
 *
 * Every note this module raises reverses the WHOLE invoice. That covers the
 * two things a wholesaler hits first, a cancelled sale and a full return.
 * Part returns and rate corrections need a quantity per line and are not built
 * yet, so the API refuses them rather than guessing at the tax.
 *
 * The customer's running balance is not touched here. That balance is billed
 * minus received, and cancelling the sale is what takes the amount out of
 * "billed". The credit note is the tax document that explains why, and
 * double counting it would swing the khata twice for one event.
 */

const REASONS = new Set([
  "sale_cancelled",
  "goods_returned",
  "rate_revised",
  "other",
]);

/**
 * Takes the next number in this wholesaler's own credit note series. Must be
 * called inside a transaction: the upsert locks the sequence row until commit.
 *
 * No year in the number, matching the sale series. A year would have to reset
 * the count to mean anything, and a series that resets can hand out a number
 * that was already used if the reset ever runs late.
 */
const nextNoteNumber = async (client, wholesalerId) => {
  const result = await client.query(
    `INSERT INTO credit_note_sequences (wholesaler_id, last_number)
     VALUES ($1, 1)
     ON CONFLICT (wholesaler_id)
     DO UPDATE SET last_number = credit_note_sequences.last_number + 1
     RETURNING last_number`,
    [wholesalerId],
  );
  return `CN-${String(result.rows[0].last_number).padStart(4, "0")}`;
};

class CreditNoteService {
  /**
   * Reverses one invoice in full.
   *
   * Returns { creditNote } on success, or { error } with one of:
   *   notFound   the invoice is not this wholesaler's
   *   cancelled  the invoice was voided, so there is nothing to reverse
   *   exists     a credit note has already been raised against it
   *   reason     the reason given is not one this module knows
   *
   * Safe to call from inside a caller's transaction by passing its client,
   * which is how cancelling a sale raises one atomically.
   */
  async createCreditNote(
    { invoiceId, wholesalerId, reason = "sale_cancelled", reasonNote = null, issueDate = null },
    externalClient = null,
  ) {
    if (!REASONS.has(reason)) return { error: "reason" };

    const client = externalClient || (await pool.connect());
    const ownsTransaction = !externalClient;

    try {
      if (ownsTransaction) await client.query("BEGIN");

      // FOR UPDATE so two clicks on the same button cannot both get past the
      // "already credited" check and mint two notes for one invoice. The
      // unique index would catch the second, but as a 500 rather than a
      // sentence the wholesaler can read.
      const invoiceRow = await client.query(
        `SELECT i.*, s.sale_number, s.status AS sale_status
           FROM invoices i
           LEFT JOIN sales s ON s.id = i.sale_id
          WHERE i.id = $1 AND i.supplier_id = $2
          FOR UPDATE OF i`,
        [invoiceId, wholesalerId],
      );
      if (invoiceRow.rows.length === 0) {
        if (ownsTransaction) await client.query("ROLLBACK");
        return { error: "notFound" };
      }
      const invoice = invoiceRow.rows[0];

      if (String(invoice.invoice_status).toLowerCase() === "cancelled") {
        if (ownsTransaction) await client.query("ROLLBACK");
        return { error: "cancelled" };
      }

      const already = await client.query(
        "SELECT note_number FROM credit_notes WHERE invoice_id = $1",
        [invoiceId],
      );
      if (already.rows.length > 0) {
        if (ownsTransaction) await client.query("ROLLBACK");
        return { error: "exists", noteNumber: already.rows[0].note_number };
      }

      const lines = await this.buildLines(invoiceId, invoice.sale_id, client);
      const noteNumber = await nextNoteNumber(client, wholesalerId);

      const note = await client.query(
        `INSERT INTO credit_notes
           (wholesaler_id, invoice_id, sale_id, party_id, note_number,
            reason, reason_note,
            recipient_name, recipient_gstin, recipient_city,
            recipient_address, recipient_phone,
            subtotal, discount, taxable_amount,
            cgst, sgst, igst, total_tax, grand_total, issue_date)
         VALUES ($1, $2, $3, $4, $5,
                 $6, $7,
                 $8, $9, $10,
                 $11, $12,
                 $13, $14, $15,
                 $16, $17, $18, $19, $20, COALESCE($21::date, CURRENT_DATE))
         RETURNING *`,
        [
          wholesalerId,
          invoiceId,
          invoice.sale_id,
          invoice.party_id,
          noteNumber,
          reason,
          reasonNote,
          // Copied from the invoice, not looked up fresh. The credit note has
          // to name the same recipient the invoice named, even if the
          // customer's details have been edited since.
          invoice.recipient_name,
          invoice.recipient_gstin,
          invoice.recipient_city,
          invoice.recipient_address,
          invoice.recipient_phone,
          invoice.subtotal,
          invoice.discount,
          invoice.taxable_amount,
          invoice.cgst,
          invoice.sgst,
          invoice.igst,
          invoice.total_tax,
          invoice.grand_total,
          issueDate,
        ],
      );
      const creditNote = note.rows[0];

      for (const line of lines) {
        await client.query(
          `INSERT INTO credit_note_items
             (credit_note_id, item_name, hsn_code, quantity, unit,
              unit_price, gst_percent, tax_amount, total)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            creditNote.id,
            line.itemName,
            line.hsnCode,
            line.quantity,
            line.unit,
            line.unitPrice,
            line.gstPercent,
            line.taxAmount,
            line.total,
          ],
        );
      }

      // Written to the invoice's own log so the note shows up in the history
      // on the invoice it reverses, not only on its own page.
      await client.query(
        `INSERT INTO invoice_logs (invoice_id, action, performed_by, details)
         VALUES ($1, 'Credited', $2, $3)`,
        [
          invoiceId,
          wholesalerId,
          `Credit note ${noteNumber} raised against ${invoice.invoice_number} for the full amount`,
        ],
      );

      if (ownsTransaction) await client.query("COMMIT");

      return { creditNote: { ...creditNote, items: lines, invoice_number: invoice.invoice_number } };
    } catch (err) {
      if (ownsTransaction) await client.query("ROLLBACK");
      throw err;
    } finally {
      if (ownsTransaction) client.release();
    }
  }

  /**
   * The lines to credit, which are the lines that were billed.
   *
   * invoice_items is the record of what went on the bill, so it is the source
   * for the tax figures. Its quantity column is an INTEGER, though, so a sale
   * of 2.5 metres was stored there as 3. Where the invoice came from a sale,
   * the true quantity and the unit are read back off sale_lines, which keeps
   * both. The rows line up because both were written in the same order.
   */
  async buildLines(invoiceId, saleId, client) {
    const db = client || pool;

    const billed = await db.query(
      `SELECT product_name, hsn_code, quantity, unit_price, gst_percent,
              tax_amount, total
         FROM invoice_items WHERE invoice_id = $1 ORDER BY id ASC`,
      [invoiceId],
    );

    let saleLines = [];
    if (saleId) {
      const rows = await db.query(
        `SELECT quantity, unit FROM sale_lines
          WHERE sale_id = $1 ORDER BY created_at ASC`,
        [saleId],
      );
      // Only trusted when the two agree on how many lines there are. If a
      // sale was edited after billing they would not, and a positional match
      // would then put one line's quantity against another line's rate.
      if (rows.rows.length === billed.rows.length) saleLines = rows.rows;
    }

    return billed.rows.map((row, index) => ({
      itemName: row.product_name,
      hsnCode: row.hsn_code,
      quantity: saleLines[index] ? Number(saleLines[index].quantity) : Number(row.quantity),
      unit: saleLines[index] ? saleLines[index].unit : null,
      unitPrice: Number(row.unit_price),
      gstPercent: Number(row.gst_percent),
      taxAmount: Number(row.tax_amount),
      total: Number(row.total),
    }));
  }

  async findByInvoiceId(invoiceId, wholesalerId) {
    const result = await pool.query(
      `SELECT cn.*, i.invoice_number
         FROM credit_notes cn
         JOIN invoices i ON i.id = cn.invoice_id
        WHERE cn.invoice_id = $1 AND cn.wholesaler_id = $2`,
      [invoiceId, wholesalerId],
    );
    return result.rows[0] || null;
  }

  async findBySaleId(saleId, wholesalerId) {
    const result = await pool.query(
      `SELECT cn.*, i.invoice_number
         FROM credit_notes cn
         JOIN invoices i ON i.id = cn.invoice_id
        WHERE cn.sale_id = $1 AND cn.wholesaler_id = $2`,
      [saleId, wholesalerId],
    );
    return result.rows[0] || null;
  }

  /**
   * One credit note with everything the page and the PDF need: its lines, the
   * invoice it reverses, and who issued it.
   */
  async getCreditNote(id, wholesalerId) {
    const result = await pool.query(
      `SELECT cn.*,
              i.invoice_number, i.issue_date AS invoice_date,
              i.grand_total AS invoice_total,
              s.sale_number,
              u.first_name, u.last_name, u.email AS supplier_email,
              u.phone AS supplier_phone,
              wp.company_name AS supplier_company, wp.gstin AS supplier_gstin,
              wp.city AS supplier_city
         FROM credit_notes cn
         JOIN invoices i ON i.id = cn.invoice_id
         LEFT JOIN sales s ON s.id = cn.sale_id
         LEFT JOIN users u ON u.id = cn.wholesaler_id
         LEFT JOIN wholesaler_profiles wp ON wp.user_id = cn.wholesaler_id
        WHERE cn.id = $1 AND cn.wholesaler_id = $2`,
      [id, wholesalerId],
    );
    if (result.rows.length === 0) return null;

    const note = result.rows[0];
    const items = await pool.query(
      `SELECT * FROM credit_note_items
        WHERE credit_note_id = $1 ORDER BY id ASC`,
      [id],
    );
    note.items = items.rows;
    note.supplier_name =
      note.supplier_company ||
      [note.first_name, note.last_name].filter(Boolean).join(" ").trim() ||
      "Supplier";
    return note;
  }

  async listCreditNotes(wholesalerId, { partyId = null } = {}) {
    const params = [wholesalerId];
    let where = "cn.wholesaler_id = $1";
    if (partyId) {
      params.push(partyId);
      where += ` AND cn.party_id = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT cn.id, cn.note_number, cn.issue_date, cn.reason, cn.reason_note,
              cn.grand_total, cn.recipient_name, cn.party_id, cn.sale_id,
              i.invoice_number, i.id AS invoice_id, s.sale_number
         FROM credit_notes cn
         JOIN invoices i ON i.id = cn.invoice_id
         LEFT JOIN sales s ON s.id = cn.sale_id
        WHERE ${where}
        ORDER BY cn.issue_date DESC, cn.created_at DESC
        LIMIT 200`,
      params,
    );
    return result.rows;
  }
}

module.exports = new CreditNoteService();

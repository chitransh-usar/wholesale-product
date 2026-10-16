const pool = require("../config/db");
const { fullName } = require("../utils/money");
const invoiceRepository = require("../repositories/invoiceRepository");
const challanService = require("./challanService");
const { placeOfSupply, stateOf, stateCode } = require("./placeOfSupply");
const { toInvoiceFields } = require("./transportDetails");
const { DEFAULT_CHANNEL } = require("./salesChannels");
const invoiceNumberService = require("./invoiceNumberService");
const gstService = require("./gstService");

/**
 * Turns a recorded sale into an invoice.
 *
 * Sits beside invoiceService.createInvoiceFromOrder rather than replacing it.
 * Marketplace invoices still come from orders; everything recorded in 3.0
 * comes through here. Numbering, GST maths, the PDF and payment recording are
 * all the existing module's, unchanged.
 *
 * The rates on a sale are TAX EXCLUSIVE. This was a guess for a while and it
 * was the wrong one; a real wholesaler has since confirmed that "142 a metre"
 * means the shop pays 142 plus GST.
 *
 * The khata moved with it, which was the whole worry. A sale now works out
 * its own tax and stores it, so sales.total is the tax inclusive figure the
 * customer actually owes, and it equals this invoice's grand total. Both go
 * through gstService with the same inputs, and the per line rate is read off
 * the sale rather than from today's settings, so a bill can never disagree
 * with the sale it was raised from.
 */

const TAX_INCLUSIVE = false;


class SaleInvoiceService {
  /**
   * Loads everything an invoice needs about one sale, scoped to its owner.
   * Returns null when the sale is not this wholesaler's.
   */
  async loadSale(saleId, wholesalerId, client) {
    const db = client || pool;
    const has = await invoiceRepository.schemaExtras();

    const sale = await db.query(
      `SELECT s.*,
              p.id AS party_id, p.name AS party_name,
              p.business_name AS party_business_name,
              p.gstin AS party_gstin, p.city AS party_city,
              ${has.has_party_state ? "p.state" : "NULL"} AS party_state,
              p.address AS party_address, p.phone AS party_phone,
              p.user_id AS party_user_id
         FROM sales s
         JOIN parties p ON p.id = s.party_id
        WHERE s.id = $1 AND s.wholesaler_id = $2`,
      [saleId, wholesalerId],
    );
    if (sale.rows.length === 0) return null;

    const [lines, received] = await Promise.all([
      db.query(
        // gst_percent arrives with wholesale3_tax_on_top.sql. Before that it
        // is selected as NULL, which is exactly what the legacy check below
        // is looking for, so an unmigrated database bills the old way.
        `SELECT item_name, quantity, unit, rate, amount, hsn_code,
                ${has.has_line_gst ? "gst_percent" : "NULL AS gst_percent"},
                ${has.has_cess ? "cess_percent" : "0 AS cess_percent"}
           FROM sale_lines WHERE sale_id = $1 ORDER BY created_at ASC`,
        [saleId],
      ),
      db.query(
        "SELECT COALESCE(SUM(amount), 0) AS total FROM party_payments WHERE sale_id = $1",
        [saleId],
      ),
    ]);

    return {
      sale: sale.rows[0],
      lines: lines.rows,
      received: Number(received.rows[0].total),
    };
  }

  /**
   * Ties an invoice to its sale and freezes who it is addressed to.
   *
   * The recipient is stored on the invoice rather than joined from the party,
   * because a tax document must not change when a contact is edited later.
   * The firm comes first: an invoice is addressed to the registered business,
   * and the person's name is the fallback for a customer who has no firm.
   *
   * Written so it can also adopt an invoice the order raised, which starts
   * with none of this filled in.
   */
  async stampRecipient(client, invoiceId, sale) {
    const has = await invoiceRepository.schemaExtras();

    // The state the customer is in, frozen with the rest of the address. It
    // comes from placeOfSupply so it follows the same order as the tax
    // decision did: a declared state, then the state the GSTIN carries, then
    // the city. A bill that shows one state and charged tax for another is
    // the confusion this is meant to prevent.
    //
    // There is no pincode here because parties does not hold one. Blank is
    // honest. An invented pincode on a tax document is not.
    const state = has.has_document_block
      ? stateOf({
          state: sale.party_state,
          gstin: sale.party_gstin,
          city: sale.party_city,
        })
      : null;

    const extra = has.has_document_block
      ? ", recipient_state = $10, recipient_state_code = $11"
      : "";

    const stamped = await client.query(
      `UPDATE invoices SET
         sale_id = $2, party_id = $3,
         recipient_name = $4, recipient_gstin = $5, recipient_city = $6,
         recipient_address = $7, recipient_phone = $8,
         pdf_url = $9${extra}
       WHERE id = $1
       RETURNING *`,
      [
        invoiceId,
        sale.id,
        sale.party_id,
        sale.party_business_name || sale.party_name,
        sale.party_gstin,
        sale.party_city,
        sale.party_address,
        sale.party_phone,
        `/api/invoices/${invoiceId}/pdf`,
        ...(has.has_document_block ? [state || null, state ? stateCode(state) : null] : []),
      ],
    );
    return stamped.rows[0];
  }

  /**
   * Creates the invoice, or returns the one that already exists. Never
   * creates a second bill for the same sale: the unique index on sale_id
   * enforces that too, but returning early keeps the caller simple.
   */
  async createInvoiceFromSale(saleId, wholesalerId) {
    // Scoped by owner, not just by sale. Looking this up on sale_id alone
    // handed another wholesaler's invoice, recipient GSTIN and all, to anyone
    // who asked to bill a sale that was not theirs.
    const existing = await pool.query(
      `SELECT i.* FROM invoices i
         JOIN sales s ON s.id = i.sale_id
        WHERE i.sale_id = $1 AND s.wholesaler_id = $2`,
      [saleId, wholesalerId],
    );
    if (existing.rows.length > 0) {
      return { invoice: existing.rows[0], created: false };
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const loaded = await this.loadSale(saleId, wholesalerId, client);
      if (!loaded) {
        await client.query("ROLLBACK");
        return { error: "notFound" };
      }

      const { sale, lines, received } = loaded;

      /**
       * One bill per sale, even with two callers arriving at once.
       *
       * The check above this transaction reads outside any lock, so two
       * callers can both see "no invoice yet" and both go on to create one.
       * That was harmless while a bill was only ever raised by a person
       * pressing a button. It is not any more: a settled sale now bills
       * itself, so recording the last payment and pressing "Make invoice" are
       * two callers doing the same work at the same moment. Caught by the
       * challan suite, which did exactly that and got a duplicate key error
       * off idx_invoices_sale.
       *
       * The lock is taken on the sale, and the question is asked again under
       * it. The loser finds the winner's invoice and hands that back.
       */
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
        [`sale:${sale.id}`],
      );
      const raced = await client.query(
        "SELECT * FROM invoices WHERE sale_id = $1",
        [sale.id],
      );
      if (raced.rows.length > 0) {
        await client.query("COMMIT");
        return { invoice: raced.rows[0], created: false };
      }

      /**
       * A sale from a shop order is billed by the order's invoice.
       *
       * Checkout raises one automatically, in the background, the moment the
       * order is placed. This method only ever looked for an invoice against
       * the SALE, so pressing "raise bill" on the sale made a second one: two
       * invoice numbers, two entries in the invoices tab, for one lot of
       * goods. They even showed different names, because the order's invoice
       * falls back to the buyer's account and the sale's is addressed to the
       * party.
       *
       * The order's invoice is the older document and the one the customer was
       * emailed, so that is the one that stands. It is adopted rather than
       * duplicated: the sale, the party and the recipient snapshot are stamped
       * onto it, so it is now reachable from both screens and reads the same
       * on both.
       */
      if (sale.order_id) {
        // The same lock invoiceService takes, on the same key, so the two
        // sides cannot both read "nothing yet" and both create. Checkout
        // raises its invoice in the background, so this really does race.
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
          [sale.order_id],
        );
        const fromOrder = await client.query(
          "SELECT * FROM invoices WHERE order_id = $1 FOR UPDATE",
          [sale.order_id],
        );
        if (fromOrder.rows.length > 0) {
          const adopted = await this.stampRecipient(
            client,
            fromOrder.rows[0].id,
            sale,
          );
          await client.query("COMMIT");
          return { invoice: adopted, created: false };
        }
      }

      if (sale.status === "cancelled") {
        await client.query("ROLLBACK");
        return { error: "cancelled" };
      }
      if (sale.status === "draft") {
        await client.query("ROLLBACK");
        return { error: "draft" };
      }
      if (lines.length === 0) {
        await client.query("ROLLBACK");
        return { error: "empty" };
      }

      /**
       * A tax invoice only once the money is in.
       *
       * Asked for on 10 Sept: while a sale is part paid or unpaid the
       * wholesaler gets a challan instead, and the bill waits.
       *
       * This is not what section 31(1) says, which ties the invoice to
       * removal of the goods rather than to payment. See the header of
       * challanService.js. It is behind a flag for exactly that reason:
       * CHALLAN_WHEN_UNPAID=false restores the old behaviour, where a bill
       * could be raised whenever it was asked for.
       */
      if (challanService.invoiceWaitsForPayment() && await challanService.challanTablesExist(client)) {
        const money = await challanService.settlementOf(client, sale);
        if (!money.settled) {
          await client.query("ROLLBACK");
          return {
            error: "unpaid",
            outstanding: Number((money.total - money.received).toFixed(2)),
            received: money.received,
            total: money.total,
          };
        }
      }

      const supplier = await client.query(
        `SELECT u.first_name, u.last_name, u.email,
                wp.company_name, wp.gstin, wp.city, wp.warehouse_city,
                wp.warehouse_state
           FROM users u
           LEFT JOIN wholesaler_profiles wp ON wp.user_id = u.id
          WHERE u.id = $1`,
        [wholesalerId],
      );
      const seller = supplier.rows[0] || {};
      const settings = await invoiceRepository.getSettings(wholesalerId);

      // Sales recorded before GST moved onto the sale were entered under the
      // old reading, where the quoted rate already included tax, and their
      // totals are what those customers were told they owed. Billing one with
      // tax added on top would hand over a bill higher than the balance on
      // that customer's account. Every line written since carries a resolved
      // rate, so a sale where no line has one is unambiguously an old one,
      // and a genuinely tax free sale is not confused with it: its lines
      // carry a real zero.
      const legacyInclusive =
        lines.length > 0 &&
        lines.every((line) => line.gst_percent === null || line.gst_percent === undefined);

      // A sale raised from a shop order is priced the way the shop prices
      // things: the buyer paid the listed amount at checkout and that is all
      // they will be asked for. Adding tax on top would bill them past what they
      // has already paid and make this invoice disagree with customer khata.
      //
      // A sale the wholesaler typed themselves follows the other convention: the
      // rate they quotes is before tax. Same table, two honest meanings, told
      // apart by where the sale came from.
      const fromShop = Boolean(sale.order_id);

      const gst = gstService.calculateGST({
        items: lines.map((line) => ({
          productName: line.item_name,
          quantity: Number(line.quantity),
          unitPrice: Number(line.rate),
          // Off the line, not out of today's settings. The rate was resolved
          // and snapshot when the sale was recorded, and the sale's total was
          // worked out from it. Reading the setting here would let a default
          // changed since then produce a bill that disagrees with the sale.
          // Older lines, recorded before the column existed, have none.
          gstPercent:
            line.gst_percent !== null && line.gst_percent !== undefined
              ? Number(line.gst_percent)
              : settings.defaultTaxRate,
          // Same rule for the cess: off the line, never out of today's term.
          // A sale recorded at 12 per cent must bill at 12 per cent even if
          // somebody has since set the term to zero.
          cessPercent: Number(line.cess_percent ?? 0),
          hsnCode: line.hsn_code || undefined,
        })),
        discount: Number(sale.discount || 0),
        shippingCharge: 0,
        // The customer's GST number settles their state outright, which matters
        // most here: a party is usually entered with a name, a phone and a
        // city, and half the cities in India are not in any map we hold.
        //
        // A customer with neither a GST number nor a city known to that map
        // comes back unknown, and unknown is read as the same state, so their
        // bill is CGST plus SGST. That is what a local sale is, and it is what
        // the previous code did too, by pretending they lived where the seller
        // lives.
        supplierLocation: {
          state: seller.warehouse_state,
          gstin: seller.gstin,
          city: seller.warehouse_city || seller.city,
        },
        buyerLocation: {
          state: sale.party_state,
          gstin: sale.party_gstin,
          city: sale.party_city,
        },
        isTaxInclusive: fromShop || legacyInclusive ? true : TAX_INCLUSIVE,
      });

      const pos = placeOfSupply({
        state: sale.party_state,
        gstin: sale.party_gstin,
        city: sale.party_city,
      });

      const invoiceNumber = await invoiceNumberService.generateInvoiceNumber(
        client,
        settings.prefix,
        null,
        wholesalerId,
        // The bill draws on the run its SALE belongs to. A Flipkart sale
        // billed here gets an FK number, so Flipkart's settlement report can
        // be matched against a consecutive run of our numbers.
        {
          suffix: settings.numberSuffix,
          padTo: settings.numberPadTo,
          channel: sale.channel || DEFAULT_CHANNEL,
        },
      );

      const issueDate = new Date(sale.sale_date || Date.now());
      const dueDate = new Date(issueDate);
      dueDate.setDate(issueDate.getDate() + settings.dueDays);

      // "Pending" covers anything not fully received. The reporting queries
      // only count Paid and Pending, so inventing a third value here would
      // quietly drop those invoices out of every total.
      const paid = received >= Number(sale.total) && Number(sale.total) > 0;

      const invoiceData = {
        invoiceNumber,
        orderId: null,
        buyerId: sale.party_user_id || null,
        supplierId: wholesalerId,
        subtotal: gst.subtotal,
        discount: gst.discount,
        shippingCharge: gst.shippingCharge,
        taxableAmount: gst.taxableAmount,
        cgst: gst.cgst,
        sgst: gst.sgst,
        igst: gst.igst,
        totalTax: gst.totalTax,
        grandTotal: gst.grandTotal,
        totalCess: gst.totalCess,
        channel: sale.channel || DEFAULT_CHANNEL,
        // Rule 46 particulars, frozen at issue. The place of supply is the
        // state the goods went TO, which is what decides IGST against CGST
        // plus SGST, and it has been computed all along without being stored.
        placeOfSupply: pos.state,
        placeOfSupplyCode: pos.code,
        supplierState: gst.supplierState,
        // No reverse charge path exists yet, so this is always false. The
        // field is required on the document even when the answer is no.
        reverseCharge: false,
        roundOff: gst.roundOff,
        paymentStatus: paid ? "Paid" : "Pending",
        invoiceStatus: "Generated",
        issueDate,
        dueDate,
        notes: settings.defaultNotes,
        termsConditions: settings.defaultTerms,
        pdfUrl: null,

        // The lorry the wholesaler recorded on the sale, carried onto the bill
        // raised from it. Typed once, at the moment the goods went out, which
        // is the only moment anybody actually knows the vehicle number.
        //
        // Copied, not joined. Editing the sale afterwards must not change a
        // bill that has already been handed over, which is the same rule the
        // recipient and the seller block follow.
        ...toInvoiceFields(sale),
      };

      const invoice = await invoiceRepository.createInvoice(
        invoiceData,
        gst.items,
        client,
      );

      // The link back to the sale, and the recipient frozen as of today.
      // See the migration for why these are stored rather than joined.
      const stamped = { rows: [await this.stampRecipient(client, invoice.id, sale)] };

      // The goods may have gone out on one or more challans while the money
      // was outstanding. Point them at the bill that superseded them, so they
      // stop reading as open.
      await challanService.markInvoiced(client, sale.id, invoice.id);

      await invoiceRepository.addLog(
        {
          invoiceId: invoice.id,
          action: "Created",
          performedBy: wholesalerId,
          details: `Invoice ${invoiceNumber} raised for sale ${sale.sale_number}`,
        },
        client,
      );

      // No payment row is written here. The money is already in
      // party_payments, recorded against the sale. Writing it again into the
      // invoice module's own payments table is what made a bill read Paid
      // while the customer still owed the full amount.

      await client.query("COMMIT");

      return {
        invoice: stamped.rows[0],
        created: true,
        sellerName: seller.company_name || fullName(seller.first_name, seller.last_name),
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Brings an invoice's payment status back in line with the money ledger.
   *
   * There is one ledger, party_payments. The invoice module has its own
   * payments table and used to be written to separately, which meant a bill
   * could read Paid while the customer's balance still showed the full amount
   * owing. Nothing writes that table for a sale invoice any more; this
   * recomputes the status from what actually came in.
   */
  /**
   * Raise the bill the moment a sale is settled, if it has none yet.
   *
   * The rule is that a tax invoice waits until the sale is fully paid. That
   * left the last step to a button nobody had to press: a wholesaler could
   * settle a sale and their customer would simply never get a bill.
   *
   * The order side already worked this way, through reconcileInvoiceForOrder,
   * so this closes an asymmetry rather than inventing a behaviour: the same
   * event had two outcomes depending on which screen the money came in on.
   *
   * Safe to call on every payment. It does nothing when the sale is short,
   * already billed, cancelled or a draft, and createInvoiceFromSale is
   * idempotent besides.
   *
   * Never throws. A payment that is recorded is the thing that matters; a
   * bill that did not raise itself can be raised again by the next payment or
   * by hand.
   */
  async billIfSettled(saleId, wholesalerId) {
    if (!saleId || !wholesalerId) return null;
    try {
      const money = await challanService.settlementForSale(saleId, wholesalerId);
      if (!money || !money.settled) return null;
      const result = await this.createInvoiceFromSale(saleId, wholesalerId);
      return result.invoice || null;
    } catch (err) {
      console.error("Could not raise the bill for a settled sale:", err.message);
      return null;
    }
  }

  async syncInvoiceFromLedger(saleId, externalClient = null) {
    const db = externalClient || pool;

    const row = await db.query(
      `SELECT i.id, i.grand_total, i.invoice_status,
              COALESCE((SELECT SUM(pp.amount) FROM party_payments pp
                         WHERE pp.sale_id = i.sale_id), 0) AS received
         FROM invoices i
        WHERE i.sale_id = $1`,
      [saleId],
    );
    if (row.rows.length === 0) return null;

    const invoice = row.rows[0];
    if (invoice.invoice_status === "Cancelled") return invoice;

    const paid =
      Number(invoice.received) >= Number(invoice.grand_total) &&
      Number(invoice.grand_total) > 0;

    const updated = await db.query(
      `UPDATE invoices
          SET payment_status = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND payment_status IS DISTINCT FROM $2
        RETURNING *`,
      [invoice.id, paid ? "Paid" : "Pending"],
    );
    return updated.rows[0] || invoice;
  }

  // Cancelling a sale used to void its invoice here. It no longer does. An
  // issued bill is reversed with a credit note, not by voiding it, so that
  // job moved to creditNoteService. Voiding by hand is still possible from
  // the invoice page, which is the right answer for a bill raised in error
  // that never left the office.

  async findBySaleId(saleId, wholesalerId) {
    const result = await pool.query(
      `SELECT i.* FROM invoices i
         JOIN sales s ON s.id = i.sale_id
        WHERE i.sale_id = $1 AND s.wholesaler_id = $2`,
      [saleId, wholesalerId],
    );
    return result.rows[0] || null;
  }
}

module.exports = new SaleInvoiceService();

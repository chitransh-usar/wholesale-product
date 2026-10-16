const pool = require("../config/db");
const { sellerSnapshot, bankSnapshot } = require("../services/invoiceSnapshot");

let schemaEnsured = false;

// Everything a caller is allowed to change on an existing invoice. Money
// columns are absent on purpose: totals come from the GST calculation, not
// from whatever the client posts.
const UPDATABLE_INVOICE_COLUMNS = new Set([
  "payment_status",
  "invoice_status",
  "due_date",
  "notes",
  "terms_conditions",
  "pdf_path",
  "pdf_url",
  "email_sent",
  "email_sent_at",
]);

/**
 * Create the invoice tables if they are not there.
 *
 * IT CHECKS BEFORE IT BUILDS, and that is not an optimisation. Called without
 * a client this runs its DDL on a POOL connection, which is a DIFFERENT
 * connection from whatever transaction the caller may have open. On a
 * database where the tables already exist that used to be a harmless no op,
 * but `CREATE EXTENSION IF NOT EXISTS pgcrypto` still takes heavy locks, and
 * an open transaction elsewhere holds locks that conflict with them. The two
 * then wait on each other and neither ever finishes.
 *
 * It hung the first invoice raised from inside a transaction in a freshly
 * started process, every time, with no error: the request simply never
 * returned. `schemaEnsured` is per process, so it only ever bit the first
 * one, which is exactly the kind of fault that reaches production.
 *
 * The migrations own this schema now. So on any database that has been
 * migrated, which is all of them, the probe finds `invoices` and nothing is
 * built at all. The DDL below is kept for a database that genuinely has
 * nothing, where there is no transaction to deadlock against.
 */
async function ensureSchema(client = null) {
  if (schemaEnsured) return;
  const dbClient = client || pool;

  // A plain read. It takes no lock worth the name and cannot block on one.
  try {
    const { rows } = await dbClient.query(
      `SELECT to_regclass('public.invoices') IS NOT NULL AS built`);
    if (rows[0]?.built) {
      schemaEnsured = true;
      return;
    }
  } catch {
    // Fall through and try to build it. A probe that cannot run is not a
    // reason to refuse to create the schema.
  }

  try {
    await dbClient.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

      CREATE TABLE IF NOT EXISTS invoice_sequences (
          year INTEGER PRIMARY KEY,
          last_number INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS invoices (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          invoice_number VARCHAR(50) UNIQUE NOT NULL,
          order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
          buyer_id UUID REFERENCES users(id) ON DELETE CASCADE,
          supplier_id UUID REFERENCES users(id) ON DELETE CASCADE,
          subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
          discount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
          shipping_charge NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
          taxable_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
          cgst NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
          sgst NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
          igst NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
          total_tax NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
          grand_total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
          payment_status VARCHAR(50) DEFAULT 'Pending',
          invoice_status VARCHAR(50) DEFAULT 'Generated',
          issue_date DATE DEFAULT CURRENT_DATE,
          due_date DATE,
          notes TEXT,
          terms_conditions TEXT,
          pdf_path TEXT,
          pdf_url TEXT,
          email_sent BOOLEAN DEFAULT FALSE,
          email_sent_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS pdf_path TEXT;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS email_sent BOOLEAN DEFAULT FALSE;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMP;

      CREATE TABLE IF NOT EXISTS invoice_items (
          id SERIAL PRIMARY KEY,
          invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
          product_id UUID REFERENCES products(id) ON DELETE SET NULL,
          product_name VARCHAR(255) NOT NULL,
          -- No default. A wrong HSN on a tax document is worse than none.
          hsn_code VARCHAR(50),
          -- Not INTEGER. Cloth is sold by the metre and oil by the litre, and
          -- an integer column made billing 2.5 metres fail outright.
          quantity NUMERIC(12, 3) NOT NULL CHECK (quantity > 0),
          unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
          gst_percent NUMERIC(5, 2) DEFAULT 18.00,
          tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
          total NUMERIC(12, 2) NOT NULL DEFAULT 0.00
      );

      -- Widens the column on databases created before it was NUMERIC. Guarded
      -- rather than run flat, because an unconditional ALTER ... TYPE on every
      -- boot risks rewriting the whole table each time. Sits after the CREATE
      -- above: on a fresh database the table has to exist first, and a failure
      -- here would abort the rest of this batch.
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_name = 'invoice_items'
             AND column_name = 'quantity'
             AND data_type = 'integer'
        ) THEN
          ALTER TABLE invoice_items ALTER COLUMN quantity TYPE NUMERIC(12, 3);
        END IF;
      END $$;

      CREATE TABLE IF NOT EXISTS payments (
          id SERIAL PRIMARY KEY,
          invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
          amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
          payment_method VARCHAR(50) NOT NULL,
          transaction_id VARCHAR(100),
          payment_reference VARCHAR(100),
          paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          remarks TEXT
      );

      CREATE TABLE IF NOT EXISTS invoice_logs (
          id SERIAL PRIMARY KEY,
          invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
          action VARCHAR(50) NOT NULL,
          performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
          recipient_email VARCHAR(255),
          smtp_response TEXT,
          error_logs TEXT,
          details TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS invoice_settings (
          user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          prefix VARCHAR(10) NOT NULL DEFAULT 'INV',
          due_days INTEGER NOT NULL DEFAULT 15,
          default_tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 18.00,
          default_notes TEXT,
          default_terms TEXT,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_invoices_order_id ON invoices(order_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_buyer_id ON invoices(buyer_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_supplier_id ON invoices(supplier_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_invoice_number ON invoices(invoice_number);
      CREATE INDEX IF NOT EXISTS idx_invoices_payment_status ON invoices(payment_status);
      CREATE INDEX IF NOT EXISTS idx_invoices_invoice_status ON invoices(invoice_status);
      CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_invoice_logs_invoice_id ON invoice_logs(invoice_id);
    `);
    schemaEnsured = true;
    console.log("Invoice tables and schema verified in PostgreSQL.");
  } catch (err) {
    console.error("Auto schema verification error:", err.message);
  }
}

/**
 * What of wholesale 3.0 this database actually has.
 *
 * Migrations in this repository are run by hand, so the code can be deployed
 * hours or days before the SQL is run, and it can be pointed at a database
 * that is still purely wholesale 2.0. The invoice module is shared: the
 * marketplace and the sales book both read these queries. Referring to
 * credit_notes or sales unconditionally meant that on a database without them
 * the whole module died. The list came back empty, because findInvoices
 * swallows its own errors, the detail page 404ed, the PDF failed, recording a
 * payment failed, and the dashboard reported zero revenue, which is worse
 * than an error because it looks like an answer.
 *
 * So the queries are assembled from what is present. Probed once and cached,
 * the same way the schema check is. Every branch here is temporary: once the
 * migrations are in, both sides are true and the query is the full one.
 */
let extras = null;

async function schemaExtras(db = pool) {
  if (extras) return extras;
  try {
    const result = await db.query(`
      SELECT
        to_regclass('public.credit_notes')   IS NOT NULL AS has_credit_notes,
        to_regclass('public.party_payments') IS NOT NULL AS has_party_payments,
        to_regclass('public.sales')          IS NOT NULL AS has_sales,
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'invoices' AND column_name = 'sale_id') AS has_sale_id,
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'invoices' AND column_name = 'recipient_name') AS has_recipient,
        -- The seller block, both addresses, bank details, transport and the
        -- e-invoice fields all arrive together in
        -- wholesale3_invoice_document_block.sql, so one probe covers them.
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'invoices' AND column_name = 'seller_gstin') AS has_document_block,
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'sales' AND column_name = 'tax_amount') AS has_sale_tax,
        -- The transport block on a sale, from wholesale3_sale_transport.sql.
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'sales' AND column_name = 'transport_mode') AS has_sale_transport,
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'invoices' AND column_name = 'channel') AS has_invoice_channel,
        -- Which book a sale belongs to, from wholesale3_sales_channels.sql.
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'sales' AND column_name = 'channel') AS has_sale_channel,
        -- Cess, from wholesale3_tax_terms_and_cess.sql. Probed on the sale
        -- line, because that is the one the money path reads through.
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'sale_lines' AND column_name = 'cess_percent') AS has_cess,
        -- And on an order, from wholesale3_order_transport.sql.
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'orders' AND column_name = 'transport_mode') AS has_order_transport,
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'sales' AND column_name = 'order_id') AS has_sale_order_id,
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'invoice_settings'
                   AND column_name = 'number_suffix') AS has_number_format,
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'invoices'
                   AND column_name = 'place_of_supply') AS has_rule46_fields,
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'sale_lines' AND column_name = 'gst_percent') AS has_line_gst,
        -- The customer's declared state, from wholesale3_party_state.sql.
        -- Until it is run the column is selected as NULL, which placeOfSupply
        -- reads as "not told" and falls back to the GST number then the city,
        -- exactly as it did before.
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'parties' AND column_name = 'state') AS has_party_state,
        -- Razorpay Route, from wholesale3_razorpay_route.sql. Until it is run
        -- there are no linked accounts, so no transfer is attached to a
        -- payment and the money is taken exactly as it was before Route.
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'wholesaler_profiles'
                   AND column_name = 'razorpay_account_id') AS has_razorpay_route,
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'items' AND column_name = 'gst_percent') AS has_item_gst,
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'supplier_inventory'
                   AND column_name = 'gst_percent') AS has_listing_billing,
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'invoice_sequences'
                   AND column_name = 'wholesaler_id') AS has_invoice_sequence_owner,
        -- A run of numbers per sales channel, from wholesale3_sales_channels.sql.
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'invoice_sequences'
                   AND column_name = 'series') AS has_invoice_series,
        -- Sale and challan numbers restart each financial year, which needs a
        -- financial_year column on both counters. Until then both fall back to
        -- their old shapes, S-0001 and DC-0001.
        (EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'sale_sequences'
                    AND column_name = 'financial_year')
         AND EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name = 'delivery_challan_sequences'
                        AND column_name = 'financial_year')) AS has_series_fy,
        -- The purchase side. Arrives with wholesale3_purchases.sql; until then
        -- every purchase route answers "not set up yet" rather than throwing.
        (to_regclass('public.purchases') IS NOT NULL
         AND to_regclass('public.suppliers') IS NOT NULL
         AND to_regclass('public.supplier_payments') IS NOT NULL
         AND to_regclass('public.purchase_sequences') IS NOT NULL) AS has_purchases
    `);
    extras = result.rows[0];
  } catch (err) {
    // Assume the older shape. Being wrong this way loses the 3.0 columns on
    // a page; being wrong the other way loses the page.
    console.error("Could not probe for the 3.0 invoice columns:", err.message);
    extras = {
      has_credit_notes: false,
      has_party_payments: false,
      has_sales: false,
      has_sale_id: false,
      has_recipient: false,
      has_document_block: false,
      has_sale_tax: false,
      has_sale_transport: false,
      has_order_transport: false,
      has_cess: false,
      has_invoice_series: false,
      has_sale_channel: false,
      has_invoice_channel: false,
      has_sale_order_id: false,
      has_number_format: false,
      has_series_fy: false,
      has_rule46_fields: false,
      has_line_gst: false,
      has_item_gst: false,
      has_listing_billing: false,
      has_invoice_sequence_owner: false,
      has_purchases: false,
    };
  }
  return extras;
}

// Only meaningful in tests, where one process talks to more than one database.
function resetSchemaExtras() {
  extras = null;
}

// The recipient snapshot columns, or the plain buyer joins when the migration
// that adds them has not been run.
const recipientColumns = (has) => ({
  name: has ? "i.recipient_name," : "",
  phone: has ? "COALESCE(i.recipient_phone, bu.phone)" : "bu.phone",
  company: has ? "COALESCE(i.recipient_name, bwp.company_name)" : "bwp.company_name",
  gstin: has ? "COALESCE(i.recipient_gstin, bwp.gstin)" : "bwp.gstin",
  city: has ? "COALESCE(i.recipient_city, bwp.city)" : "bwp.city",
});

class InvoiceRepository {
  /**
   * Atomically fetches and increments the sequence number for a given calendar year.
   */
  /**
   * The next invoice number in one wholesaler's own run.
   *
   * Per wholesaler, not per platform. The counter used to be keyed on the year
   * alone, so Ram's bills came out 000001, 000003, 000009 with another firm's
   * invoices filling the gaps, and the size of each gap told them how much
   * business everybody else had done. Rule 46(b) wants a consecutive serial
   * number per supplier, and a gap is exactly what gets asked about.
   *
   * Falls back to the shared counter on a database where the migration has not
   * been run, because an invoice that cannot be numbered is an invoice that
   * cannot be raised.
   */
  async getNextSequenceNumber(client, year, wholesalerId = null, series = "counter") {
    await ensureSchema(client);
    const dbClient = client || pool;
    const has = await schemaExtras();

    /**
     * One run per wholesaler, per channel, per year.
     *
     * Until wholesale3_sales_channels.sql has been run there is one run per
     * wholesaler and every channel shares it, which is exactly what the
     * product did before. That is the right fallback: a wholesaler on an
     * unmigrated database keeps numbering bills rather than being refused.
     */
    if (has.has_invoice_sequence_owner && has.has_invoice_series && wholesalerId) {
      const result = await dbClient.query(
        `INSERT INTO invoice_sequences (wholesaler_id, series, year, last_number)
         VALUES ($1, $2, $3, 1)
         ON CONFLICT (wholesaler_id, series, year)
         DO UPDATE SET last_number = invoice_sequences.last_number + 1
         RETURNING last_number`,
        [wholesalerId, series || "counter", year],
      );
      return result.rows[0].last_number;
    }

    if (!has.has_invoice_sequence_owner || !wholesalerId) {
      const result = await dbClient.query(
        `INSERT INTO invoice_sequences (year, last_number)
         VALUES ($1, 1)
         ON CONFLICT (year)
         DO UPDATE SET last_number = invoice_sequences.last_number + 1
         RETURNING last_number`,
        [year]
      );
      return result.rows[0].last_number;
    }

    const result = await dbClient.query(
      `INSERT INTO invoice_sequences (wholesaler_id, year, last_number)
       VALUES ($1, $2, 1)
       ON CONFLICT (wholesaler_id, year)
       DO UPDATE SET last_number = invoice_sequences.last_number + 1
       RETURNING last_number`,
      [wholesalerId, year]
    );
    return result.rows[0].last_number;
  }

  /**
   * Creates an invoice record with its line items inside a transaction.
   */
  async createInvoice(invoiceData, itemsData, client) {
    await ensureSchema(client);
    const dbClient = client || pool;

    const {
      invoiceNumber,
      orderId,
      buyerId,
      supplierId,
      subtotal,
      discount = 0.00,
      shippingCharge = 0.00,
      taxableAmount,
      cgst = 0.00,
      sgst = 0.00,
      igst = 0.00,
      totalTax = 0.00,
      grandTotal,
      paymentStatus = "Pending",
      invoiceStatus = "Generated",
      issueDate = new Date(),
      dueDate,
      notes = "Thank you for your business!",
      termsConditions = "Standard B2B wholesale payment terms apply.",
      pdfUrl = null,
      // Rule 46 particulars. Optional so an unmigrated database and an older
      // caller both still work; see wholesale3_invoice_rule46_fields.sql.
      placeOfSupply = null,
      placeOfSupplyCode = null,
      supplierState = null,
      reverseCharge = false,
      roundOff = 0,
      // The document block, from wholesale3_invoice_document_block.sql. All
      // optional, all frozen onto the row. The seller block and the bank
      // details are NOT taken from here by default: they are read from the
      // wholesaler's own profile below, so no caller can forget to take the
      // snapshot. A caller may still pass them to override.
      recipientName = null,
      recipientGstin = null,
      recipientCity = null,
      recipientAddress = null,
      recipientPhone = null,
      recipientState = null,
      recipientStateCode = null,
      recipientPincode = null,
      dispatchFromName = null,
      dispatchFromAddress = null,
      dispatchFromCity = null,
      dispatchFromState = null,
      dispatchFromStateCode = null,
      dispatchFromPincode = null,
      shipToName = null,
      shipToGstin = null,
      shipToAddress = null,
      shipToCity = null,
      shipToState = null,
      shipToStateCode = null,
      shipToPincode = null,
      grNumber = null,
      grDate = null,
      transporterName = null,
      transporterId = null,
      transportMode = null,
      vehicleNumber = null,
      transportDocNumber = null,
      transportDocDate = null,
    } = invoiceData;

    const has = await schemaExtras();
    const rule46 = has.has_rule46_fields;

    // Named rather than positional. Forty more columns counted out by hand as
    // $26 through $65 is how a bank account number ends up in the pincode.
    const columns = [
      ["invoice_number", invoiceNumber],
      ["order_id", orderId],
      ["buyer_id", buyerId],
      ["supplier_id", supplierId],
      ["subtotal", subtotal],
      ["discount", discount],
      ["shipping_charge", shippingCharge],
      ["taxable_amount", taxableAmount],
      ["cgst", cgst],
      ["sgst", sgst],
      ["igst", igst],
      ["total_tax", totalTax],
      ["grand_total", grandTotal],
      ["payment_status", paymentStatus],
      ["invoice_status", invoiceStatus],
      ["issue_date", issueDate],
      ["due_date", dueDate],
      ["notes", notes],
      ["terms_conditions", termsConditions],
      ["pdf_url", pdfUrl],
    ];

    if (rule46) {
      columns.push(
        ["place_of_supply", placeOfSupply],
        ["place_of_supply_code", placeOfSupplyCode],
        ["supplier_state", supplierState],
        ["reverse_charge", reverseCharge],
        ["round_off", roundOff],
      );
    }

    /**
     * Who the bill is made out to, frozen onto the row.
     *
     * The sale path has always done this through a follow up UPDATE. Doing it
     * here as well means the order and manual paths get it without a second
     * write, and a fourth caller cannot forget. Passing nothing leaves the
     * columns null, which is what the sale path relies on before it stamps.
     */
    if (has.has_recipient) {
      columns.push(
        ["recipient_name", recipientName],
        ["recipient_gstin", recipientGstin],
        ["recipient_city", recipientCity],
        ["recipient_address", recipientAddress],
        ["recipient_phone", recipientPhone],
      );
    }

    // Its own total on the bill, because it is its own levy. Gated on the
    // document block, which is the migration that added the column.
    if (has.has_document_block) {
      columns.push(["total_cess", invoiceData.totalCess ?? 0]);
    }

    // So a number can always be explained later: which run it came from.
    if (has.has_invoice_channel && invoiceData.channel) {
      columns.push(["channel", invoiceData.channel]);
    }

    if (has.has_document_block) {
      // Taken here, inside the same transaction that writes the invoice, so
      // the copy is of the profile as it stood at the moment the bill was
      // raised. An explicit value from the caller wins, which is how a
      // correction or an import supplies its own.
      const seller = await sellerSnapshot(dbClient, supplierId);
      const bank = await bankSnapshot(dbClient, supplierId);
      const pick = (given, snapped) => (given !== null && given !== undefined ? given : snapped ?? null);

      columns.push(
        ["seller_name", pick(invoiceData.sellerName, seller.sellerName)],
        ["seller_gstin", pick(invoiceData.sellerGstin, seller.sellerGstin)],
        ["seller_address", pick(invoiceData.sellerAddress, seller.sellerAddress)],
        ["seller_city", pick(invoiceData.sellerCity, seller.sellerCity)],
        ["seller_state", pick(invoiceData.sellerState, seller.sellerState)],
        ["seller_state_code", pick(invoiceData.sellerStateCode, seller.sellerStateCode)],
        ["seller_pincode", pick(invoiceData.sellerPincode, seller.sellerPincode)],
        ["seller_phone", pick(invoiceData.sellerPhone, seller.sellerPhone)],
        ["bank_account_name", pick(invoiceData.bankAccountName, bank.bankAccountName)],
        ["bank_name", pick(invoiceData.bankName, bank.bankName)],
        ["bank_account_number", pick(invoiceData.bankAccountNumber, bank.bankAccountNumber)],
        ["bank_ifsc", pick(invoiceData.bankIfsc, bank.bankIfsc)],
        ["bank_branch", pick(invoiceData.bankBranch, bank.bankBranch)],
        ["recipient_state", recipientState],
        ["recipient_state_code", recipientStateCode],
        ["recipient_pincode", recipientPincode],
        ["dispatch_from_name", dispatchFromName],
        ["dispatch_from_address", dispatchFromAddress],
        ["dispatch_from_city", dispatchFromCity],
        ["dispatch_from_state", dispatchFromState],
        ["dispatch_from_state_code", dispatchFromStateCode],
        ["dispatch_from_pincode", dispatchFromPincode],
        ["ship_to_name", shipToName],
        ["ship_to_gstin", shipToGstin],
        ["ship_to_address", shipToAddress],
        ["ship_to_city", shipToCity],
        ["ship_to_state", shipToState],
        ["ship_to_state_code", shipToStateCode],
        ["ship_to_pincode", shipToPincode],
        ["gr_number", grNumber],
        ["gr_date", grDate],
        ["transporter_name", transporterName],
        ["transporter_id", transporterId],
        ["transport_mode", transportMode],
        ["vehicle_number", vehicleNumber],
        ["transport_doc_number", transportDocNumber],
        ["transport_doc_date", transportDocDate],
      );
    }

    const invoiceResult = await dbClient.query(
      `INSERT INTO invoices (${columns.map(([c]) => c).join(", ")})
       VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})
       RETURNING *`,
      columns.map(([, v]) => v),
    );

    const invoice = invoiceResult.rows[0];

    const insertedItems = [];
    for (const item of itemsData) {
      const itemResult = await dbClient.query(
        `INSERT INTO invoice_items (
          invoice_id, product_id, product_name, hsn_code,
          quantity, unit_price, gst_percent, tax_amount, total${
            has.has_document_block ? ", uqc, cess_percent, cess_amount" : ""
          }
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9${
          has.has_document_block ? ", $10, $11, $12" : ""
        })
        RETURNING *`,
        [
          invoice.id,
          item.productId || null,
          item.productName,
          item.hsnCode || null,
          item.quantity,
          item.unitPrice,
          item.gstPercent || 18.00,
          item.taxAmount || 0.00,
          item.total,
          // The unit as GST accepts it, frozen with the rest of the line. Null
          // when the unit has no UQC decided yet, which is a gap to fill in
          // rather than a reason to guess at one.
          ...(has.has_document_block
            ? [item.uqc || null, item.cessPercent || 0.00, item.cessAmount || 0.00]
            : []),
        ]
      );
      insertedItems.push(itemResult.rows[0]);
    }

    return { ...invoice, items: insertedItems };
  }

  /**
   * Finds an invoice by its UUID ID along with item lines, payment records, logs, and party details.
   */
  async findInvoiceById(id) {
    await ensureSchema();
    const has = await schemaExtras();
    const r = recipientColumns(has.has_recipient);

    const query = `
      SELECT
        i.*,
        o.order_number,
        -- An invoice raised from a sale stores who it was issued to on the
        -- row itself, because a party need not have a user account and
        -- because a tax document must not change when a contact is edited.
        -- The snapshot wins wherever it exists; the joins remain for the
        -- older marketplace invoices that have no snapshot.
        COALESCE(
          ${r.name}
          bwp.company_name,
          bu.first_name || ' ' || bu.last_name,
          'Buyer'
        ) AS buyer_name,
        bu.email AS buyer_email,
        ${r.phone} AS buyer_phone,
        ${r.company} AS buyer_company,
        ${r.gstin} AS buyer_gstin,
        ${r.city} AS buyer_city,
        bwp.country AS buyer_country,
        COALESCE(su.first_name || ' ' || su.last_name, 'Supplier') AS supplier_name,
        su.email AS supplier_email,
        su.phone AS supplier_phone,
        swp.company_name AS supplier_company,
        swp.gstin AS supplier_gstin,
        swp.upi_id AS supplier_upi_id,
        swp.city AS supplier_city,
        swp.country AS supplier_country
        ${
          has.has_credit_notes
            ? `,
        -- See findInvoices. One row at most, by unique index.
        cn.id AS credit_note_id,
        cn.note_number AS credit_note_number,
        cn.grand_total AS credited_amount,
        cn.issue_date AS credited_on,
        cn.reason AS credit_reason,
        cn.reason_note AS credit_reason_note`
            : ""
        }
        ${
          // What this bill was raised from, when it was a recorded sale rather
          // than a marketplace order. Without it the PDF printed
          // "Order Ref: #N/A" on every 3.0 invoice.
          has.has_sales && has.has_sale_id ? `,
        sl.sale_number` : ""
        }
      FROM invoices i
      ${has.has_credit_notes ? "LEFT JOIN credit_notes cn ON cn.invoice_id = i.id" : ""}
      ${has.has_sales && has.has_sale_id ? "LEFT JOIN sales sl ON sl.id = i.sale_id" : ""}
      LEFT JOIN orders o ON i.order_id = o.id
      LEFT JOIN users bu ON i.buyer_id = bu.id
      LEFT JOIN wholesaler_profiles bwp ON bu.id = bwp.user_id
      LEFT JOIN users su ON i.supplier_id = su.id
      LEFT JOIN wholesaler_profiles swp ON su.id = swp.user_id
      WHERE i.id = $1
    `;
    const result = await pool.query(query, [id]);
    if (result.rows.length === 0) return null;

    const invoice = result.rows[0];

    // Fetch line items
    const itemsResult = await pool.query(
      `SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY id ASC`,
      [id]
    );
    invoice.items = itemsResult.rows;

    // Fetch payments.
    //
    // A sale invoice's money lives in party_payments, the one ledger the
    // customer's balance also reads. The old payments table is only still
    // consulted for marketplace invoices, which have no sale behind them.
    // Every column is cast, because party_payments.paid_on is a DATE while
    // payments.paid_at is a TIMESTAMP, and an untyped NULL has no type for
    // the union to agree on.
    //
    // On a database that has not had the 3.0 migrations run there is no
    // party_payments and no sale_id, and every invoice is a marketplace one,
    // so the second half of the union is the whole answer.
    const oneLedger = has.has_party_payments && has.has_sale_id;
    const paymentsResult = await pool.query(
      oneLedger
        ? `SELECT pp.id::text AS id, pp.amount, pp.method AS payment_method,
                  pp.paid_on::timestamp AS paid_at,
                  pp.note AS remarks,
                  NULL::text AS transaction_id, NULL::text AS payment_reference
             FROM party_payments pp
             JOIN invoices i ON i.sale_id = pp.sale_id
            WHERE i.id = $1
            UNION ALL
           SELECT p.id::text AS id, p.amount, p.payment_method,
                  p.paid_at::timestamp AS paid_at,
                  p.remarks, p.transaction_id::text, p.payment_reference::text
             FROM payments p
             JOIN invoices i2 ON i2.id = p.invoice_id
            WHERE p.invoice_id = $1 AND i2.sale_id IS NULL
            ORDER BY paid_at DESC`
        : `SELECT p.id::text AS id, p.amount, p.payment_method,
                  p.paid_at::timestamp AS paid_at,
                  p.remarks, p.transaction_id::text, p.payment_reference::text
             FROM payments p
            WHERE p.invoice_id = $1
            ORDER BY paid_at DESC`,
      [id]
    );
    invoice.payments = paymentsResult.rows;

    // Fetch activity logs
    const logsResult = await pool.query(
      `SELECT il.*, u.first_name || ' ' || u.last_name AS performer_name
       FROM invoice_logs il
       LEFT JOIN users u ON il.performed_by = u.id
       WHERE il.invoice_id = $1 ORDER BY il.created_at DESC`,
      [id]
    );
    invoice.logs = logsResult.rows;

    return invoice;
  }

  /**
   * The HSN summary that goes at the foot of the bill, and that GSTR-1 Table 12
   * is filled in from. One row per HSN and rate.
   *
   * The taxable value is the line total MINUS its tax, never quantity times
   * unit price. A shop order is priced tax inclusive, so its `unit_price` is
   * what the customer paid with the tax already inside it. Multiplying that out
   * and calling it the taxable value overstates the taxable value by the tax,
   * and then adding the tax again overstates the total by the same amount. On a
   * 1180 rupee line at 18 per cent it declares 1180 taxable and a 1360 total
   * against a bill that says 1000 and 1180.
   *
   * `total - tax_amount` is right in both pricing modes, because gstService
   * writes `total` as the gross either way. Summing the stored `total` rather
   * than recomputing it is what makes this table tie back to the bill it sits
   * on, which is the only property that matters here.
   *
   * Scoped by wholesaler. This reads a whole invoice by id, so without the
   * owner check it is a way to read somebody else's book.
   */
  async getHsnSummary(invoiceId, wholesalerId) {
    await ensureSchema();
    const has = await schemaExtras();
    const query = `
      SELECT
        NULLIF(TRIM(i.hsn_code), '') AS hsn_code,
        ROUND(COALESCE(i.gst_percent, 0)::numeric, 2) AS gst_percent,
        -- The taxable value is the line total less BOTH levies, because the
        -- total carries both. Subtracting only the GST would overstate it by
        -- the cess, which is the same fault this query was fixed for once.
        ROUND(SUM(i.total - i.tax_amount - ${has.has_document_block ? "i.cess_amount" : "0"})::numeric, 2) AS taxable_amount,
        ROUND(SUM(i.tax_amount)::numeric, 2) AS gst_amount,
        ${has.has_document_block ? "ROUND(SUM(i.cess_amount)::numeric, 2)" : "0"} AS cess_amount,
        ROUND(SUM(i.total)::numeric, 2) AS total_amount
      FROM invoice_items i
      JOIN invoices inv ON inv.id = i.invoice_id
      WHERE i.invoice_id = $1 AND inv.supplier_id = $2
      GROUP BY NULLIF(TRIM(i.hsn_code), ''), i.gst_percent
      ORDER BY 1 NULLS LAST, 2
    `;
    const result = await pool.query(query, [invoiceId, wholesalerId]);
    return result.rows;
  }

  /**
   * Finds an invoice associated with an order ID.
   */
  async findInvoiceByOrderId(orderId) {
    await ensureSchema();
    const result = await pool.query(
      `SELECT id FROM invoices WHERE order_id = $1 LIMIT 1`,
      [orderId]
    );
    if (result.rows.length === 0) return null;
    return this.findInvoiceById(result.rows[0].id);
  }

  /**
   * Search & filter invoices with role scoping and pagination.
   */
  async findInvoices({
    userId,
    role,
    side,
    search,
    invoiceStatus,
    paymentStatus,
    startDate,
    endDate,
    page = 1,
    limit = 10,
    sortBy = "created_at",
    sortOrder = "DESC",
  }) {
    await ensureSchema();
    const has = await schemaExtras();
    const recipient = recipientColumns(has.has_recipient);
    try {
      const offset = (page - 1) * limit;
      const params = [];
      let paramIndex = 1;

      let whereClauses = [];

      // Scope by who the user is on the invoice, never by their account role:
      // the same person sells to some accounts and buys from others, and role
      // scoping used to hide one whole side of their books from them.
      const normRole = String(role || "").toLowerCase();
      const normSide = String(side || "").toLowerCase();
      if (normRole !== "admin") {
        if (normSide === "sales") {
          whereClauses.push(`i.supplier_id = $${paramIndex++}`);
          params.push(userId);
        } else if (normSide === "purchases") {
          whereClauses.push(`i.buyer_id = $${paramIndex++}`);
          params.push(userId);
        } else {
          whereClauses.push(`(i.buyer_id = $${paramIndex} OR i.supplier_id = $${paramIndex})`);
          params.push(userId);
          paramIndex++;
        }
      }

      if (search) {
        whereClauses.push(`(
          i.invoice_number ILIKE $${paramIndex} OR
          bu.first_name ILIKE $${paramIndex} OR
          bu.last_name ILIKE $${paramIndex} OR
          bwp.company_name ILIKE $${paramIndex} OR
          su.first_name ILIKE $${paramIndex} OR
          swp.company_name ILIKE $${paramIndex} OR
          bwp.gstin ILIKE $${paramIndex}
          ${
            has.has_recipient
              ? `OR i.recipient_name ILIKE $${paramIndex}
              OR i.recipient_gstin ILIKE $${paramIndex}`
              : ""
          }
        )`);
        params.push(`%${search}%`);
        paramIndex++;
      }

      if (invoiceStatus) {
        whereClauses.push(`i.invoice_status = $${paramIndex++}`);
        params.push(invoiceStatus);
      }

      // Cancelled invoices stay in the ledger - the numbering sequence has to
      // stay honest and a voided document is part of the audit trail - but
      // they are out of the way unless you ask for them by status.
      if (String(invoiceStatus || "").toLowerCase() !== "cancelled") {
        whereClauses.push(`i.invoice_status <> 'Cancelled'`);
      }

      // Both parties being the same account is never a real tax invoice; those
      // rows only exist from before self-ordering was blocked.
      whereClauses.push(`i.buyer_id IS DISTINCT FROM i.supplier_id`);

      if (paymentStatus) {
        // "Partial" is no longer written, but rows carrying it exist from
        // before the rule changed. Filtering for "Not paid" has to find them
        // or a bill with money owing on it drops out of the list that is
        // supposed to chase it.
        if (paymentStatus === "Pending") {
          whereClauses.push(`i.payment_status IN ($${paramIndex++}, 'Partial')`);
        } else {
          whereClauses.push(`i.payment_status = $${paramIndex++}`);
        }
        params.push(paymentStatus);
      }

      if (startDate) {
        whereClauses.push(`i.issue_date >= $${paramIndex++}`);
        params.push(startDate);
      }

      if (endDate) {
        whereClauses.push(`i.issue_date <= $${paramIndex++}`);
        params.push(endDate);
      }

      const whereString = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

      const countQuery = `
        SELECT COUNT(*)::int AS total
        FROM invoices i
        LEFT JOIN users bu ON i.buyer_id = bu.id
        LEFT JOIN wholesaler_profiles bwp ON bu.id = bwp.user_id
        LEFT JOIN users su ON i.supplier_id = su.id
        LEFT JOIN wholesaler_profiles swp ON su.id = swp.user_id
        ${whereString}
      `;

      const countResult = await pool.query(countQuery, params);
      const total = countResult.rows[0]?.total || 0;

      const allowedSortFields = ["created_at", "issue_date", "due_date", "grand_total", "invoice_number"];
      const validSortBy = allowedSortFields.includes(sortBy) ? `i.${sortBy}` : "i.created_at";
      const validSortOrder = sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";

      const dataQuery = `
        SELECT 
          i.id,
          i.invoice_number,
          i.order_id,
          i.buyer_id,
          i.supplier_id,
          i.subtotal,
          i.discount,
          i.shipping_charge,
          i.taxable_amount,
          -- The tax split, not just the total. A sale register in Marg or
          -- Busy shows CGST, SGST and IGST as their own columns, because that
          -- is what gets copied onto the return, and a single "tax" figure
          -- has to be taken apart again by hand.
          i.cgst,
          i.sgst,
          i.igst,
          i.total_tax,
          i.grand_total,
          i.payment_status,
          i.invoice_status,
          i.issue_date,
          i.due_date,
          i.pdf_url,
          i.created_at,
          COALESCE(
            ${recipient.name}
            bwp.company_name,
            bu.first_name || ' ' || bu.last_name,
            'Buyer'
          ) AS buyer_name,
          COALESCE(swp.company_name, su.first_name || ' ' || su.last_name, 'Supplier') AS supplier_name,
          ${recipient.gstin} AS buyer_gstin,
          swp.gstin AS supplier_gstin
          ${
            // A credited invoice still reads Generated and, if the money had
            // come in, Paid. Without this the list shows a reversed bill as a
            // live one. At most one row joins: credit_notes has a unique index
            // on invoice_id, so this cannot multiply the result.
            has.has_credit_notes
              ? `,
          cn.note_number AS credit_note_number,
          cn.grand_total AS credited_amount`
              : ""
          }
        FROM invoices i
        LEFT JOIN users bu ON i.buyer_id = bu.id
        LEFT JOIN wholesaler_profiles bwp ON bu.id = bwp.user_id
        LEFT JOIN users su ON i.supplier_id = su.id
        LEFT JOIN wholesaler_profiles swp ON su.id = swp.user_id
        ${has.has_credit_notes ? "LEFT JOIN credit_notes cn ON cn.invoice_id = i.id" : ""}
        ${whereString}
        ORDER BY ${validSortBy} ${validSortOrder}
        LIMIT $${paramIndex++} OFFSET $${paramIndex++}
      `;

      params.push(limit, offset);
      const dataResult = await pool.query(dataQuery, params);

      return {
        invoices: dataResult.rows,
        pagination: {
          total,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(total / limit) || 1,
        },
      };
    } catch (err) {
      console.error("Error executing findInvoices query:", err.message);
      return {
        invoices: [],
        pagination: { total: 0, page: Number(page || 1), limit: Number(limit || 10), totalPages: 1 },
      };
    }
  }

  /**
   * Updates an invoice record.
   */
  async updateInvoice(id, updateData, client) {
    await ensureSchema(client);
    const dbClient = client || pool;
    const fields = [];
    const values = [];
    let idx = 1;

    // Column names cannot be parameterised, so they are matched against a
    // fixed list rather than interpolated from request keys.
    for (const [key, val] of Object.entries(updateData)) {
      if (!UPDATABLE_INVOICE_COLUMNS.has(key)) continue;
      fields.push(`${key} = $${idx++}`);
      values.push(val);
    }

    if (fields.length === 0) return this.findInvoiceById(id);

    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const query = `UPDATE invoices SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`;
    const result = await dbClient.query(query, values);
    return result.rows[0];
  }

  /**
   * Adds a payment record to an invoice.
   */
  /**
   * Records money against an invoice. THE ONLY WAY a payment row is written,
   * which is why the ceiling below lives here rather than in one caller.
   *
   * ---------------------------------------------------------------------------
   * THE RACE THIS CLOSES
   * ---------------------------------------------------------------------------
   * A bill raised from a shop order has TWO writers. `reconcileInvoiceForOrder`
   * mirrors what the order has received, and it runs in the BACKGROUND off
   * every payment event. A wholesaler recording the same money by hand is the
   * other. Reconcile was idempotent only in one direction: it refuses to add
   * when enough is already on the bill, but if it got there FIRST the hand
   * entry landed afterwards and nothing ever looked again.
   *
   * One instalment of 510 on a 1,020 order then showed as 1,020 received, and
   * the bill read fully paid with half still owed. It reproduced about one run
   * in three under load, which is why it went unnoticed: on an idle machine
   * the hand entry almost always won the race and reconcile then saw it.
   *
   * The fix is a CEILING both writers obey, taken under the same advisory lock
   * reconcile already uses, so whichever arrives second sees the first. For an
   * order backed invoice the ceiling is what the ORDER says has been received,
   * because the order is the authority over money that came in through the
   * shop. That is the same rule the sale side states as FOLLOWS_ORDER.
   *
   * Returns null when there is nothing left to record. Callers facing a person
   * turn that into a sentence; reconcile never sees it, because it works out
   * its own gap first and passes a figure that already fits.
   */
  async addPayment(paymentData, client) {
    await ensureSchema(client);
    const dbClient = client || pool;
    const { invoiceId, amount, paymentMethod, transactionId, paymentReference, remarks } = paymentData;

    /**
     * The same lock reconcile takes, on the same key.
     *
     * Advisory transaction locks are re-entrant within one transaction, so
     * reconcile taking it again here costs nothing. Without a client there is
     * no transaction to attach it to, and the lock would be released the
     * instant the statement finished, so the callers that matter pass one.
     */
    if (client) {
      await dbClient.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
        [invoiceId],
      );
    }

    let toRecord = Number(amount);

    const ceiling = await dbClient.query(
      `SELECT i.order_id, i.grand_total,
              o.amount_paid, o.payment_status AS order_payment_status,
              COALESCE((SELECT SUM(p.amount) FROM payments p
                         WHERE p.invoice_id = i.id), 0) AS already
         FROM invoices i
         LEFT JOIN orders o ON o.id = i.order_id
        WHERE i.id = $1`,
      [invoiceId],
    );

    const row = ceiling.rows[0];
    if (row && row.order_id) {
      const grandTotal = Number(row.grand_total || 0);
      const settled = ["paid", "completed"].includes(
        String(row.order_payment_status || "").toLowerCase(),
      );
      // Identical to the target reconcile computes. A settled order closes the
      // bill on the BILL's total, because the two differ by a rupee or so once
      // GST is worked out and settling on the order's figure would leave a few
      // paise owing forever.
      const target = settled
        ? grandTotal
        : Math.min(Number(row.amount_paid || 0), grandTotal);
      const room = Number((target - Number(row.already || 0)).toFixed(2));

      if (room <= 0) return null;
      if (toRecord > room) toRecord = room;
    }

    const result = await dbClient.query(
      `INSERT INTO payments (
        invoice_id, amount, payment_method, transaction_id, payment_reference, remarks
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [invoiceId, toRecord, paymentMethod, transactionId || null, paymentReference || null, remarks || null]
    );

    return result.rows[0];
  }

  /**
   * Records an activity log for an invoice.
   */
  async addLog(logData, client) {
    await ensureSchema(client);
    const dbClient = client || pool;
    const { invoiceId, action, performedBy, details } = logData;

    const result = await dbClient.query(
      `INSERT INTO invoice_logs (invoice_id, action, performed_by, details)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [invoiceId, action, performedBy || null, details || null]
    );

    return result.rows[0];
  }

  /**
   * Aggregates ERP dashboard metrics (Total Revenue, Paid, Pending, Overdue, GST, Charts).
   */
  async getDashboardStats(userId, role, side) {
    await ensureSchema();
    const has = await schemaExtras();
    const recipient = recipientColumns(has.has_recipient);
    try {
      const normRole = String(role || "").toLowerCase();
      const normSide = String(side || "").toLowerCase();
      const scopeClause = normRole === "admin"
        ? "1=1"
        : normSide === "sales"
        ? "supplier_id = $1"
        : normSide === "purchases"
        ? "buyer_id = $1"
        : "(supplier_id = $1 OR buyer_id = $1)";

      // Cancelled and self-dealing invoices are excluded everywhere here.
      // Counting a voided document towards revenue is what made the totals
      // look wrong after cleaning old rows up.
      const LIVE = `invoice_status <> 'Cancelled' AND buyer_id IS DISTINCT FROM supplier_id`;

      /**
       * A bill reversed by a credit note is not money to collect.
       *
       * Cancelling an invoice and crediting one are two different instruments
       * and only the first was excluded here. Under GST a bill that has been
       * handed over is reversed with a credit note, not by rewriting it, so
       * the invoice deliberately STAYS Generated and STAYS Pending. That is
       * correct as a record and wrong as a total: a 30,000 bill reversed in
       * full went on counting towards "still to come in" and towards revenue.
       *
       * The list beside these cards already knew better. StatusChip shows such
       * a row as "Credited" precisely because it is reversed, so the card and
       * the row underneath it disagreed, and the wholesaler was shown money to
       * chase that they had already credited back.
       *
       * Takes the invoice reference because this clause is pasted into three
       * queries and they do not all alias the table the same way. Unqualified
       * `id` would bind to credit_notes.id inside the subquery and quietly
       * match nothing, which is the worst of the available failures.
       *
       * credit_notes arrives with wholesale3_credit_notes.sql. Before that the
       * clause is TRUE, which is exactly how this behaved until now.
       */
      const notCredited = (ref) =>
        has.has_credit_notes
          ? `NOT EXISTS (SELECT 1 FROM credit_notes cn WHERE cn.invoice_id = ${ref}.id)`
          : "TRUE";

      const userClause = (ref) =>
        `${scopeClause} AND ${LIVE} AND ${notCredited(ref)}`;

      const params = normRole === "admin" ? [] : [userId];

      /**
       * The three cards on the Invoices tab, from money rather than from a
       * word on the invoice row.
       *
       * They used to be counted by payment_status alone, and the three of them
       * could not be reconciled with each other on a part paid bill:
       *
       *   "Still to come in" took the WHOLE grand_total of a Partial invoice,
       *   so a 1,420 bill with 710 already received said 1,420 was still to
       *   come in.
       *
       *   "Received" counted only invoices stamped Paid, so that same 710
       *   appeared under neither card. Money in the till, on no card.
       *
       *   The count beside "Still to come in" counted Pending only while its
       *   amount included Partial, so the card read "₹1,420 · 0 unpaid": an
       *   amount with no invoices behind it.
       *
       * Each invoice's own balance is worked out first, and the cards are sums
       * of balances. GREATEST floors a balance at zero so an overpaid bill
       * cannot eat into another bill's outstanding, which is the same rule
       * khataBalance uses per customer and for the same reason.
       *
       * A part paid bill past its due date is now overdue for its balance,
       * which it was not before: it was excluded entirely for not being
       * stamped Pending.
       */
      const statsQuery = `
        WITH live AS (
          SELECT i.id, i.grand_total, i.total_tax, i.payment_status, i.due_date,
                 COALESCE((SELECT SUM(p.amount) FROM payments p
                            WHERE p.invoice_id = i.id), 0) AS received
            FROM invoices i
           WHERE ${userClause("i")}
        ), balances AS (
          SELECT *,
                 /*
                  * A bill stamped Paid is fully received, by definition.
                  *
                  * Not every settled invoice has rows in the payments table. A bill
                  * raised from the SALE side deliberately writes none: that
                  * money is already recorded in party_payments against the
                  * sale, and writing it a second time into the invoice
                  * module's own table is what once made a bill read Paid while
                  * the customer still owed the whole amount.
                  *
                  * So counting those rows alone read every sale-side bill as
                  * wholly unpaid. A wholesaler saw two invoices both marked
                  * PAID in the list, above a card saying 1,35,700 still to
                  * come in from 2 unpaid, which was their exact sum.
                  *
                  * Since 12 Sept a bill is Paid or Pending and there is
                  * nothing in between, so the stamp answers this outright. The
                  * payment rows are consulted only for a bill that is NOT
                  * settled, where they say how much of it has arrived.
                  */
                 CASE WHEN payment_status = 'Paid' THEN 0
                      ELSE GREATEST(grand_total - received, 0) END AS balance,
                 CASE WHEN payment_status = 'Paid' THEN grand_total
                      ELSE LEAST(received, grand_total) END AS counted
            FROM live
        )
        SELECT
          COUNT(*)::int AS total_invoices,
          COALESCE(SUM(grand_total), 0)::numeric(12,2) AS total_revenue,
          COALESCE(SUM(counted), 0)::numeric(12,2) AS paid_amount,
          COALESCE(SUM(balance), 0)::numeric(12,2) AS pending_amount,
          COALESCE(SUM(CASE WHEN due_date < CURRENT_DATE THEN balance ELSE 0 END), 0)::numeric(12,2) AS overdue_amount,
          COALESCE(SUM(CASE WHEN payment_status = 'Refunded' THEN grand_total ELSE 0 END), 0)::numeric(12,2) AS refunded_amount,
          COALESCE(SUM(total_tax), 0)::numeric(12,2) AS total_gst_collected,
          COUNT(CASE WHEN balance <= 0.009 THEN 1 END)::int AS paid_count,
          COUNT(CASE WHEN balance > 0.009 THEN 1 END)::int AS pending_count,
          COUNT(CASE WHEN balance > 0.009 AND due_date < CURRENT_DATE THEN 1 END)::int AS overdue_count
        FROM balances
      `;

      const statsResult = await pool.query(statsQuery, params);
      const metrics = statsResult.rows[0];

      // Monthly revenue trend (last 6 months)
      const trendQuery = `
        SELECT 
          TO_CHAR(issue_date, 'Mon YYYY') AS month,
          DATE_TRUNC('month', issue_date) AS month_date,
          COALESCE(SUM(grand_total), 0)::numeric(12,2) AS revenue,
          COALESCE(SUM(total_tax), 0)::numeric(12,2) AS gst
        FROM invoices
        WHERE ${userClause("invoices")} AND issue_date >= CURRENT_DATE - INTERVAL '6 months'
        GROUP BY TO_CHAR(issue_date, 'Mon YYYY'), DATE_TRUNC('month', issue_date)
        ORDER BY month_date ASC
      `;
      const trendResult = await pool.query(trendQuery, params);

      // Status distribution
      const statusQuery = `
        SELECT 
          invoice_status AS status,
          COUNT(*)::int AS count,
          COALESCE(SUM(grand_total), 0)::numeric(12,2) AS amount
        FROM invoices
        WHERE ${userClause("invoices")}
        GROUP BY invoice_status
      `;
      const statusResult = await pool.query(statusQuery, params);

      // Top Buyers / Suppliers. "Purchases" lists who you bought from;
      // everything else lists who bought from you.
      const topPartiesQuery = normSide === "purchases"
        ? `
          SELECT 
            swp.company_name AS party_name,
            COUNT(i.id)::int AS invoice_count,
            COALESCE(SUM(i.grand_total), 0)::numeric(12,2) AS total_amount
          FROM invoices i
          LEFT JOIN users su ON i.supplier_id = su.id
          LEFT JOIN wholesaler_profiles swp ON su.id = swp.user_id
          WHERE i.buyer_id = $1
            AND i.invoice_status <> 'Cancelled'
            AND i.buyer_id IS DISTINCT FROM i.supplier_id
          GROUP BY swp.company_name
          ORDER BY total_amount DESC
          LIMIT 5
        `
        : `
          SELECT
            COALESCE(
              ${recipient.name}
              bwp.company_name,
              bu.first_name || ' ' || bu.last_name,
              'Customer'
            ) AS party_name,
            COUNT(i.id)::int AS invoice_count,
            COALESCE(SUM(i.grand_total), 0)::numeric(12,2) AS total_amount
          FROM invoices i
          LEFT JOIN users bu ON i.buyer_id = bu.id
          LEFT JOIN wholesaler_profiles bwp ON bu.id = bwp.user_id
          WHERE ${normRole === "admin" ? "1=1" : "i.supplier_id = $1"}
            AND i.invoice_status <> 'Cancelled'
            AND i.buyer_id IS DISTINCT FROM i.supplier_id
          -- recipient_name is part of the selected expression, so it has to
          -- be grouped as well or Postgres rejects the whole query. Dropping
          -- it from the SELECT above without dropping it here would do the
          -- same, which is why both come off the same flag.
          GROUP BY ${has.has_recipient ? "i.recipient_name, " : ""}bwp.company_name, bu.first_name, bu.last_name
          ORDER BY total_amount DESC
          LIMIT 5
        `;

      const topPartiesResult = await pool.query(topPartiesQuery, params);

      return {
        summary: metrics,
        revenueTrend: trendResult.rows,
        statusDistribution: statusResult.rows,
        topParties: topPartiesResult.rows,
      };
    } catch (err) {
      console.error("Error executing getDashboardStats query:", err.message);
      return {
        summary: {
          total_invoices: 0,
          total_revenue: "0.00",
          paid_amount: "0.00",
          pending_amount: "0.00",
          overdue_amount: "0.00",
          refunded_amount: "0.00",
          total_gst_collected: "0.00",
          paid_count: 0,
          pending_count: 0,
          overdue_count: 0,
        },
        revenueTrend: [],
        statusDistribution: [],
        topParties: [],
      };
    }
  }

  /**
   * Aggregates financial reports (GST breakdown, Outstanding, Invoice aging).
   */
  async getReportData(userId, role, startDate, endDate, side) {
    await ensureSchema();
    try {
      const normRole = String(role || "").toLowerCase();
      const normSide = String(side || "").toLowerCase();
      const scopeClause = normRole === "admin"
        ? "1=1"
        : normSide === "sales"
        ? "i.supplier_id = $1"
        : normSide === "purchases"
        ? "i.buyer_id = $1"
        : "(i.supplier_id = $1 OR i.buyer_id = $1)";

      // A cancelled invoice collects no GST and is owed by nobody, so it must
      // not appear in either the tax summary or the ageing buckets.
      const userClause = `${scopeClause} AND i.invoice_status <> 'Cancelled' AND i.buyer_id IS DISTINCT FROM i.supplier_id`;

      const params = normRole === "admin" ? [] : [userId];

      let dateClause = "";
      if (startDate && endDate) {
        const idx = params.length + 1;
        dateClause = ` AND i.issue_date BETWEEN $${idx} AND $${idx + 1}`;
        params.push(startDate, endDate);
      }

      const gstSummaryQuery = `
        SELECT 
          COALESCE(SUM(taxable_amount), 0)::numeric(12,2) AS total_taxable,
          COALESCE(SUM(cgst), 0)::numeric(12,2) AS total_cgst,
          COALESCE(SUM(sgst), 0)::numeric(12,2) AS total_sgst,
          COALESCE(SUM(igst), 0)::numeric(12,2) AS total_igst,
          COALESCE(SUM(total_tax), 0)::numeric(12,2) AS total_gst,
          COALESCE(SUM(grand_total), 0)::numeric(12,2) AS total_grand
        FROM invoices i
        WHERE ${userClause}${dateClause}
      `;
      const gstSummary = (await pool.query(gstSummaryQuery, params)).rows[0];

      const agingQuery = `
        SELECT 
          CASE 
            WHEN CURRENT_DATE - due_date <= 0 THEN 'Current (Not Due)'
            WHEN CURRENT_DATE - due_date BETWEEN 1 AND 30 THEN '1-30 Days Overdue'
            WHEN CURRENT_DATE - due_date BETWEEN 31 AND 60 THEN '31-60 Days Overdue'
            WHEN CURRENT_DATE - due_date BETWEEN 61 AND 90 THEN '61-90 Days Overdue'
            ELSE '90+ Days Overdue'
          END AS aging_bucket,
          COUNT(*)::int AS count,
          COALESCE(SUM(grand_total), 0)::numeric(12,2) AS amount
        FROM invoices i
        WHERE ${userClause} AND payment_status != 'Paid'
        GROUP BY aging_bucket
      `;
      const agingReport = (await pool.query(agingQuery, normRole === "admin" ? [] : [userId])).rows;

      return {
        gstSummary,
        agingReport,
      };
    } catch (err) {
      console.error("Error executing getReportData query:", err.message);
      return {
        gstSummary: {
          total_taxable: "0.00",
          total_cgst: "0.00",
          total_sgst: "0.00",
          total_igst: "0.00",
          total_gst: "0.00",
          total_grand: "0.00",
        },
        agingReport: [],
      };
    }
  }

  /**
   * Per-seller invoice defaults. Absent rows fall back to the platform
   * defaults rather than erroring, so the page works before it is ever saved.
   */
  async getSettings(userId) {
    await ensureSchema();
    // The number format columns arrive with wholesale3_invoice_number_format.
    // Until it has been run the defaults reproduce the old behaviour exactly.
    const has = await schemaExtras();
    const format = has.has_number_format ? ", number_suffix, number_pad_to" : "";
    const result = await pool.query(
      `SELECT prefix, due_days, default_tax_rate, default_notes, default_terms${format}
       FROM invoice_settings WHERE user_id = $1`,
      [userId]
    );

    const row = result.rows[0] || {};

    /**
     * The shape of a number for a wholesaler who has never set one.
     *
     * It used to be prefix INV, no suffix, padded to six, which reads
     * INV-000001: six leading zeros and no hint of which year it belongs to.
     *
     * The default now carries the financial year, which is how every Indian
     * accounting package a wholesaler has used already writes it. Busy's own
     * sample is OM/1/26-27. {FY} is substituted when the number is taken, so
     * it follows the year forward on its own; a suffix typed as the literal
     * "26-27" would still say 26-27 next April, which is a wrong year on a
     * legal document.
     *
     * Padding drops to zero because the year already makes the number read as
     * a series. INV/1/26-27 is ten characters and leaves room to grow inside
     * Rule 46(b)'s sixteen; INV/000001/26-27 is sixteen exactly, with no room
     * at all.
     *
     * A wholesaler who has saved a format keeps it. This only decides what
     * somebody who has never opened the screen gets.
     */
    const saved = Object.keys(row).length > 0;
    return {
      prefix: row.prefix || (saved ? "INV" : "INV/"),
      dueDays: Number(row.due_days ?? 15),
      defaultTaxRate: Number(row.default_tax_rate ?? 18),
      defaultNotes: row.default_notes ?? "Thank you for your business!",
      defaultTerms:
        row.default_terms ??
        "1. Goods once sold will not be returned.\n2. Payment is due within the agreed credit period.",
      // How their invoice number is shaped. See invoiceNumberService.
      numberSuffix: row.number_suffix ?? (saved ? "" : "/{FY}"),
      numberPadTo: Number(row.number_pad_to ?? (saved ? 6 : 0)),
    };
  }

  async saveSettings(userId, settings) {
    await ensureSchema();
    const has = await schemaExtras();
    const result = await pool.query(
      has.has_number_format
        ? `INSERT INTO invoice_settings (
             user_id, prefix, due_days, default_tax_rate, default_notes,
             default_terms, number_suffix, number_pad_to, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
           ON CONFLICT (user_id) DO UPDATE SET
             prefix = EXCLUDED.prefix,
             due_days = EXCLUDED.due_days,
             default_tax_rate = EXCLUDED.default_tax_rate,
             default_notes = EXCLUDED.default_notes,
             default_terms = EXCLUDED.default_terms,
             number_suffix = EXCLUDED.number_suffix,
             number_pad_to = EXCLUDED.number_pad_to,
             updated_at = CURRENT_TIMESTAMP
           RETURNING prefix, due_days, default_tax_rate, default_notes,
                     default_terms, number_suffix, number_pad_to`
        : `INSERT INTO invoice_settings (
             user_id, prefix, due_days, default_tax_rate, default_notes, default_terms, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
           ON CONFLICT (user_id) DO UPDATE SET
             prefix = EXCLUDED.prefix,
             due_days = EXCLUDED.due_days,
             default_tax_rate = EXCLUDED.default_tax_rate,
             default_notes = EXCLUDED.default_notes,
             default_terms = EXCLUDED.default_terms,
             updated_at = CURRENT_TIMESTAMP
           RETURNING prefix, due_days, default_tax_rate, default_notes, default_terms`,
      has.has_number_format
        ? [
            userId,
            settings.prefix,
            settings.dueDays,
            settings.defaultTaxRate,
            settings.defaultNotes,
            settings.defaultTerms,
            settings.numberSuffix ?? "",
            settings.numberPadTo ?? 6,
          ]
        : [
            userId,
            settings.prefix,
            settings.dueDays,
            settings.defaultTaxRate,
            settings.defaultNotes,
            settings.defaultTerms,
          ]
    );

    const row = result.rows[0];
    return {
      prefix: row.prefix,
      dueDays: Number(row.due_days),
      defaultTaxRate: Number(row.default_tax_rate),
      defaultNotes: row.default_notes,
      defaultTerms: row.default_terms,
      // The query has been RETURNING these on a migrated database all along
      // and this mapping dropped them, so a screen that saved a number format
      // got a reply that did not mention it and had no way of telling whether
      // it had been written. Absent when the migration has not been run, which
      // is what getSettings falls back on too.
      ...(row.number_suffix !== undefined
        ? {
            numberSuffix: row.number_suffix ?? "",
            numberPadTo: Number(row.number_pad_to ?? 0),
          }
        : {}),
    };
  }

  /**
   * The customers this supplier can raise an invoice against.
   *
   * Scoped to people who have actually ordered from or been invoiced by them.
   * Returning every account on the platform would hand any logged-in user the
   * full customer list, emails included.
   */
  async getBuyers(supplierId) {
    await ensureSchema();
    const result = await pool.query(
      `SELECT DISTINCT
        u.id,
        u.email,
        u.first_name,
        u.last_name,
        COALESCE(wp.company_name, u.first_name || ' ' || u.last_name) AS company_name
       FROM users u
       LEFT JOIN wholesaler_profiles wp ON u.id = wp.user_id
       WHERE u.id <> $1
         AND (
           EXISTS (SELECT 1 FROM orders o WHERE o.buyer_id = u.id AND o.supplier_id = $1)
           OR EXISTS (SELECT 1 FROM invoices i WHERE i.buyer_id = u.id AND i.supplier_id = $1)
         )
       ORDER BY company_name ASC`,
      [supplierId]
    );
    return result.rows;
  }

  /**
   * Which parts of wholesale 3.0 this database has. Callers outside this file
   * need it to decide whether a guard can apply at all.
   */
  async schemaExtras() {
    return schemaExtras();
  }

  // Tests point one process at more than one database.
  resetSchemaExtras() {
    resetSchemaExtras();
  }
}

module.exports = new InvoiceRepository();

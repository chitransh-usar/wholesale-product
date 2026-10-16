const pool = require("../config/db");
const { clean, fromPaise, toPaise } = require("../utils/money");
const saleInvoiceService = require("../services/saleInvoiceService");
const stockLedger = require("../services/stockLedger");
const { hasPartyLink } = require("../services/partyService");
const { hasSaleLink } = require("../services/orderSaleService");
const {
  balanceExpression,
  hasOpeningBalance,
} = require("../services/khataBalance");
const creditNoteService = require("../services/creditNoteService");
const invoiceRepository = require("../repositories/invoiceRepository");
const gstService = require("../services/gstService");
const { checkHsn, minHsnDigits } = require("../services/hsnService");
const challanService = require("../services/challanService");
const challanBook = require("../services/challanBook");
const { receivedExpression } = require("../services/saleSettlement");
const { nextSaleNumber } = require("../services/seriesNumbers");
const { businessId } = require("../middlewares/businessContext");
const {
  TRANSPORT_COLUMNS,
  parseTransport,
} = require("../services/transportDetails");
const { resolveChannel } = require("../services/salesChannels");

/**
 * Recording a sale is the wholesaler's core action. They are usually writing
 * down something that already happened, so a new sale is 'confirmed' rather
 * than 'draft' unless they say otherwise.
 *
 * Every query is scoped by the wholesaler id from the token. A party id in
 * the request body is checked against that scope before anything is written,
 * so a sale can never be attached to somebody else's customer.
 */

/**
 * Takes the next number in this wholesaler's own series. Must be called
 * inside a transaction: the upsert locks the sequence row until commit.
 */

/**
 * What a sale comes to, tax included.
 *
 * The rate a wholesaler quotes is BEFORE GST: "142 a metre" means the shop
 * pays 142 plus tax. So the tax belongs on the sale, not only on the bill.
 * The customer's khata is what they owe, and they owe the tax too.
 *
 * Run through gstService, the same function the invoice uses, rather than
 * worked out separately here. Two implementations of the same sum drift, and
 * the one thing that must never happen is a bill that disagrees with the sale
 * it was raised from.
 */
const priceSale = (lines, discountPaise) =>
  gstService.calculateGST({
    items: lines.map((line) => ({
      productName: line.itemName,
      quantity: line.quantity,
      unitPrice: line.rate,
      gstPercent: line.gstPercent,
      // On top of the GST, on the same taxable value. Zero for almost
      // everything, and zero is what a line without one carries.
      cessPercent: line.cessPercent,
      hsnCode: line.hsnCode || undefined,
    })),
    discount: fromPaise(discountPaise),
    shippingCharge: 0,
    isTaxInclusive: false,
  });

/**
 * The GST rate for a line: what was typed on it, else what the rate list says
 * for that item, else the wholesaler's own default.
 *
 * Resolved once when the sale is recorded and snapshot onto the line, so
 * changing a default next year cannot restate a sale from this year.
 */
const resolveRates = async (client, wholesalerId, lines) => {
  const settings = await invoiceRepository.getSettings(wholesalerId);
  const fallback = Number(settings.defaultTaxRate ?? 18);

  // Read off their shop listings, which is where a product's tax rate now
  // lives. It used to read the rate list, a second product table that has
  // since been merged into the listings and whose screen is gone: a rate
  // edited on the product page would have been ignored here, and a sale of
  // the same goods would have been taxed at whatever the dead table said.
  //
  // The column arrives with wholesale3_listing_billing_fields.sql. Until that
  // has been run every line falls back to the wholesaler's default rate.
  const has = await invoiceRepository.schemaExtras();
  if (!has.has_listing_billing) {
    return lines.map((line) => ({
      ...line,
      gstPercent: line.gstPercent ?? fallback,
    }));
  }

  const named = lines.map((line) => line.itemName.toLowerCase());
  const known = await client.query(
    `SELECT lower(p.name) AS name, si.gst_percent
       FROM supplier_inventory si
       JOIN products p ON p.id = si.product_id
      WHERE si.supplier_id = $1 AND si.gst_percent IS NOT NULL
        AND lower(p.name) = ANY($2::text[])`,
    [wholesalerId, named],
  );
  const byName = new Map(known.rows.map((row) => [row.name, Number(row.gst_percent)]));

  return lines.map((line) => ({
    ...line,
    gstPercent:
      line.gstPercent ??
      byName.get(line.itemName.toLowerCase()) ??
      fallback,
  }));
};

/**
 * Has this customer gone past the credit you allow him?
 *
 * TOLD, NEVER ENFORCED, and that is a decision rather than an omission. This
 * is a book: the wholesaler is writing down a sale that has already happened,
 * usually with the goods already gone. Refusing to record it would not undo
 * the sale, it would only leave the sale missing from the khata, which is the
 * one thing worse than a customer being over his limit.
 *
 * Marg and Busy both offer a hard block. Both are entered at the counter
 * BEFORE the goods move, which is the case where a block means something.
 *
 * `parties.credit_limit` has existed since the opening balance migration and
 * has been importable all along. Until this function nothing read it, so it
 * was a field that looked like a control and was not. A zero or a null means
 * no limit set, which is what almost every row says.
 *
 * Runs after the sale is committed and never inside its transaction: a
 * warning that could fail the write would be enforcement by accident.
 */
const creditWarning = async (wholesalerId, partyId, partyName) => {
  try {
    const { rows } = await pool.query(
      `SELECT credit_limit FROM parties WHERE id = $1 AND wholesaler_id = $2`,
      [partyId, wholesalerId]);
    const limit = Number(rows[0]?.credit_limit ?? 0);
    if (!Number.isFinite(limit) || limit <= 0) return null;

    const hasOrderParty = await hasPartyLink(pool);
    const hasBridge = await hasSaleLink(pool);
    const hasOpening = await hasOpeningBalance(pool);
    const owed = await pool.query(
      `SELECT ${balanceExpression({
        hasOrderParty, hasBridge, hasOpening, partyRef: "p.id",
      })} AS balance
         FROM parties p WHERE p.id = $1 AND p.wholesaler_id = $2`,
      [partyId, wholesalerId]);
    const balance = Number(owed.rows[0]?.balance ?? 0);
    if (balance <= limit) return null;

    return {
      partyName,
      limit,
      balance,
      over: Math.round((balance - limit) * 100) / 100,
      message:
        `${partyName} now owes ${balance.toFixed(2)}, which is past the `
        + `${limit.toFixed(2)} limit you set. The sale has been recorded.`,
    };
  } catch (err) {
    // A warning that breaks the response would be worse than no warning. The
    // sale is already saved by the time this runs.
    console.warn("Could not check the credit limit:", err.message);
    return null;
  }
};

/**
 * Validates and normalises the lines on a sale. Returns either an error
 * message or the cleaned lines with their amounts already worked out.
 */
const buildLines = (rawLines, minHsn = 4) => {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    return { error: "Add at least one item to this sale" };
  }

  const lines = [];
  for (const raw of rawLines) {
    const itemName = clean(raw.itemName ?? raw.item_name);
    if (!itemName) return { error: "Every line needs an item name" };

    const quantity = Number(raw.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { error: `Enter a quantity for ${itemName}` };
    }

    const rate = Number(raw.rate);
    if (!Number.isFinite(rate) || rate < 0) {
      return { error: `Enter a rate for ${itemName}` };
    }

    // Only taken when it was actually sent. Undefined means "use the rate
    // list, or my default"; zero is a real answer for an exempt item.
    const rawRate = raw.gstPercent ?? raw.gst_percent;
    let gstPercent;
    if (rawRate !== undefined && rawRate !== null && String(rawRate).trim() !== "") {
      gstPercent = Number(rawRate);
      if (!Number.isFinite(gstPercent) || gstPercent < 0 || gstPercent > 100) {
        return { error: `Enter a GST rate between 0 and 100 for ${itemName}` };
      }
    }

    // The HSN says what the goods ARE on a tax document. Blank is allowed and
    // common; a code of the wrong length is a slipped keystroke, and letting
    // it through prints a false description on a bill the customer claims their
    // input credit against.
    const hsn = checkHsn(raw.hsnCode ?? raw.hsn_code, { minDigits: minHsn });
    if (!hsn.ok) return { error: `${hsn.reason} Check the HSN for ${itemName}.` };

    // Cess is refused outright rather than clamped, because a silently
    // corrected tax rate is a wrong number nobody was told about.
    let cessPercent = 0;
    const rawCess = raw.cessPercent ?? raw.cess_percent;
    if (rawCess !== undefined && rawCess !== null && String(rawCess).trim() !== "") {
      cessPercent = Number(rawCess);
      if (!Number.isFinite(cessPercent) || cessPercent < 0 || cessPercent > 500) {
        return { error: `Enter a cess rate between 0 and 500 for ${itemName}` };
      }
    }

    lines.push({
      itemName,
      quantity,
      unit: clean(raw.unit),
      rate,
      gstPercent,
      cessPercent,
      // Snapshot from the rate list, so editing an item later cannot change
      // the HSN printed on a bill already raised.
      hsnCode: hsn.hsn,
      amountPaise: Math.round(toPaise(rate) * quantity),
      // Which listing this line is, when it was picked off one, and which
      // challan the goods already went out on. Both optional and neither
      // validated beyond being a value or nothing: a wrong id here costs a
      // movement that cannot be attributed, and refusing the whole sale over
      // it would be far worse than that. The stock ledger reads both.
      productId: clean(raw.productId ?? raw.product_id) || null,
      fromChallanId: clean(raw.fromChallan ?? raw.fromChallanId ?? raw.from_challan_id) || null,
    });
  }

  return { lines };
};

exports.createSale = async (req, res) => {
  const wholesalerId = businessId(req);
  const {
    partyId,
    saleDate,
    status,
    discount,
    notes,
    lines: rawLines,
    amountPaid,
    paymentMethod,
  } = req.body;

  if (!clean(partyId)) {
    return res.status(400).json({ message: "Choose a customer" });
  }

  const { lines, error } = buildLines(rawLines, await minHsnDigits());
  if (error) return res.status(400).json({ message: error });

  // Refused here rather than by the CHECK, so the wholesaler reads the four
  // choices instead of a constraint violation.
  const { values: transport, error: transportError } = parseTransport(req.body);
  if (transportError) return res.status(400).json({ message: transportError });

  // Which book this sale belongs to, and so which run of invoice numbers a
  // bill from it will draw on. Refused rather than defaulted, because a sale
  // filed in the wrong book is a run of numbers nobody can reconcile.
  const { channel, error: channelError } = await resolveChannel(req.body.channel, wholesalerId);
  if (channelError) return res.status(400).json({ message: channelError });

  const saleStatus = status || "confirmed";
  if (!["draft", "confirmed", "delivered"].includes(saleStatus)) {
    return res.status(400).json({ message: "Unknown status" });
  }

  const subtotalPaise = lines.reduce((sum, line) => sum + line.amountPaise, 0);
  const discountPaise = Math.max(0, toPaise(discount));
  if (discountPaise > subtotalPaise) {
    return res
      .status(400)
      .json({ message: "Discount cannot be more than the total" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // The party must be in this wholesaler's own book.
    const party = await client.query(
      "SELECT id, name FROM parties WHERE id = $1 AND wholesaler_id = $2",
      [partyId, wholesalerId],
    );
    if (party.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Customer not found" });
    }

    // Without the tax migration a sale has nowhere to put its tax, so it
    // behaves exactly as it did before: the total is the pre tax figure, and
    // the invoice backs the tax out of it. Half applying the new model would
    // be worse than either, so this falls back whole.
    const has = await invoiceRepository.schemaExtras();
    const priced = await resolveRates(client, wholesalerId, lines);
    const gst = has.has_sale_tax ? priceSale(priced, discountPaise) : null;
    const taxPaise = gst ? toPaise(gst.totalTax) : 0;
    const totalPaise = gst
      ? toPaise(gst.grandTotal)
      : subtotalPaise - discountPaise;

    // Checked against the tax inclusive total, which is what the customer
    // actually hands over. Against the pre-tax figure it would refuse money
    // the shop had genuinely paid.
    const paidPaise = Math.max(0, toPaise(amountPaid));
    if (paidPaise > totalPaise) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ message: "Amount received cannot be more than the bill" });
    }

    const saleNumber = await nextSaleNumber(client, wholesalerId);

    // Named rather than positional, for the reason createInvoice was changed:
    // two optional column groups counted out by hand is how the lorry number
    // ends up in the notes.
    const columns = [
      ["wholesaler_id", wholesalerId],
      ["party_id", partyId],
      ["sale_number", saleNumber],
      ["source", "wholesaler"],
      ["status", saleStatus],
      ["subtotal", fromPaise(subtotalPaise)],
      ["discount", fromPaise(discountPaise)],
      ["total", fromPaise(totalPaise)],
      ["notes", clean(notes)],
    ];
    if (has.has_sale_tax) columns.push(["tax_amount", fromPaise(taxPaise)]);
    if (has.has_cess) columns.push(["total_cess", gst ? gst.totalCess : 0]);
    if (has.has_sale_channel) columns.push(["channel", channel]);
    if (has.has_sale_transport) {
      for (const col of TRANSPORT_COLUMNS) columns.push([col, transport[col]]);
    }

    // sale_date keeps its COALESCE so a blank date still means today.
    const sale = await client.query(
      `INSERT INTO sales (${columns.map(([c]) => c).join(", ")}, sale_date)
       VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")},
               COALESCE($${columns.length + 1}::date, CURRENT_DATE))
       RETURNING *`,
      [...columns.map(([, v]) => v), clean(saleDate)],
    );
    const saleId = sale.rows[0].id;

    for (const [i, line] of priced.entries()) {
      const inserted = await client.query(
        // The cess rate AND what it came to, snapshot beside the GST for the
        // same reason: a term edited next year must not restate a bill raised
        // this year.
        `INSERT INTO sale_lines
           (sale_id, item_name, quantity, unit, rate, amount, hsn_code
            ${has.has_line_gst ? ", gst_percent" : ""}
            ${has.has_cess ? ", cess_percent, cess_amount" : ""})
         VALUES ($1, $2, $3, $4, $5, $6, $7${has.has_line_gst ? ", $8" : ""}${
           has.has_cess ? (has.has_line_gst ? ", $9, $10" : ", $8, $9") : ""
         })
         RETURNING id`,
        [
          saleId,
          line.itemName,
          line.quantity,
          line.unit,
          line.rate,
          fromPaise(line.amountPaise),
          line.hsnCode,
          ...(has.has_line_gst ? [line.gstPercent] : []),
          // The amount comes off the priced result rather than the raw line,
          // because gstService is the only thing that works it out.
          ...(has.has_cess
            ? [line.cessPercent ?? 0, Number(gst?.items?.[i]?.cessAmount ?? 0)]
            : []),
        ],
      );
      // Which listing this line is, and which challan it already went out on.
      // Stamped separately because the insert above builds its column list
      // from schema probes, see stockLedger.stampLine.
      await stockLedger.stampLine(
        client, "sale_lines", inserted.rows[0]?.id, line);
    }

    // The goods leave the building. Lines that came off a challan are skipped
    // inside record(), because they left when the challan was written and
    // counting them again here would take the same cloth out of stock twice.
    //
    // Dated with the sale, not with today, for the same reason the payment
    // below is: a wholesaler writing up Monday's sales on Thursday moved the
    // goods on Monday.
    await stockLedger.record(client, wholesalerId, {
      kind: "sale",
      documentId: saleId,
      documentNumber: saleNumber,
      movedOn: clean(saleDate),
      direction: "out",
      lines: priced,
    });

    // Money handed over at the same time as the goods is the normal case,
    // so it is recorded here rather than forcing a second trip.
    //
    // Dated with the sale, not with today. A wholesaler writing up Monday's
    // sales on Thursday would otherwise get a statement showing the goods on
    // Monday and the cash on Thursday, when both changed hands together.
    if (paidPaise > 0) {
      await client.query(
        `INSERT INTO party_payments
           (wholesaler_id, party_id, sale_id, amount, method, paid_on)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          wholesalerId,
          partyId,
          saleId,
          fromPaise(paidPaise),
          paymentMethod || "cash",
          sale.rows[0].sale_date,
        ],
      );
    }

    /**
     * Close the challans this was billed from, in the same transaction.
     *
     * The form loads pending challans into itself and posts their ids back.
     * Stamping here rather than after the commit means a bill and the
     * challans it came from land together or not at all: a bill raised
     * against challans that stayed open would let the same goods be billed
     * twice, and the second bill would look perfectly normal.
     *
     * A count that falls short means one was taken by another screen in
     * between, and billing the rest quietly is worse than refusing.
     */
    const challanIds = Array.isArray(req.body.challanIds) ? req.body.challanIds : [];
    if (challanIds.length > 0) {
      const closed = await challanBook.stampBilled(
        client, wholesalerId, "sale", challanIds, saleId);
      if (closed !== challanIds.length) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          message:
            "One of those challans was billed on another screen while this was open. Open the form again to see what is still pending.",
          code: "CHALLAN_TAKEN",
        });
      }
    }

    await client.query("COMMIT");

    // A cash sale settled at the counter is settled the moment it is written
    // down, so its bill is raised here rather than waiting for a button. Does
    // nothing when money is still owed. After the commit, because the sale has
    // to exist before it can be billed, and never awaited into the response:
    // the sale is recorded either way and a bill can always be raised again.
    saleInvoiceService
      .billIfSettled(sale.rows[0].id, wholesalerId)
      .catch((err) => console.warn("Bill on a settled sale skipped:", err.message));

    res.status(201).json({
      ...sale.rows[0],
      party_name: party.rows[0].name,
      amount_received: fromPaise(paidPaise),
      // Told, never enforced. See creditWarning.
      creditWarning: await creditWarning(
        wholesalerId, partyId, party.rows[0].name),
    });
  } catch (err) {
    await client.query("ROLLBACK");
    // A refusal that carries its own status is a rule the sale broke, not a
    // fault. Pass the reason on, or the wholesaler is left with "Server error"
    // and no idea that their number series has outgrown what GST allows.
    if (err.status) {
      return res.status(err.status).json({ message: err.message, code: err.code });
    }
    console.error("Error recording sale:", err);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
};

exports.listSales = async (req, res) => {
  const wholesalerId = businessId(req);
  const { partyId, status } = req.query;

  try {
    const params = [wholesalerId];
    let where = "s.wholesaler_id = $1";

    if (clean(partyId)) {
      params.push(partyId);
      where += ` AND s.party_id = $${params.length}`;
    }
    if (clean(status)) {
      params.push(status);
      where += ` AND s.status = $${params.length}`;
    }

    // Goods out on a challan, counted per sale so the list can show it. Only
    // once the migration has been run; before that the column is a plain zero
    // rather than the query failing.
    const hasChallans = await challanService.challanTablesExist();
    const challanCount = hasChallans
      ? `,
         (SELECT COUNT(*) FROM delivery_challans dc WHERE dc.sale_id = s.id) AS challan_count`
      : ",\n         0 AS challan_count";

    /**
     * What has actually come in against this sale.
     *
     * One rule, in services/saleSettlement.js. party_payments alone is not the
     * answer for a sale written from a shop order, because the buyer paid at
     * checkout and that money lands on orders.amount_paid; and the two cannot
     * simply be added, because the khata also carries a MIRROR of that shop
     * payment. See that file for why it is neither the sum nor the greater.
     */
    const listed = await invoiceRepository.schemaExtras();
    const received = receivedExpression({ hasOrderId: listed.has_sale_order_id });

    const result = await pool.query(
      `SELECT
         s.id, s.sale_number, s.sale_date, s.status, s.source, s.total,
         p.name AS party_name, p.business_name AS party_business_name,
         (SELECT COUNT(*) FROM sale_lines sl WHERE sl.sale_id = s.id) AS line_count,
         ${received} AS received${challanCount}
       FROM sales s
       JOIN parties p ON p.id = s.party_id
       WHERE ${where}
       ORDER BY s.sale_date DESC, s.created_at DESC
       LIMIT 200`,
      params,
    );

    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Error listing sales:", err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getSaleById = async (req, res) => {
  const wholesalerId = businessId(req);
  const { id } = req.params;

  try {
    const has = await invoiceRepository.schemaExtras();

    // The order this sale came from, when it came from one. The page needs it
    // to send the wholesaler to the order rather than offering them a second
    // set of buttons for the same goods, see updateSaleStatus below.
    const fromOrder = has.has_sale_order_id;

    const sale = await pool.query(
      `SELECT s.*, p.name AS party_name, p.business_name AS party_business_name,
              p.phone AS party_phone, p.city AS party_city, p.gstin AS party_gstin
              ${fromOrder ? ", o.order_number, o.status AS order_status" : ""}
         FROM sales s
         JOIN parties p ON p.id = s.party_id
         ${fromOrder ? "LEFT JOIN orders o ON o.id = s.order_id" : ""}
        WHERE s.id = $1 AND s.wholesaler_id = $2`,
      [id, wholesalerId],
    );

    if (sale.rows.length === 0) {
      return res.status(404).json({ message: "Sale not found" });
    }

    const [lines, payments, creditNote] = await Promise.all([
      pool.query(
        // Carries the stored GST rate back to the edit form, so editing a
        // sale reprices it exactly as it was priced.
        `SELECT id, item_name, quantity, unit, rate, amount, hsn_code,
                ${has.has_line_gst ? "gst_percent" : "NULL AS gst_percent"}
           FROM sale_lines WHERE sale_id = $1 ORDER BY created_at ASC`,
        [id],
      ),
      pool.query(
        `SELECT id, amount, method, paid_on, note
           FROM party_payments WHERE sale_id = $1 ORDER BY paid_on DESC`,
        [id],
      ),
      // Usually null. When it is not, the bill for this sale has been
      // reversed and the page has to say so, or the invoice reads live.
      creditNoteService.findBySaleId(id, wholesalerId),
    ]);

    // Whether this sale is settled is the one question the billing rule turns
    // on, so it comes from the same function the server uses rather than
    // being worked out again on the screen from a different set of rows. An
    // order backed sale has money on the order as well as in party_payments,
    // which a client side sum would miss.
    const settlement = await challanService.settlementForSale(id, wholesalerId);

    res.status(200).json({
      sale: sale.rows[0],
      lines: lines.rows,
      payments: payments.rows,
      creditNote,
      settlement,
      // Whether a challan may be raised at all, so the screen does not have
      // to know the rule.
      challansOn: challanService.challanEnabled() && (await challanService.challanTablesExist()),
    });
  } catch (err) {
    console.error("Error fetching sale:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// The four states are a deliberate spine, not a lifecycle. Once a wholesaler
// describes how they actually works, this is where the real stages go.
const ALLOWED_NEXT = {
  draft: ["confirmed", "cancelled"],
  confirmed: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

exports.updateSaleStatus = async (req, res) => {
  const wholesalerId = businessId(req);
  const { id } = req.params;
  const { status } = req.body;

  try {
    const has = await invoiceRepository.schemaExtras();

    const current = await pool.query(
      `SELECT status${has.has_sale_order_id ? ", order_id" : ""}
         FROM sales WHERE id = $1 AND wholesaler_id = $2`,
      [id, wholesalerId],
    );
    if (current.rows.length === 0) {
      return res.status(404).json({ message: "Sale not found" });
    }

    /**
     * A sale that came from a shop order does not get its own switches.
     *
     * The goods being delivered is one event. It had two buttons: the order
     * had a lifecycle that stamps a delivery date and starts the return
     * window, and the sale had a plain "Mark delivered" that knew nothing
     * about any of it. Pressing the second one left an order still sitting at
     * "shipped" and a sale saying "delivered", with the return window counted
     * from a date the order never got.
     *
     * The order lifecycle is the authority. Move the order and the sale
     * follows, in orderStatusService.
     */
    if (current.rows[0].order_id) {
      return res.status(409).json({
        code: "FOLLOWS_ORDER",
        orderId: current.rows[0].order_id,
        message:
          "This sale came from a shop order, so it follows that order. Change the order and this will follow.",
      });
    }

    const from = current.rows[0].status;
    if (!ALLOWED_NEXT[from]?.includes(status)) {
      return res.status(400).json({
        message:
          ALLOWED_NEXT[from]?.length === 0
            ? `A ${from} sale cannot be changed`
            : `A ${from} sale cannot become ${status}`,
      });
    }

    // The status change and the stock coming back are one act.
    //
    // This was a bare pool.query until the stock ledger existed, and it could
    // stay one while cancelling only moved a status. It cannot now: a cancel
    // that marked the sale dead and then failed to give the goods back would
    // leave stock permanently short, with a cancelled document standing next
    // to it saying the goods never went. The credit note below is still raised
    // outside the transaction, on purpose, for the reason stated there.
    const client = await pool.connect();
    let updated;
    try {
      await client.query("BEGIN");
      updated = await client.query(
        `UPDATE sales SET status = $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2 AND wholesaler_id = $3 RETURNING *`,
        [status, id, wholesalerId],
      );
      if (status === "cancelled") {
        await stockLedger.reverse(client, wholesalerId, "sale", id,
          `Sale ${updated.rows[0]?.sale_number} cancelled`);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    // A cancelled sale must not leave a live bill standing against the
    // customer. Voiding the invoice was the old answer and it was the wrong
    // instrument: once a bill has been handed over, the way to reverse it is
    // a credit note, which is a document of its own that the customer can put
    // in their books too. The invoice stands. See creditNoteService.
    let creditNote = null;
    if (status === "cancelled") {
      try {
        const invoice = await saleInvoiceService.findBySaleId(id, wholesalerId);
        if (invoice) {
          const result = await creditNoteService.createCreditNote({
            invoiceId: invoice.id,
            wholesalerId,
            reason: "sale_cancelled",
            reasonNote: `Sale ${updated.rows[0].sale_number} was cancelled`,
          });
          creditNote =
            result.creditNote ||
            (await creditNoteService.findByInvoiceId(invoice.id, wholesalerId));
        }
      } catch (creditError) {
        // The sale is already cancelled and committed. Failing the whole
        // request now would tell them it did not work when it did, so this is
        // logged and the note is left to be raised by hand from the bill.
        console.error("Could not raise a credit note for this sale:", creditError);
      }
    }

    res.status(200).json({ ...updated.rows[0], creditNote });
  } catch (err) {
    console.error("Error updating sale status:", err);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * Raises the bill for a sale, or hands back the one already raised. A sale
 * gets exactly one invoice: a second would give the same goods two numbers.
 */
exports.createInvoiceForSale = async (req, res) => {
  const wholesalerId = businessId(req);
  const { id } = req.params;

  const REASONS = {
    notFound: [404, "Sale not found"],
    cancelled: [400, "A cancelled sale cannot be billed"],
    draft: [400, "Confirm this sale before raising a bill"],
    empty: [400, "This sale has no items to bill"],
    // Not a failure so much as "not yet". The screen turns this into an
    // offer to send the goods out on a challan instead.
    unpaid: [409, "This sale is not fully paid yet, so the bill waits"],
  };

  try {
    const result = await saleInvoiceService.createInvoiceFromSale(id, wholesalerId);

    if (result.error) {
      const [status, message] = REASONS[result.error] || [400, "Cannot bill this sale"];
      // The unpaid case carries the numbers with it, so the screen can say
      // how much is left rather than making them go and look.
      if (result.error === "unpaid") {
        return res.status(status).json({
          message,
          code: "UNPAID",
          outstanding: result.outstanding,
          received: result.received,
          total: result.total,
        });
      }
      return res.status(status).json({ message, code: result.error });
    }

    res.status(result.created ? 201 : 200).json(result.invoice);
  } catch (err) {
    console.error("Error raising invoice for sale:", err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getInvoiceForSale = async (req, res) => {
  const wholesalerId = businessId(req);
  try {
    const invoice = await saleInvoiceService.findBySaleId(req.params.id, wholesalerId);
    if (!invoice) return res.status(404).json({ message: "No bill raised yet" });
    res.status(200).json(invoice);
  } catch (err) {
    console.error("Error fetching invoice for sale:", err);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * Changes a recorded sale. A typo in a bill silently corrupts a customer's
 * balance, and until now it was permanent.
 *
 * Three things are deliberately not editable.
 *
 * The customer. Moving a sale to a different party would move money between
 * two khatas and orphan any payment attached to it. If the wrong customer was
 * picked, cancel the sale and record it again: the cancelled row stays, which
 * is the honest history.
 *
 * A sale that has been billed. An invoice is a fixed document with a fixed
 * number. Under GST you correct one with a credit note, not by rewriting it,
 * and credit notes are launch phase work.
 *
 * The sale number and its status, which are not content.
 */
exports.updateSale = async (req, res) => {
  const wholesalerId = businessId(req);
  const { id } = req.params;
  const { saleDate, discount, notes, lines: rawLines } = req.body;

  const { lines, error } = buildLines(rawLines, await minHsnDigits());
  if (error) return res.status(400).json({ message: error });

  const { values: transport, error: transportError } = parseTransport(req.body);
  if (transportError) return res.status(400).json({ message: transportError });

  // A paused account still owns the sales already filed under it, so editing
  // one of those must not be refused for naming it.
  const { channel, error: channelError } = await resolveChannel(
    req.body.channel,
    wholesalerId,
    undefined,
    { allowPaused: true },
  );
  if (channelError) return res.status(400).json({ message: channelError });

  const subtotalPaise = lines.reduce((sum, line) => sum + line.amountPaise, 0);
  const discountPaise = Math.max(0, toPaise(discount));
  if (discountPaise > subtotalPaise) {
    return res
      .status(400)
      .json({ message: "Discount cannot be more than the total" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const has = await invoiceRepository.schemaExtras();
    const existing = await client.query(
      `SELECT id, status, sale_number${has.has_sale_order_id ? ", order_id" : ""}
         FROM sales WHERE id = $1 AND wholesaler_id = $2 FOR UPDATE`,
      [id, wholesalerId],
    );
    if (existing.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Sale not found" });
    }

    const sale = existing.rows[0];

    // The same rule as the status buttons, for the same reason. A sale
    // written from a shop order owes exactly what the customer agreed at
    // checkout, and part of it may already be paid. Retyping the lines here
    // would move the debt away from the figure they pressed pay on.
    if (sale.order_id) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        code: "FOLLOWS_ORDER",
        orderId: sale.order_id,
        message:
          "This sale came from a shop order, so its amounts are what the customer agreed at checkout and cannot be retyped here.",
      });
    }

    if (sale.status === "cancelled") {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ message: "A cancelled sale cannot be changed" });
    }

    const billed = await client.query(
      "SELECT invoice_number FROM invoices WHERE sale_id = $1",
      [id],
    );
    if (billed.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        message: `Bill ${billed.rows[0].invoice_number} has been raised for this sale, so it cannot be changed`,
      });
    }

    // Editing the total down below what has already come in would leave the
    // customer having overpaid a bill that no longer exists at that amount.
    const receivedRow = await client.query(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM party_payments WHERE sale_id = $1",
      [id],
    );
    const priced = await resolveRates(client, wholesalerId, lines);
    const gst = has.has_sale_tax ? priceSale(priced, discountPaise) : null;
    const taxPaise = gst ? toPaise(gst.totalTax) : 0;
    const totalPaise = gst
      ? toPaise(gst.grandTotal)
      : subtotalPaise - discountPaise;

    const receivedPaise = toPaise(receivedRow.rows[0].total);
    if (totalPaise < receivedPaise) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        message: `₹${fromPaise(receivedPaise)} has already been received against this sale, so the total cannot go below that`,
      });
    }

    // Same name and value pairs as the insert. A lorry is booked after the sale
    // is written at least as often as before it, so this has to be editable.
    const sets = [
      ["subtotal", fromPaise(subtotalPaise)],
      ["discount", fromPaise(discountPaise)],
      ["total", fromPaise(totalPaise)],
      ["notes", clean(notes)],
    ];
    if (has.has_sale_tax) sets.push(["tax_amount", fromPaise(taxPaise)]);
    if (has.has_cess) sets.push(["total_cess", gst ? gst.totalCess : 0]);
    if (has.has_sale_channel) sets.push(["channel", channel]);
    if (has.has_sale_transport) {
      for (const col of TRANSPORT_COLUMNS) sets.push([col, transport[col]]);
    }

    await client.query(
      `UPDATE sales SET
         sale_date = COALESCE($2::date, sale_date),
         ${sets.map(([c], i) => `${c} = $${i + 3}`).join(", ")},
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id, clean(saleDate), ...sets.map(([, v]) => v)],
    );

    // Lines are replaced wholesale. Nothing references a sale line, so there
    // is nothing to preserve by trying to match them up one by one.
    await client.query("DELETE FROM sale_lines WHERE sale_id = $1", [id]);
    for (const [i, line] of priced.entries()) {
      await client.query(
        // The cess rate AND what it came to, snapshot beside the GST for the
        // same reason: a term edited next year must not restate a bill raised
        // this year.
        `INSERT INTO sale_lines
           (sale_id, item_name, quantity, unit, rate, amount, hsn_code
            ${has.has_line_gst ? ", gst_percent" : ""}
            ${has.has_cess ? ", cess_percent, cess_amount" : ""})
         VALUES ($1, $2, $3, $4, $5, $6, $7${has.has_line_gst ? ", $8" : ""}${
           has.has_cess ? (has.has_line_gst ? ", $9, $10" : ", $8, $9") : ""
         })`,
        [
          id,
          line.itemName,
          line.quantity,
          line.unit,
          line.rate,
          fromPaise(line.amountPaise),
          line.hsnCode,
          ...(has.has_line_gst ? [line.gstPercent] : []),
          // The amount comes off the priced result rather than the raw line,
          // because gstService is the only thing that works it out.
          ...(has.has_cess
            ? [line.cessPercent ?? 0, Number(gst?.items?.[i]?.cessAmount ?? 0)]
            : []),
        ],
      );
    }

    await client.query("COMMIT");

    const updated = await pool.query(
      `SELECT s.*, p.name AS party_name FROM sales s
         JOIN parties p ON p.id = s.party_id
        WHERE s.id = $1`,
      [id],
    );
    res.status(200).json(updated.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error updating sale:", err);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
};

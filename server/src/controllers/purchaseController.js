const pool = require("../config/db");
const { clean, fromPaise, toPaise } = require("../utils/money");
const gstService = require("../services/gstService");
const stockLedger = require("../services/stockLedger");
const { checkHsn, minHsnDigits } = require("../services/hsnService");
const challanBook = require("../services/challanBook");
const invoiceRepository = require("../repositories/invoiceRepository");
const { nextPurchaseNumber } = require("../services/seriesNumbers");
const { businessId } = require("../middlewares/businessContext");
const { receivedExpression } = require("../services/supplierBalance");

/**
 * The purchase book: goods coming IN.
 *
 * Written as the mirror of saleController, down to the order of the checks,
 * because two screens that do the same arithmetic in two different orders is
 * how this codebase has been bitten repeatedly. Where the two genuinely differ
 * the difference is commented, and there are four:
 *
 *   1. The supplier's own bill number is recorded, and cannot be entered
 *      twice. See the migration for why that matters more than it looks.
 *   2. Each line says whether input tax credit may be claimed on it.
 *   3. There is no invoice. The bill is the supplier's document, not ours.
 *   4. It raises stock, through services/stockLedger.js, since 18 Sept. This
 *      line used to say nothing here touches stock, and that was right at the
 *      time: a sale did not lower it, so a purchase raising it would have made
 *      the figure climb for ever. Both move it now, in the one ledger, and a
 *      line that arrived on a purchase challan is skipped because the challan
 *      already brought it in.
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

/**
 * What a purchase comes to, tax included.
 *
 * Run through gstService, the same function the sale and the invoice use.
 * A second implementation of the same sum drifts, and the arithmetic is
 * identical: a rate before tax, a discount off the top, tax on what is left.
 *
 * KNOWN LIMIT, worth stating because it is a real one. The authority on a
 * purchase is the paper the supplier handed over, and their software may round
 * a line differently from ours, so a computed total can land a rupee away from
 * the printed one. That gap matters when it is claimed as input credit and
 * matched against GSTR-2B. Letting the wholesaler state the tax figure off the
 * bill is the correct next step and is written up in PROGRESS.md; computing it
 * the same way as everything else is the right thing to ship first, because it
 * is the arithmetic that is already tested.
 */
const pricePurchase = (lines, discountPaise) =>
  gstService.calculateGST({
    items: lines.map((line) => ({
      productName: line.itemName,
      quantity: line.quantity,
      unitPrice: line.rate,
      gstPercent: line.gstPercent,
      hsnCode: line.hsnCode || undefined,
    })),
    discount: fromPaise(discountPaise),
    shippingCharge: 0,
    isTaxInclusive: false,
  });

/**
 * Validates and normalises the lines on a purchase.
 *
 * The GST rate is NOT resolved from the wholesaler's own product list here,
 * which is the one place this deliberately parts company with buildLines on
 * the sale side. On a sale the rate is their to decide, so falling back to their
 * default is right. On a purchase the rate is whatever the supplier charged,
 * and guessing it from their own selling list would invent a tax figure on a
 * document they did not write. A line with no rate stated is taxed at zero and
 * says so on the screen.
 */
const buildLines = (rawLines, minHsn = 4) => {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    return { error: "Add at least one item to this purchase" };
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

    let gstPercent = 0;
    const rawRate = raw.gstPercent ?? raw.gst_percent;
    if (rawRate !== undefined && rawRate !== null && String(rawRate).trim() !== "") {
      gstPercent = Number(rawRate);
      if (!Number.isFinite(gstPercent) || gstPercent < 0 || gstPercent > 100) {
        return { error: `Enter a GST rate between 0 and 100 for ${itemName}` };
      }
    }

    const hsn = checkHsn(raw.hsnCode ?? raw.hsn_code, { minDigits: minHsn });
    if (!hsn.ok) return { error: `${hsn.reason} Check the HSN for ${itemName}.` };

    // Defaults to claimable, because the great majority of a wholesaler's
    // purchases are. Only an explicit false switches it off.
    const itcEligible =
      (raw.itcEligible ?? raw.itc_eligible) === undefined
        ? true
        : Boolean(raw.itcEligible ?? raw.itc_eligible);

    lines.push({
      itemName,
      quantity,
      unit: clean(raw.unit),
      rate,
      gstPercent,
      hsnCode: hsn.hsn,
      itcEligible,
      amountPaise: Math.round(toPaise(rate) * quantity),
      // Which listing this line is, and which challan the goods already
      // arrived on. The stock ledger reads both. Same rule as the sale side:
      // optional, and a bad id costs an unattributed movement rather than
      // refusing the whole bill.
      productId: clean(raw.productId ?? raw.product_id) || null,
      fromChallanId: clean(raw.fromChallan ?? raw.fromChallanId ?? raw.from_challan_id) || null,
    });
  }

  return { lines };
};

/**
 * The supplier bill unique index, turned into something a person can act on.
 *
 * Worth catching by name rather than reporting "server error", because hitting
 * it means the wholesaler is about to enter a bill they have already entered,
 * which is the thing the index exists to stop.
 */
const duplicateBill = (err, res, supplierInvoiceNumber) => {
  if (err.code !== "23505") return false;
  if (!String(err.constraint || "").includes("supplier_bill")) return false;
  res.status(409).json({
    code: "DUPLICATE_BILL",
    message: `Bill ${supplierInvoiceNumber} from this supplier is already in your book. Entering it twice would claim its tax credit twice.`,
  });
  return true;
};

exports.createPurchase = async (req, res) => {
  const wholesalerId = businessId(req);
  const {
    supplierId,
    purchaseDate,
    supplierInvoiceNumber,
    supplierInvoiceDate,
    status,
    discount,
    notes,
    lines: rawLines,
    amountPaid,
    paymentMethod,
  } = req.body;

  if (!clean(supplierId)) {
    return res.status(400).json({ message: "Choose a supplier" });
  }

  const { lines, error } = buildLines(rawLines, await minHsnDigits());
  if (error) return res.status(400).json({ message: error });

  const purchaseStatus = status || "received";
  if (!["draft", "received"].includes(purchaseStatus)) {
    return res.status(400).json({ message: "Unknown status" });
  }

  const subtotalPaise = lines.reduce((sum, line) => sum + line.amountPaise, 0);
  const discountPaise = Math.max(0, toPaise(discount));
  if (discountPaise > subtotalPaise) {
    return res
      .status(400)
      .json({ message: "Discount cannot be more than the total" });
  }

  if (!(await purchasesReady(res))) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const supplier = await client.query(
      "SELECT id, name FROM suppliers WHERE id = $1 AND wholesaler_id = $2",
      [supplierId, wholesalerId],
    );
    if (supplier.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Supplier not found" });
    }

    const gst = pricePurchase(lines, discountPaise);
    const taxPaise = toPaise(gst.totalTax);
    const totalPaise = toPaise(gst.grandTotal);

    // Against the tax inclusive total, which is what actually leaves the till.
    const paidPaise = Math.max(0, toPaise(amountPaid));
    if (paidPaise > totalPaise) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ message: "Amount paid cannot be more than the bill" });
    }

    // A draft is somebody part way through typing, so it is not yet a debt and
    // must not carry money. Refused rather than quietly dropped: silently
    // losing a payment they typed is the worse failure of the two.
    if (paidPaise > 0 && purchaseStatus === "draft") {
      await client.query("ROLLBACK");
      return res.status(400).json({
        message:
          "A draft purchase cannot carry a payment. Mark it received, or leave the amount paid empty.",
      });
    }

    const purchaseNumber = await nextPurchaseNumber(client, wholesalerId);

    const purchase = await client.query(
      `INSERT INTO purchases
         (wholesaler_id, supplier_id, purchase_number, purchase_date,
          supplier_invoice_number, supplier_invoice_date, status,
          subtotal, discount, tax_amount, total, notes)
       VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5, $6::date,
               $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        wholesalerId,
        supplierId,
        purchaseNumber,
        clean(purchaseDate),
        clean(supplierInvoiceNumber),
        clean(supplierInvoiceDate),
        purchaseStatus,
        fromPaise(subtotalPaise),
        fromPaise(discountPaise),
        fromPaise(taxPaise),
        fromPaise(totalPaise),
        clean(notes),
      ],
    );
    const purchaseId = purchase.rows[0].id;

    for (const line of lines) {
      const inserted = await client.query(
        `INSERT INTO purchase_lines
           (purchase_id, item_name, quantity, unit, rate, amount,
            hsn_code, gst_percent, itc_eligible)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          purchaseId,
          line.itemName,
          line.quantity,
          line.unit,
          line.rate,
          fromPaise(line.amountPaise),
          line.hsnCode,
          line.gstPercent,
          line.itcEligible,
        ],
      );
      await stockLedger.stampLine(
        client, "purchase_lines", inserted.rows[0]?.id, line);
    }

    // The goods arrive. Lines that came off a purchase challan are skipped
    // inside record(), because they arrived when the challan was written.
    //
    // The note at the top of this file used to say nothing here touches
    // stock, and that was true and correct while a sale did not lower it
    // either. Both move it now, through the one ledger.
    await stockLedger.record(client, wholesalerId, {
      kind: "purchase",
      documentId: purchaseId,
      documentNumber: purchaseNumber,
      movedOn: clean(purchaseDate),
      direction: "in",
      lines,
    });

    // Dated with the purchase, not with today, for the same reason the sale
    // side does it: a wholesaler writing up Monday's bills on Thursday would
    // otherwise get a statement showing the goods on Monday and the cash on
    // Thursday when both moved together.
    if (paidPaise > 0) {
      await client.query(
        `INSERT INTO supplier_payments
           (wholesaler_id, supplier_id, purchase_id, amount, method, paid_on)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          wholesalerId,
          supplierId,
          purchaseId,
          fromPaise(paidPaise),
          paymentMethod || "cash",
          purchase.rows[0].purchase_date,
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
        client, wholesalerId, "purchase", challanIds, purchaseId);
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

    res.status(201).json({
      ...purchase.rows[0],
      supplier_name: supplier.rows[0].name,
      amount_paid: fromPaise(paidPaise),
    });
  } catch (err) {
    await client.query("ROLLBACK");
    if (duplicateBill(err, res, clean(supplierInvoiceNumber))) return;
    // A refusal that carries its own status is a rule the purchase broke, not
    // a fault. Pass the reason on rather than flattening it to "Server error".
    if (err.status) {
      return res.status(err.status).json({ message: err.message, code: err.code });
    }
    console.error("Error recording purchase:", err);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
};

exports.listPurchases = async (req, res) => {
  const wholesalerId = businessId(req);
  const { supplierId, status } = req.query;

  try {
    if (!(await purchasesReady(res))) return;

    const params = [wholesalerId];
    let where = "pu.wholesaler_id = $1";

    if (clean(supplierId)) {
      params.push(supplierId);
      where += ` AND pu.supplier_id = $${params.length}`;
    }
    if (clean(status)) {
      params.push(status);
      where += ` AND pu.status = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT
         pu.id, pu.purchase_number, pu.purchase_date, pu.status, pu.total,
         pu.supplier_invoice_number, pu.supplier_invoice_date,
         sup.name AS supplier_name, sup.business_name AS supplier_business_name,
         (SELECT COUNT(*) FROM purchase_lines pl WHERE pl.purchase_id = pu.id) AS line_count,
         ${receivedExpression("pu.id")} AS paid
       FROM purchases pu
       JOIN suppliers sup ON sup.id = pu.supplier_id
       WHERE ${where}
       ORDER BY pu.purchase_date DESC, pu.created_at DESC
       LIMIT 200`,
      params,
    );

    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Error listing purchases:", err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getPurchaseById = async (req, res) => {
  const wholesalerId = businessId(req);
  const { id } = req.params;

  try {
    if (!(await purchasesReady(res))) return;

    const purchase = await pool.query(
      `SELECT pu.*, sup.name AS supplier_name,
              sup.business_name AS supplier_business_name,
              sup.phone AS supplier_phone, sup.city AS supplier_city,
              sup.gstin AS supplier_gstin
         FROM purchases pu
         JOIN suppliers sup ON sup.id = pu.supplier_id
        WHERE pu.id = $1 AND pu.wholesaler_id = $2`,
      [id, wholesalerId],
    );
    if (purchase.rows.length === 0) {
      return res.status(404).json({ message: "Purchase not found" });
    }

    const [lines, payments] = await Promise.all([
      pool.query(
        `SELECT id, item_name, quantity, unit, rate, amount, hsn_code,
                gst_percent, itc_eligible
           FROM purchase_lines WHERE purchase_id = $1 ORDER BY created_at ASC`,
        [id],
      ),
      pool.query(
        `SELECT id, amount, method, paid_on, note
           FROM supplier_payments WHERE purchase_id = $1
          ORDER BY paid_on DESC, created_at DESC`,
        [id],
      ),
    ]);

    const paidPaise = payments.rows.reduce((sum, row) => sum + toPaise(row.amount), 0);
    const totalPaise = toPaise(purchase.rows[0].total);

    /**
     * The tax on this bill that can actually be set against tax collected.
     *
     * Not the same as the bill's tax_amount, and the difference is the whole
     * point of the itc_eligible column. Worked out here rather than on the
     * screen so one rule answers it, and so a blocked line cannot quietly
     * become claimable because a component summed a different column.
     *
     * A cancelled purchase claims nothing.
     */
    const claimablePaise =
      purchase.rows[0].status === "cancelled"
        ? 0
        : lines.rows.reduce((sum, line) => {
            if (!line.itc_eligible) return sum;
            return sum + Math.round((toPaise(line.amount) * Number(line.gst_percent || 0)) / 100);
          }, 0);

    res.status(200).json({
      purchase: purchase.rows[0],
      lines: lines.rows,
      payments: payments.rows,
      settlement: {
        total: fromPaise(totalPaise),
        paid: fromPaise(paidPaise),
        outstanding: fromPaise(Math.max(0, totalPaise - paidPaise)),
        settled: paidPaise >= totalPaise,
      },
      // Before the discount is spread, so it reads slightly high on a
      // discounted bill. Said plainly on the screen rather than silently.
      inputTaxCredit: {
        claimable: fromPaise(claimablePaise),
        blocked: lines.rows.some((line) => !line.itc_eligible),
      },
    });
  } catch (err) {
    console.error("Error fetching purchase:", err);
    res.status(500).json({ message: "Server error" });
  }
};

const ALLOWED_NEXT = {
  draft: ["received", "cancelled"],
  received: ["cancelled"],
  cancelled: [],
};

/**
 * Moves a purchase along its short spine.
 *
 * Cancelling does NOT delete the payments made against it. The money left the
 * till and pretending otherwise would be a lie about cash. What happens
 * instead is that those payments stop being tied to a bill that no longer
 * counts, so they fall back onto the supplier's account as money on account,
 * which is exactly what they now are. That is the same shape as the customer
 * side, where payments against a cancelled sale become the customer's credit.
 */
exports.updatePurchaseStatus = async (req, res) => {
  const wholesalerId = businessId(req);
  const { id } = req.params;
  const { status } = req.body;

  if (!(await purchasesReady(res))) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const current = await client.query(
      "SELECT status FROM purchases WHERE id = $1 AND wholesaler_id = $2 FOR UPDATE",
      [id, wholesalerId],
    );
    if (current.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Purchase not found" });
    }

    const from = current.rows[0].status;
    if (!ALLOWED_NEXT[from]?.includes(status)) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        message:
          ALLOWED_NEXT[from]?.length === 0
            ? `A ${from} purchase cannot be changed`
            : `A ${from} purchase cannot become ${status}`,
      });
    }

    const updated = await client.query(
      `UPDATE purchases SET status = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND wholesaler_id = $3 RETURNING *`,
      [status, id, wholesalerId],
    );

    let releasedToAccount = 0;
    if (status === "cancelled") {
      // The goods go back out of the book. A reversing row rather than a
      // delete, so the register still shows they arrived and then did not.
      await stockLedger.reverse(client, wholesalerId, "purchase", id,
        `Purchase ${updated.rows[0]?.purchase_number} cancelled`);

      const loosened = await client.query(
        `UPDATE supplier_payments SET purchase_id = NULL
          WHERE purchase_id = $1 AND wholesaler_id = $2
          RETURNING amount`,
        [id, wholesalerId],
      );
      releasedToAccount = loosened.rows.reduce(
        (sum, row) => sum + toPaise(row.amount),
        0,
      );
    }

    await client.query("COMMIT");
    res.status(200).json({
      ...updated.rows[0],
      releasedToAccount: fromPaise(releasedToAccount),
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error updating purchase status:", err);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
};

/**
 * Changes a recorded purchase.
 *
 * The supplier is not editable, for the same reason the customer is not
 * editable on a sale: moving it would move money between two accounts and
 * orphan any payment attached to it.
 *
 * A cancelled purchase is not editable either. Unlike a sale there is no
 * "already billed" gate, because no bill of ours was ever raised from a
 * purchase, so what stands in its place is the check that the total cannot
 * drop below what has already been paid out.
 */
exports.updatePurchase = async (req, res) => {
  const wholesalerId = businessId(req);
  const { id } = req.params;
  const {
    purchaseDate,
    supplierInvoiceNumber,
    supplierInvoiceDate,
    discount,
    notes,
    lines: rawLines,
  } = req.body;

  const { lines, error } = buildLines(rawLines, await minHsnDigits());
  if (error) return res.status(400).json({ message: error });

  const subtotalPaise = lines.reduce((sum, line) => sum + line.amountPaise, 0);
  const discountPaise = Math.max(0, toPaise(discount));
  if (discountPaise > subtotalPaise) {
    return res
      .status(400)
      .json({ message: "Discount cannot be more than the total" });
  }

  if (!(await purchasesReady(res))) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT id, status, purchase_number FROM purchases
        WHERE id = $1 AND wholesaler_id = $2 FOR UPDATE`,
      [id, wholesalerId],
    );
    if (existing.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Purchase not found" });
    }
    if (existing.rows[0].status === "cancelled") {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ message: "A cancelled purchase cannot be changed" });
    }

    const paidRow = await client.query(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM supplier_payments WHERE purchase_id = $1",
      [id],
    );

    const gst = pricePurchase(lines, discountPaise);
    const taxPaise = toPaise(gst.totalTax);
    const totalPaise = toPaise(gst.grandTotal);
    const paidPaise = toPaise(paidRow.rows[0].total);

    if (totalPaise < paidPaise) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        message: `₹${fromPaise(paidPaise)} has already been paid against this purchase, so the total cannot go below that`,
      });
    }

    await client.query(
      `UPDATE purchases SET
         purchase_date           = COALESCE($2::date, purchase_date),
         supplier_invoice_number = $3,
         supplier_invoice_date   = $4::date,
         subtotal                = $5,
         discount                = $6,
         tax_amount              = $7,
         total                   = $8,
         notes                   = $9,
         updated_at              = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [
        id,
        clean(purchaseDate),
        clean(supplierInvoiceNumber),
        clean(supplierInvoiceDate),
        fromPaise(subtotalPaise),
        fromPaise(discountPaise),
        fromPaise(taxPaise),
        fromPaise(totalPaise),
        clean(notes),
      ],
    );

    // Replaced wholesale. Nothing references a purchase line, so there is
    // nothing to preserve by matching them up one by one.
    await client.query("DELETE FROM purchase_lines WHERE purchase_id = $1", [id]);
    for (const line of lines) {
      await client.query(
        `INSERT INTO purchase_lines
           (purchase_id, item_name, quantity, unit, rate, amount,
            hsn_code, gst_percent, itc_eligible)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id,
          line.itemName,
          line.quantity,
          line.unit,
          line.rate,
          fromPaise(line.amountPaise),
          line.hsnCode,
          line.gstPercent,
          line.itcEligible,
        ],
      );
    }

    await client.query("COMMIT");

    const updated = await pool.query(
      `SELECT pu.*, sup.name AS supplier_name FROM purchases pu
         JOIN suppliers sup ON sup.id = pu.supplier_id
        WHERE pu.id = $1`,
      [id],
    );
    res.status(200).json(updated.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    if (duplicateBill(err, res, clean(supplierInvoiceNumber))) return;
    console.error("Error updating purchase:", err);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
};

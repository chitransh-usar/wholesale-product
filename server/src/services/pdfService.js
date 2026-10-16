const PDFDocument = require("pdfkit");
const { BRAND } = require("../config/brand");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");
const invoiceRepository = require("../repositories/invoiceRepository");
const { fullName } = require("../utils/money");
const { amountInWords } = require("../utils/amountInWords");

/**
 * Money, as it can actually be printed.
 *
 * Every amount on every bill this product has produced came out as "¹142.00".
 * PDFKit's built-in Helvetica is a WinAnsi font and has no rupee glyph, so the
 * ₹ was silently falling back to the superscript one. Nobody caught it because
 * the code reads correctly.
 *
 * The fix is "Rs.", not a font. Embedding one would mean carrying a TTF in the
 * repository and trusting it to be present on whatever host this runs on, for
 * a character that "Rs." says perfectly well to the traders using this.
 */
/**
 * The platform's own conventions, read once per process and refreshed by the
 * TTL in masterService. Held in a module level value because `rupees()` is
 * called from twenty one places inside synchronous drawing code, where an
 * await cannot go.
 *
 * Primed by `loadFormat()` at the top of each document. Until that first call
 * the shipped defaults apply, which is the same bargain the client makes and
 * is safe for the same reason: the defaults ARE what the product always did.
 */
let format = {
  documentDecimals: 2,
  digitGrouping: "indian",
};

const loadFormat = async () => {
  try {
    const settings = await require("./masterService").settings();
    format = {
      documentDecimals: Number(settings.documentDecimals ?? 2),
      digitGrouping: settings.digitGrouping || "indian",
    };
  } catch {
    // A bill that prints with the old convention beats a bill that does not
    // print, so this never throws.
  }
};

/**
 * Money, as it can actually be printed.
 *
 * Every amount on every bill this product has produced came out as "¹142.00".
 * PDFKit's built-in Helvetica is a WinAnsi font and has no rupee glyph, so the
 * ₹ was silently falling back to the superscript one. Nobody caught it because
 * the code reads correctly.
 *
 * The fix is "Rs.", not a font. Embedding one would mean carrying a TTF in the
 * repository and trusting it to be present on whatever host this runs on, for
 * a character that "Rs." says perfectly well to the traders using this. The
 * currency SYMBOL setting is therefore deliberately not read here: it is a
 * screen setting, and this is the one place that cannot honour it.
 *
 * THE GROUPING IS READ, though, and that is the point. This printed
 * Rs.1250000.00 with no separators at all while every screen showed
 * 12,50,000, which is the same number written two ways on the same trade. Now
 * both come from the platform's setting.
 */
const rupees = (value) =>
  `Rs.${Number(value || 0).toLocaleString(
    format.digitGrouping === "western" ? "en-US" : "en-IN",
    {
      minimumFractionDigits: format.documentDecimals,
      maximumFractionDigits: format.documentDecimals,
    },
  )}`;

/**
 * The PAN inside a GSTIN. Characters 3 to 12, by the number's own definition.
 * Rule 46 wants the supplier's PAN on the invoice, and this is it: not a
 * second field to store and keep in step, the same number read differently.
 */
const panFromGstin = (gstin) => {
  const clean = String(gstin || "").toUpperCase().replace(/[\s-]/g, "");
  return clean.length === 15 ? clean.slice(2, 12) : null;
};

// Spelled month, matching the screen. "13/5/2025" and "5/13/2025" are the
// same nine characters and mean different days, and a statement is read by a
// customer who did not choose the format.
const dateOf = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "";

// How the goods travel, as a person reads it. Stored as a word. The e-way bill
// API numbers these 1 to 4, which is an encoding detail of that API.
const TRANSPORT_MODE_TEXT = {
  road: "Road",
  rail: "Rail",
  air: "Air",
  ship: "Ship",
};

const METHOD_TEXT = {
  cash: "Cash",
  upi: "UPI",
  bank: "Bank transfer",
  cheque: "Cheque",
  other: "Other",
};

// One line describing a statement entry, in the customer's language rather
// than the database's.
const particularsOf = (row) => {
  if (row.kind === "sale") {
    return `Bill ${row.ref || ""}`.trim();
  }
  // Owed exactly like a bill, but named as what the customer actually did, so
  // they can match the line against the order on their phone.
  if (row.kind === "order") {
    return `Shop order ${row.ref || ""}`.trim();
  }
  const parts = [`Payment by ${METHOD_TEXT[row.method] || row.method || "cash"}`];
  if (row.ref) {
    parts.push(`against ${row.ref}${row.againstCancelled ? " (cancelled)" : ""}`);
  }
  if (row.note) parts.push(row.note);
  return parts.join(" - ");
};

// Printed on the credit note. The stored code is for the database; the
// customer reading the document gets a sentence.
const CREDIT_REASON_TEXT = {
  sale_cancelled: "The sale was cancelled",
  goods_returned: "The goods were returned",
  rate_revised: "The rate charged was corrected",
  other: "Other",
};

class PDFService {
  /**
   * Generates a professional A4 PDF Tax Invoice and streams it to an Express response or returns a Buffer.
   */
  async generateInvoicePDF(invoice, res = null, options = {}) {
    // Prime the formatter before any amount is drawn.
    await loadFormat();

    // Generate UPI QR code data URL asynchronously
    let qrDataUrl = null;
    try {
      const upiId = invoice.supplier_upi_id || "merchant@upi";
      const qrPayload = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(
        invoice.supplier_company || invoice.supplier_name || "Merchant"
      )}&am=${invoice.grand_total}&cu=INR&tn=${encodeURIComponent(
        `Invoice ${invoice.invoice_number}`
      )}`;
      qrDataUrl = await QRCode.toDataURL(qrPayload, { margin: 1, width: 100 });
    } catch (qrErr) {
      console.warn("QR code generation skipped:", qrErr.message);
    }

    /**
     * The e-invoice QR, rendered from the payload the IRP signed.
     *
     * Prepared out here beside the UPI one, because drawing happens inside a
     * plain Promise executor that cannot await. Null until a real submission
     * has stored a signed payload, and nothing is invented in the meantime.
     */
    let signedQrDataUrl = null;
    if (invoice.signed_qr) {
      try {
        signedQrDataUrl = await QRCode.toDataURL(invoice.signed_qr, { margin: 1, width: 160 });
      } catch (signedQrErr) {
        console.warn("Could not render the signed e-invoice QR:", signedQrErr.message);
      }
    }

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: "A4", margin: 36, bufferPages: true });
        const buffers = [];
        // Rule 46(o): Original for Recipient, Duplicate for Transporter,
        // Triplicate for Supplier. Defaults to the recipient's copy, which is
        // the one that goes out with the goods.
        const copyTitle = String(options.copy || "ORIGINAL FOR RECIPIENT").toUpperCase();

        if (res) {
          res.setHeader("Content-Type", "application/pdf");
          res.setHeader(
            "Content-Disposition",
            `inline; filename=${invoice.invoice_number || "invoice"}.pdf`
          );
          doc.pipe(res);
          doc.on("end", () => resolve());
        } else {
          doc.on("data", (chunk) => buffers.push(chunk));
          doc.on("end", () => resolve(Buffer.concat(buffers)));
        }
        doc.on("error", (err) => reject(err));

        const isPaid = (invoice.payment_status || "").toLowerCase() === "paid";
        const isCancelled = (invoice.invoice_status || "").toLowerCase() === "cancelled";

        // ----------------------------------------------------
        // WATERMARK (PAID / UNPAID / CANCELLED)
        // ----------------------------------------------------
        doc.save();
        doc.rotate(-45, { origin: [297, 421] });
        doc.fontSize(70);
        doc.fillColor(isPaid ? "#22c55e" : isCancelled ? "#ef4444" : "#f59e0b");
        doc.fillOpacity(0.12);
        const watermarkText = isPaid ? "PAID" : isCancelled ? "CANCELLED" : "UNPAID";
        doc.text(watermarkText, 100, 380, { align: "center", width: 400 });
        doc.restore();

        // Reset Opacity
        doc.fillOpacity(1);

        // ----------------------------------------------------
        // THE INVOICE HEAD
        // ----------------------------------------------------
        /**
         * Laid out the way a tax invoice in this trade is laid out: one ruled
         * frame, the seller on the left, the invoice particulars on the right,
         * the two addresses under them, and the transport as a bordered table
         * of its own.
         *
         * The number and dates used to float inside the dark banner at the top
         * right, which reads like a web header rather than a document. They now
         * sit in a ruled box beside the seller, which is where somebody looking
         * for the invoice number on a piece of paper looks first.
         */
        const L = 36;            // left edge
        const R = 559;           // right edge
        const MID = 300;         // where the frame splits
        const W = R - L;

        const rule = (yy, x1 = L, x2 = R) =>
          doc.rect(x1, yy, x2 - x1, 0.8).fill("#cbd5e1");
        const vrule = (yy, hh, x = MID) => doc.rect(x, yy, 0.8, hh).fill("#cbd5e1");

        /** A small grey caption over a block. */
        const caption = (text, x, yy) =>
          doc.fillColor("#64748b").fontSize(7).font("Helvetica-Bold").text(text, x, yy);

        /** Prints a list of lines from a y offset, skipping the blanks. */
        const stack = (list, x, startY, width, gap = 11) => {
          let ly = startY;
          for (const line of list.filter(Boolean)) {
            doc.text(line, x, ly, { width, height: gap - 1, ellipsis: true });
            ly += gap;
          }
          return ly;
        };

        /** "Bhiwandi, Maharashtra (27) - 421302", skipping whatever is blank. */
        const placeLine = (city, state, code, pincode) => {
          const where = [city, state && code ? `${state} (${code})` : state]
            .filter(Boolean)
            .join(", ");
          return [where, pincode].filter(Boolean).join(" - ") || null;
        };

        const asDate = (v) =>
          v ? new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : null;

        // Numeric and compact, for the transport table where the columns are
        // narrow and the row is read across rather than down. Day first, which
        // is how a date is read on a consignment note here.
        const shortDate = (v) => {
          if (!v) return null;
          const d = new Date(v);
          const pad = (n) => String(n).padStart(2, "0");
          return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
        };

        // The title bar. Just the title and which copy this is, because that is
        // all a banner should carry.
        doc.rect(L, 36, W, 34).fill("#0f172a");
        doc.fillColor("#ffffff").fontSize(15).font("Helvetica-Bold");
        doc.text("TAX INVOICE", L + 12, 47);
        // Rule 46(o) wants each copy marked.
        doc.fontSize(7.5).font("Helvetica").fillColor("#cbd5e1");
        doc.text(copyTitle, MID, 50, { align: "right", width: R - MID - 12 });

        /**
         * The frozen block wins over the join.
         *
         * These columns are copied onto the invoice when it is raised, so a
         * reprint shows the address the bill actually went out with rather
         * than wherever the firm is today. The joins stay as the fallback for
         * invoices raised before the block existed, which must keep printing
         * exactly as they were issued.
         */
        const sellerName = invoice.seller_name || invoice.supplier_company || invoice.supplier_name || "Wholesaler";
        const sellerGstin = invoice.seller_gstin || invoice.supplier_gstin;

        let y = 70;

        // --- Row one: the seller, and the invoice particulars beside it. ---
        const headTop = y;

        doc.fillColor("#1e293b").fontSize(10).font("Helvetica-Bold");
        doc.text(sellerName, L + 12, y + 10, { width: MID - L - 24, height: 12, ellipsis: true });
        doc.fontSize(8).font("Helvetica").fillColor("#475569");
        // Characters 3 to 12 of a GSTIN are the PAN, so this is the same number
        // read differently, not a second field to keep in step.
        const sellerEnd = stack(
          [
            invoice.seller_address,
            placeLine(
              invoice.seller_city || invoice.supplier_city,
              invoice.seller_state || invoice.supplier_state,
              invoice.seller_state_code,
              invoice.seller_pincode,
            ),
            sellerGstin ? `GSTIN  ${sellerGstin}` : null,
            panFromGstin(sellerGstin) ? `PAN  ${panFromGstin(sellerGstin)}` : null,
            (invoice.seller_phone || invoice.supplier_phone)
              ? `Phone  ${invoice.seller_phone || invoice.supplier_phone}` : null,
            invoice.supplier_upi_id ? `UPI  ${invoice.supplier_upi_id}` : null,
          ],
          L + 12, y + 26, MID - L - 24,
        );

        /**
         * The particulars, as label and value pairs on their own rules.
         *
         * A wholesaler chasing a payment reads down this column, so the labels
         * are fixed width and the values line up. Only what is known is
         * printed: a row reading "Due Date  -" is noise.
         */
        const particulars = [
          ["Invoice No.", invoice.invoice_number || null],
          ["Invoice Date", asDate(invoice.issue_date) || asDate(new Date())],
          ["Due Date", asDate(invoice.due_date)],
          [
            "Place of Supply",
            invoice.place_of_supply
              ? `${invoice.place_of_supply}${invoice.place_of_supply_code ? ` (${invoice.place_of_supply_code})` : ""}`
              : null,
          ],
          ["Reverse Charge", invoice.reverse_charge ? "Yes" : "No"],
          [
            "Reference",
            invoice.sale_number || invoice.order_number || null,
          ],
        ].filter(([, v]) => v);

        let py = y + 10;
        for (const [label, value] of particulars) {
          doc.fillColor("#64748b").fontSize(7.5).font("Helvetica");
          doc.text(label, MID + 12, py + 1, { width: 86 });
          doc.fillColor("#1e293b").fontSize(8.5).font("Helvetica-Bold");
          doc.text(String(value), MID + 100, py, { width: R - MID - 112, height: 11, ellipsis: true });
          py += 14;
        }

        const rowOneBottom = Math.max(sellerEnd + 6, py + 4, y + 96);
        caption("SUPPLIER (ISSUER)", L + 12, y + 2);
        rule(rowOneBottom);
        vrule(y, rowOneBottom - y);

        // --- Row two: billed to, and shipped to. ---
        y = rowOneBottom;

        caption("BILLED TO", L + 12, y + 6);
        doc.fillColor("#1e293b").fontSize(10).font("Helvetica-Bold");
        doc.text(
          invoice.recipient_name || invoice.buyer_company || invoice.buyer_name || "Buyer",
          L + 12, y + 18, { width: MID - L - 24, height: 12, ellipsis: true },
        );
        doc.fontSize(8).font("Helvetica").fillColor("#475569");
        const billedEnd = stack(
          [
            invoice.recipient_address,
            placeLine(
              invoice.recipient_city || invoice.buyer_city,
              invoice.recipient_state,
              invoice.recipient_state_code,
              invoice.recipient_pincode,
            ),
            `GSTIN  ${invoice.recipient_gstin || invoice.buyer_gstin || "Not registered"}`,
            (invoice.recipient_phone || invoice.buyer_phone)
              ? `Phone  ${invoice.recipient_phone || invoice.buyer_phone}` : null,
          ],
          L + 12, y + 34, MID - L - 24,
        );

        /**
         * Shipped to, and only when it differs.
         *
         * When the goods go to the billing address, repeating it is noise on a
         * page that is already dense. The caption says so instead, which is
         * what a printed invoice does.
         */
        const shipLines = [
          invoice.ship_to_name,
          invoice.ship_to_gstin ? `GSTIN  ${invoice.ship_to_gstin}` : null,
          invoice.ship_to_address,
          placeLine(
            invoice.ship_to_city,
            invoice.ship_to_state,
            invoice.ship_to_state_code,
            invoice.ship_to_pincode,
          ),
        ].filter(Boolean);

        caption("SHIPPED TO", MID + 12, y + 6);
        let shippedEnd;
        if (shipLines.length) {
          doc.fillColor("#1e293b").fontSize(10).font("Helvetica-Bold");
          doc.text(shipLines[0], MID + 12, y + 18, { width: R - MID - 24, height: 12, ellipsis: true });
          doc.fontSize(8).font("Helvetica").fillColor("#475569");
          shippedEnd = stack(shipLines.slice(1), MID + 12, y + 34, R - MID - 24);
        } else {
          doc.fillColor("#94a3b8").fontSize(8).font("Helvetica-Oblique");
          doc.text("Same as the billing address", MID + 12, y + 20, { width: R - MID - 24 });
          shippedEnd = y + 34;
        }

        // Dispatched from, under shipped to, and again only when it differs.
        const dispatchLines = [
          invoice.dispatch_from_name,
          invoice.dispatch_from_address,
          placeLine(
            invoice.dispatch_from_city,
            invoice.dispatch_from_state,
            invoice.dispatch_from_state_code,
            invoice.dispatch_from_pincode,
          ),
        ].filter(Boolean);

        if (dispatchLines.length) {
          caption("DISPATCHED FROM", MID + 12, shippedEnd + 4);
          doc.fontSize(8).font("Helvetica").fillColor("#475569");
          shippedEnd = stack(dispatchLines, MID + 12, shippedEnd + 16, R - MID - 24);
        }

        const rowTwoBottom = Math.max(billedEnd, shippedEnd) + 8;
        rule(rowTwoBottom);
        vrule(y, rowTwoBottom - y);
        y = rowTwoBottom;

        // ----------------------------------------------------
        // TRANSPORT, AS A TABLE
        // ----------------------------------------------------
        /**
         * A bordered table with its own column headings, not a paragraph of
         * "Label: value" pairs.
         *
         * These are the e-way bill fields, and on a real consignment note they
         * are read across by somebody at a checkpost comparing them against the
         * lorry in front of them. Ruled columns are how that is read. Written
         * as a run of text it looked like a note somebody had typed at the
         * bottom of the page.
         *
         * Printed only when something was recorded. Most counter sales have no
         * transport, and an empty row of headings reads like a gap.
         */
        // The widths add up to the frame, 523, so the last column closes on the
        // right edge rather than leaving a sliver.
        const transportCells = [
          ["TRANSPORTER", invoice.transporter_name, 96],
          ["TRANSPORTER ID", invoice.transporter_id, 88],
          ["MODE", invoice.transport_mode ? TRANSPORT_MODE_TEXT[invoice.transport_mode] : null, 38],
          ["VEHICLE", invoice.vehicle_number, 68],
          ["LR/RR NO.", invoice.transport_doc_number, 60],
          ["LR/RR DATE", shortDate(invoice.transport_doc_date), 62],
          ["GR NO.", invoice.gr_number, 55],
          ["GR DATE", shortDate(invoice.gr_date), 56],
        ];

        if (transportCells.some(([, v]) => v)) {
          doc.rect(L, y, W, 15).fill("#f1f5f9");
          let cx = L;
          doc.fillColor("#475569").fontSize(6.5).font("Helvetica-Bold");
          for (const [label, , wdt] of transportCells) {
            doc.text(label, cx + 6, y + 5, { width: wdt - 8, height: 8, ellipsis: true });
            cx += wdt;
          }
          rule(y + 15);

          cx = L;
          doc.fillColor("#1e293b").fontSize(7.5).font("Helvetica");
          for (const [, value, wdt] of transportCells) {
            doc.text(value || "-", cx + 6, y + 20, { width: wdt - 8, height: 10, ellipsis: true });
            cx += wdt;
          }

          // The column rules, drawn last so they sit over the fill.
          let vx = L;
          for (const [, , wdt] of transportCells.slice(0, -1)) {
            vx += wdt;
            doc.rect(vx, y, 0.8, 33).fill("#cbd5e1");
          }

          y += 33;
          rule(y);
        }

        // The frame's own left and right edges, from the title bar to here.
        doc.rect(L, headTop, 0.8, y - headTop).fill("#cbd5e1");
        doc.rect(R, headTop, 0.8, y - headTop).fill("#cbd5e1");

        y += 10;


        // Table Header
        doc.rect(36, y, 523, 22).fill("#0f172a");
        doc.fillColor("#ffffff").fontSize(8).font("Helvetica-Bold");

        doc.text("ITEM DESCRIPTION", 44, y + 6, { width: 170 });
        doc.text("HSN", 220, y + 6, { width: 45, align: "center" });
        // Quantity and the unit it is counted in. An e-invoice is validated on
        // the UQC, so the bill shows the same code it will be filed under.
        doc.text("QTY", 270, y + 6, { width: 40, align: "center" });
        doc.text("UNIT PRICE", 315, y + 6, { width: 65, align: "right" });
        doc.text("GST %", 385, y + 6, { width: 45, align: "center" });
        doc.text("TAX", 435, y + 6, { width: 55, align: "right" });
        doc.text("TOTAL (INR)", 495, y + 6, { width: 55, align: "right" });

        y += 22;

        const items = invoice.items || [];
        items.forEach((item, index) => {
          const isEven = index % 2 === 0;
          if (isEven) {
            doc.rect(36, y, 523, 20).fill("#f8fafc");
          }

          doc.fillColor("#1e293b").fontSize(8).font("Helvetica");
          doc.text(item.product_name || "Product", 44, y + 5, { width: 170, height: 12, ellipsis: true });
          doc.text(item.hsn_code || "-", 220, y + 5, { width: 45, align: "center" });
          // Through Number first: the column is NUMERIC now, so pg hands back
          // "2.500" and the bill would read 2.500 metres. The UQC rides with
          // the figure when the unit has one, and is simply absent when it
          // does not, rather than printing a stand in code.
          doc.text(
            item.uqc ? `${Number(item.quantity)} ${item.uqc}` : String(Number(item.quantity)),
            270, y + 5, { width: 40, align: "center" },
          );
          doc.text(rupees(item.unit_price), 315, y + 5, { width: 65, align: "right" });
          doc.text(`${item.gst_percent || 18}%`, 385, y + 5, { width: 45, align: "center" });
          doc.text(rupees(item.tax_amount), 435, y + 5, { width: 55, align: "right" });
          doc.text(rupees(item.total), 495, y + 5, { width: 55, align: "right" });

          y += 20;
        });

        // Line separator
        doc.rect(36, y, 523, 1).fill("#cbd5e1");
        y += 10;

        // ----------------------------------------------------
        // FINANCIAL SUMMARY & BREAKDOWN
        // ----------------------------------------------------
        const summaryY = y;

        // Left Box: Terms, Signature & QR Code
        doc.fontSize(8).font("Helvetica-Bold").fillColor("#334155").text("TERMS & CONDITIONS", 36, summaryY);
        doc.fontSize(7).font("Helvetica").fillColor("#64748b");
        doc.text(invoice.terms_conditions || "1. Goods once sold will not be taken back.\n2. Interest @ 18% p.a. will be charged on overdue payments.", 36, summaryY + 12, { width: 200 });

        if (invoice.notes) {
          doc.fontSize(8).font("Helvetica-Bold").fillColor("#334155").text("NOTES", 36, summaryY + 55);
          doc.fontSize(7).font("Helvetica").fillColor("#64748b").text(invoice.notes, 36, summaryY + 67, { width: 200 });
        }

        // Embed QR Code if available
        if (qrDataUrl) {
          try {
            doc.image(qrDataUrl, 250, summaryY, { width: 65, height: 65 });
            doc.fontSize(6).font("Helvetica").fillColor("#64748b").text("Scan to Pay via UPI", 245, summaryY + 68, { width: 75, align: "center" });
          } catch (qrEmbedErr) {
            console.warn("Could not embed QR code image into PDF", qrEmbedErr.message);
          }
        }

        // Right Box: Totals Table
        const boxX = 330;
        let boxY = summaryY;

        /**
         * The total is ruled, not filled.
         *
         * It used to be a solid dark bar with white text, which is a web
         * button dropped onto a document. A printed invoice sets its total
         * apart with a rule above and below and lets the figure carry the
         * weight, and that is also what survives a black and white printer
         * and a fax, which is still how a lot of these get sent.
         */
        const addTotalRow = (label, amount, isBold = false, isHighlight = false) => {
          if (isHighlight) {
            boxY += 4;
            doc.rect(boxX, boxY, 229, 1).fill("#0f172a");
            boxY += 5;
            doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(11);
          } else {
            doc.fillColor(isBold ? "#0f172a" : "#475569").font(isBold ? "Helvetica-Bold" : "Helvetica").fontSize(8);
          }
          doc.text(label, boxX + 10, boxY);
          doc.text(rupees(amount), boxX + 110, boxY, { align: "right", width: 110 });
          if (isHighlight) {
            boxY += 15;
            doc.rect(boxX, boxY, 229, 1).fill("#0f172a");
            boxY += 6;
          } else {
            boxY += 14;
          }
        };

        addTotalRow("Subtotal:", invoice.subtotal || 0);
        if (Number(invoice.discount) > 0) addTotalRow("Discount:", -Number(invoice.discount));
        if (Number(invoice.shipping_charge) > 0) addTotalRow("Shipping Charge:", invoice.shipping_charge);
        addTotalRow("Taxable Amount:", invoice.taxable_amount || 0, true);

        if (Number(invoice.cgst) > 0) addTotalRow("CGST:", invoice.cgst);
        if (Number(invoice.sgst) > 0) addTotalRow("SGST:", invoice.sgst);
        if (Number(invoice.igst) > 0) addTotalRow("IGST:", invoice.igst);

        addTotalRow("Total Tax:", invoice.total_tax || 0);
        // Its own line, because it is its own levy. It does not come out of
        // the GST above it and it is not part of that figure.
        if (Number(invoice.total_cess) > 0) {
          addTotalRow("Cess:", invoice.total_cess);
        }
        // Rounding, shown rather than swallowed, so taxable + tax + round off
        // visibly equals the grand total. Busy prints it as "Less: Rounded
        // Off"; gstService has returned it all along and nothing showed it.
        if (Number(invoice.round_off)) {
          addTotalRow("Rounded Off:", invoice.round_off);
        }
        addTotalRow("GRAND TOTAL:", invoice.grand_total || 0, true, true);

        // Total quantity, beside the money. A wholesaler checks the bale count
        // before they check the rupees.
        const totalQty = items.reduce((sum, i) => sum + Number(i.quantity || 0), 0);
        doc.fontSize(8).font("Helvetica").fillColor("#475569");
        doc.text(`Total quantity: ${Number(totalQty.toFixed(3))}`, boxX + 10, boxY);
        boxY += 16;

        // The amount in words, which is what a person checks the figure
        // against, because digits can be altered by hand and words cannot.
        doc.fontSize(8).font("Helvetica-Bold").fillColor("#1e293b");
        doc.text(amountInWords(invoice.grand_total || 0), 36, boxY + 6, { width: 523 });
        boxY += 30;

        // ----------------------------------------------------
        // HSN / SAC WISE TAX SUMMARY
        // ----------------------------------------------------
        // Rule 46 in practice: this is the table a buyer's accountant
        // reconciles against GSTR-2B. Built from the lines, so it needs no
        // new data, only adding up what is already on the page.
        //
        // The taxable value is the line total MINUS its tax, never quantity
        // times unit price. A shop order is priced tax inclusive, so its
        // unit_price already has the tax inside it, and multiplying that out
        // printed a taxable value overstated by exactly the tax on every
        // marketplace bill. total - tax is right whichever way the line was
        // priced, and it makes this table tie to the total above it.
        const byHsn = new Map();
        const anyCess = items.some((i) => Number(i.cess_amount) > 0);
        for (const item of items) {
          const key = `${item.hsn_code || "-"}|${Number(item.gst_percent ?? 18)}`;
          // Less BOTH levies. Subtracting only the GST would overstate the
          // taxable value by the cess, which is the same fault this table was
          // fixed for once already.
          const taxable =
            Number(item.total || 0) - Number(item.tax_amount || 0) - Number(item.cess_amount || 0);
          const row = byHsn.get(key) || {
            hsn: item.hsn_code || "-",
            rate: Number(item.gst_percent ?? 18),
            taxable: 0,
            tax: 0,
            cess: 0,
          };
          row.taxable += taxable;
          row.tax += Number(item.tax_amount || 0);
          row.cess += Number(item.cess_amount || 0);
          byHsn.set(key, row);
        }

        // The HSN table is 300 wide on the left, so the bank details and the
        // e-invoice block sit beside it rather than under it. Stacked below,
        // they ran straight through the footer.
        const sideY = boxY + 4;

        if (byHsn.size > 0) {
          let hy = boxY + 4;
          // Narrower money columns when a cess column has to fit beside them.
          const tW = anyCess ? 56 : 80;
          const xTaxable = anyCess ? 148 : 156;
          const xTax = xTaxable + tW + 4;
          const xCess = xTax + tW + 4;
          doc.rect(36, hy, 300, 16).fill("#0f172a");
          doc.fillColor("#ffffff").fontSize(7).font("Helvetica-Bold");
          doc.text("HSN/SAC", 42, hy + 5, { width: 66 });
          doc.text("RATE", 110, hy + 5, { width: 34, align: "right" });
          doc.text("TAXABLE", xTaxable, hy + 5, { width: tW, align: "right" });
          doc.text("TAX", xTax, hy + 5, { width: tW, align: "right" });
          if (anyCess) doc.text("CESS", xCess, hy + 5, { width: tW, align: "right" });
          hy += 16;

          let sumTaxable = 0;
          let sumTax = 0;
          let sumCess = 0;
          for (const row of byHsn.values()) {
            doc.fillColor("#1e293b").fontSize(7).font("Helvetica");
            doc.text(row.hsn, 42, hy + 4, { width: 66 });
            doc.text(`${row.rate}%`, 110, hy + 4, { width: 34, align: "right" });
            doc.text(rupees(row.taxable), xTaxable, hy + 4, { width: tW, align: "right" });
            doc.text(rupees(row.tax), xTax, hy + 4, { width: tW, align: "right" });
            if (anyCess) doc.text(rupees(row.cess), xCess, hy + 4, { width: tW, align: "right" });
            sumTaxable += row.taxable;
            sumTax += row.tax;
            sumCess += row.cess;
            hy += 13;
          }
          doc.rect(36, hy, 300, 1).fill("#cbd5e1");
          hy += 3;
          doc.fillColor("#0f172a").fontSize(7).font("Helvetica-Bold");
          doc.text("Total", 42, hy + 3, { width: 66 });
          doc.text(rupees(sumTaxable), xTaxable, hy + 3, { width: tW, align: "right" });
          doc.text(rupees(sumTax), xTax, hy + 3, { width: tW, align: "right" });
          if (anyCess) doc.text(rupees(sumCess), xCess, hy + 3, { width: tW, align: "right" });
        }

        // ----------------------------------------------------
        // BANK DETAILS AND THE E-INVOICE SLOT
        // ----------------------------------------------------
        // The bank as it stood when the bill was raised, not as it is today.
        // A customer paying an old invoice has to pay into the account that
        // invoice named.
        const bankBits = [
          invoice.bank_account_name ? `Account name: ${invoice.bank_account_name}` : null,
          invoice.bank_name ? `Bank: ${invoice.bank_name}` : null,
          invoice.bank_account_number ? `A/c No: ${invoice.bank_account_number}` : null,
          invoice.bank_ifsc ? `IFSC: ${invoice.bank_ifsc}` : null,
          invoice.bank_branch ? `Branch: ${invoice.bank_branch}` : null,
        ].filter(Boolean);

        let sideCursor = sideY;

        /**
         * The IRN, its acknowledgement and the signed QR.
         *
         * Nothing here is computed. An IRN is issued by the Invoice
         * Registration Portal once the invoice has been accepted, and the QR
         * is a payload the IRP signs. Anything worked out locally would not be
         * valid, so this prints only when a real submission has filled it in
         * and stays silent otherwise rather than showing an empty box that
         * looks like something failed.
         */
        if (invoice.irn) {
          doc.fillColor("#334155").fontSize(8).font("Helvetica-Bold");
          doc.text("E-INVOICE", 340, sideCursor);
          doc.fontSize(7).font("Helvetica").fillColor("#475569");
          // An IRN is 64 characters, which does not fit one column. Broken in
          // half rather than trimmed with an ellipsis, because a partial IRN
          // on a printed bill is no use to anybody checking it.
          const irn = String(invoice.irn);
          sideCursor = stack(
            [
              "IRN",
              irn.slice(0, 32),
              irn.length > 32 ? irn.slice(32) : null,
              invoice.ack_number ? `Ack No: ${invoice.ack_number}` : null,
              invoice.ack_date
                ? `Ack Date: ${new Date(invoice.ack_date).toLocaleDateString("en-IN")}`
                : null,
            ],
            340, sideCursor + 12, 140,
          );
          if (signedQrDataUrl) {
            try {
              doc.image(signedQrDataUrl, 489, sideY, { width: 60, height: 60 });
            } catch (signedQrErr) {
              console.warn("Could not embed the signed e-invoice QR:", signedQrErr.message);
            }
          }
          sideCursor = Math.max(sideCursor, sideY + 64) + 6;
        }

        if (bankBits.length) {
          doc.fillColor("#334155").fontSize(8).font("Helvetica-Bold");
          doc.text("BANK DETAILS", 340, sideCursor);
          doc.fontSize(7).font("Helvetica").fillColor("#475569");
          stack(bankBits, 340, sideCursor + 12, 219);
        }

        // ----------------------------------------------------
        // SIGNATURE & FOOTER & PAGE NUMBERS
        // ----------------------------------------------------
        const range = doc.bufferedPageRange();
        for (let i = range.start; i < range.start + range.count; i++) {
          doc.switchToPage(i);
          const footerY = 740;
          doc.rect(36, footerY, 523, 1).fill("#e2e8f0");

          doc.fontSize(8).font("Helvetica").fillColor("#64748b");
          doc.text("Thank you for your business!", 36, footerY + 10);
          doc.text("This is a computer-generated tax invoice. No signature required.", 36, footerY + 22);

          doc.fontSize(8).font("Helvetica-Bold").fillColor("#1e293b");
          doc.text("For " + (invoice.supplier_company || invoice.supplier_name || "Supplier"), 360, footerY + 10, { align: "right", width: 199 });
          doc.fontSize(7).font("Helvetica").fillColor("#94a3b8");
          doc.text("Authorized Signatory", 360, footerY + 32, { align: "right", width: 199 });

          // Page X of Y
          doc.fontSize(7).font("Helvetica").fillColor("#94a3b8").text(`Page ${i + 1} of ${range.count}`, 36, footerY + 32);
        }

        doc.end();
      } catch (err) {
        console.error("PDF Generation error:", err);
        if (res) res.status(500).send("Error generating PDF invoice");
        else reject(err);
      }
    });
  }

  /**
   * Generates an A4 credit note and streams it to an Express response, or
   * returns a Buffer.
   *
   * A document of its own rather than the invoice layout with a different
   * heading. Rule 53 wants a credit note to carry the serial number and date
   * of the invoice it credits, which a tax invoice has nowhere to put, and it
   * has no due date and nothing to pay, so the UPI QR and the payment
   * terms both come off.
   */
  async generateCreditNotePDF(note, res = null) {
    // Prime the formatter before any amount is drawn.
    await loadFormat();

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: "A4", margin: 36, bufferPages: true });
        const buffers = [];

        if (res) {
          res.setHeader("Content-Type", "application/pdf");
          res.setHeader(
            "Content-Disposition",
            `inline; filename=${note.note_number || "credit-note"}.pdf`,
          );
          doc.pipe(res);
          doc.on("end", () => resolve());
        } else {
          doc.on("data", (chunk) => buffers.push(chunk));
          doc.on("end", () => resolve(Buffer.concat(buffers)));
        }
        doc.on("error", (err) => reject(err));

        doc.save();
        doc.rotate(-45, { origin: [297, 421] });
        doc.fontSize(60).fillColor("#0284c7").fillOpacity(0.1);
        doc.text("CREDIT NOTE", 60, 380, { align: "center", width: 480 });
        doc.restore();
        doc.fillOpacity(1);

        doc.rect(36, 36, 523, 65).fill("#0f172a");
        doc.fillColor("#ffffff").fontSize(20).font("Helvetica-Bold");
        doc.text("CREDIT NOTE", 50, 48);
        doc.fontSize(9).font("Helvetica").fillColor("#94a3b8");
        doc.text(note.supplier_company || note.supplier_name || "Supplier", 50, 72);

        doc.fillColor("#ffffff").fontSize(12).font("Helvetica-Bold");
        doc.text(note.note_number || "CN-0000", 350, 48, { align: "right", width: 195 });
        doc.fontSize(8).font("Helvetica").fillColor("#cbd5e1");
        const issued = note.issue_date
          ? new Date(note.issue_date).toLocaleDateString("en-IN")
          : new Date().toLocaleDateString("en-IN");
        doc.text(`Date: ${issued}`, 350, 68, { align: "right", width: 195 });

        let y = 115;

        doc.rect(36, y, 255, 88).lineWidth(1).strokeColor("#e2e8f0").stroke();
        doc.rect(36, y, 255, 20).fill("#f8fafc");
        doc.fillColor("#334155").fontSize(9).font("Helvetica-Bold").text("ISSUED BY", 44, y + 5);
        doc.fillColor("#1e293b").fontSize(9).font("Helvetica-Bold")
          .text(note.supplier_company || note.supplier_name || "Supplier", 44, y + 26);
        doc.fontSize(8).font("Helvetica").fillColor("#475569");
        doc.text(`GSTIN: ${note.supplier_gstin || "N/A"}`, 44, y + 40);
        doc.text(`Phone: ${note.supplier_phone || "N/A"}`, 44, y + 52);
        doc.text(`Email: ${note.supplier_email || "N/A"}`, 44, y + 64);

        doc.rect(304, y, 255, 88).lineWidth(1).strokeColor("#e2e8f0").stroke();
        doc.rect(304, y, 255, 20).fill("#f8fafc");
        doc.fillColor("#334155").fontSize(9).font("Helvetica-Bold").text("ISSUED TO", 312, y + 5);
        doc.fillColor("#1e293b").fontSize(9).font("Helvetica-Bold")
          .text(note.recipient_name || "Customer", 312, y + 26);
        doc.fontSize(8).font("Helvetica").fillColor("#475569");
        doc.text(`GSTIN: ${note.recipient_gstin || "N/A"}`, 312, y + 40);
        doc.text(`Phone: ${note.recipient_phone || "N/A"}`, 312, y + 52);
        doc.text(`City: ${note.recipient_city || "N/A"}`, 312, y + 64);

        // The particular a credit note exists to carry: which invoice it
        // reverses, and why. Rule 53 asks for the first; the second is what
        // makes it any use to either side at audit.
        y += 100;
        doc.rect(36, y, 523, 40).fill("#f0f9ff");
        doc.fillColor("#0c4a6e").fontSize(9).font("Helvetica-Bold");
        doc.text(
          `Against tax invoice ${note.invoice_number || "N/A"} dated ${
            note.invoice_date
              ? new Date(note.invoice_date).toLocaleDateString("en-IN")
              : "N/A"
          }`,
          44,
          y + 8,
        );
        doc.fontSize(8).font("Helvetica").fillColor("#075985");
        doc.text(
          `Reason: ${CREDIT_REASON_TEXT[note.reason] || "Not stated"}${
            note.reason_note ? `  (${note.reason_note})` : ""
          }`,
          44,
          y + 23,
          { width: 500, height: 12, ellipsis: true },
        );

        y += 55;

        doc.rect(36, y, 523, 22).fill("#0f172a");
        doc.fillColor("#ffffff").fontSize(8).font("Helvetica-Bold");
        doc.text("ITEM DESCRIPTION", 44, y + 6, { width: 170 });
        doc.text("HSN", 220, y + 6, { width: 45, align: "center" });
        doc.text("QTY", 270, y + 6, { width: 40, align: "center" });
        doc.text("RATE", 315, y + 6, { width: 65, align: "right" });
        doc.text("GST %", 385, y + 6, { width: 45, align: "center" });
        doc.text("TAX", 435, y + 6, { width: 55, align: "right" });
        doc.text("TOTAL (INR)", 495, y + 6, { width: 55, align: "right" });
        y += 22;

        (note.items || []).forEach((item, index) => {
          if (index % 2 === 0) doc.rect(36, y, 523, 20).fill("#f8fafc");
          doc.fillColor("#1e293b").fontSize(8).font("Helvetica");
          doc.text(item.item_name || "Item", 44, y + 5, { width: 170, height: 12, ellipsis: true });
          doc.text(item.hsn_code || "-", 220, y + 5, { width: 45, align: "center" });
          doc.text(
            `${Number(item.quantity)}${item.unit ? ` ${item.unit}` : ""}`,
            270, y + 5, { width: 40, align: "center" },
          );
          doc.text(rupees(item.unit_price), 315, y + 5, { width: 65, align: "right" });
          doc.text(`${Number(item.gst_percent)}%`, 385, y + 5, { width: 45, align: "center" });
          doc.text(rupees(item.tax_amount), 435, y + 5, { width: 55, align: "right" });
          doc.text(rupees(item.total), 495, y + 5, { width: 55, align: "right" });
          y += 20;
        });

        doc.rect(36, y, 523, 1).fill("#cbd5e1");
        y += 10;

        const boxX = 330;
        let boxY = y;
        // Ruled, the same way the invoice total is. The two documents are
        // read side by side, so they should not be laid out differently.
        const addRow = (label, amount, isBold = false, isHighlight = false) => {
          if (isHighlight) {
            boxY += 4;
            doc.rect(boxX, boxY, 229, 1).fill("#0f172a");
            boxY += 5;
            doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(11);
          } else {
            doc.fillColor(isBold ? "#0f172a" : "#475569")
              .font(isBold ? "Helvetica-Bold" : "Helvetica").fontSize(8);
          }
          doc.text(label, boxX + 10, boxY);
          doc.text(rupees(amount), boxX + 110, boxY, { align: "right", width: 110 });
          if (isHighlight) {
            boxY += 15;
            doc.rect(boxX, boxY, 229, 1).fill("#0f172a");
            boxY += 6;
          } else {
            boxY += 14;
          }
        };

        addRow("Taxable value credited:", note.taxable_amount || 0, true);
        if (Number(note.cgst) > 0) addRow("CGST:", note.cgst);
        if (Number(note.sgst) > 0) addRow("SGST:", note.sgst);
        if (Number(note.igst) > 0) addRow("IGST:", note.igst);
        addRow("Total tax credited:", note.total_tax || 0);
        addRow("TOTAL CREDITED:", note.grand_total || 0, true, true);

        const range = doc.bufferedPageRange();
        for (let i = range.start; i < range.start + range.count; i++) {
          doc.switchToPage(i);
          const footerY = 740;
          doc.rect(36, footerY, 523, 1).fill("#e2e8f0");
          doc.fontSize(8).font("Helvetica").fillColor("#64748b");
          doc.text(
            "This credit note reverses the tax invoice named above. Keep it with that invoice.",
            36, footerY + 10,
          );
          doc.text("This is a computer-generated document. No signature required.", 36, footerY + 22);
          doc.fontSize(8).font("Helvetica-Bold").fillColor("#1e293b");
          doc.text(
            "For " + (note.supplier_company || note.supplier_name || "Supplier"),
            360, footerY + 10, { align: "right", width: 199 },
          );
          doc.fontSize(7).font("Helvetica").fillColor("#94a3b8");
          doc.text("Authorized Signatory", 360, footerY + 32, { align: "right", width: 199 });
          doc.text(`Page ${i + 1} of ${range.count}`, 36, footerY + 32);
        }

        doc.end();
      } catch (err) {
        console.error("Credit note PDF generation error:", err);
        if (res) res.status(500).send("Error generating credit note");
        else reject(err);
      }
    });
  }

  /**
   * One customer's account over a period, as a document.
   *
   * Unlike the invoice and the credit note this one has to paginate. Those
   * are a handful of lines by nature; a year of trading with one shop is
   * hundreds, and the existing single-page layout would have written them
   * off the bottom of the paper. So rows are drawn in a loop that starts a
   * new page when it runs out of room, and every page repeats the column
   * headings and carries the balance forward, the way a ledger book does.
   */

  /**
   * A challan.
   *
   * Deliberately does NOT look like a tax invoice, because it is not one and
   * the person receiving it has to be able to tell at a glance. No tax
   * columns, no GST summary, and a line under the heading saying in plain
   * words that it is not a bill and no input credit can be claimed against it.
   *
   * See challanService.js for what this document is and why the rule behind
   * it is expected to change.
   */
  async generateChallanPDF(challan, res = null) {
    // Prime the formatter before any amount is drawn.
    await loadFormat();

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: "A4", margin: 36, bufferPages: true });
        const buffers = [];

        if (res) {
          doc.pipe(res);
          doc.on("end", () => resolve());
        } else {
          doc.on("data", (chunk) => buffers.push(chunk));
          doc.on("end", () => resolve(Buffer.concat(buffers)));
        }
        doc.on("error", (err) => reject(err));

        const supplier = challan.supplier || {};

        // Header. Sage rather than the invoice's near black, so the two
        // documents are told apart across a desk.
        doc.rect(36, 36, 523, 62).fill("#4b5563");
        doc.fillColor("#ffffff").fontSize(18).font("Helvetica-Bold");
        doc.text("CHALLAN", 50, 52);
        doc.fontSize(8).font("Helvetica").fillColor("#e5e7eb");
        doc.text("Not a tax invoice. No input tax credit against this document.", 50, 76);
        doc.fillColor("#ffffff").fontSize(12).font("Helvetica-Bold");
        doc.text(challan.challan_number || "", 360, 52, { align: "right", width: 185 });
        doc.fontSize(8).font("Helvetica").fillColor("#e5e7eb");
        doc.text(`Dated: ${dateOf(challan.issue_date)}`, 360, 70, { align: "right", width: 185 });

        let y = 112;

        // Who sent it, and who it went to.
        doc.rect(36, y, 255, 18).fill("#f3f4f6");
        /**
         * The two halves swap by direction.
         *
         * A purchase challan came FROM the supplier TO us, so printing "FROM
         * <us>" and "DELIVER TO <supplier>" on it reads exactly backwards and
         * the paper would contradict the goods it went with.
         */
        const inward = challan.kind === "purchase";
        doc.fillColor("#374151").fontSize(8).font("Helvetica-Bold")
          .text(inward ? "RECEIVED FROM" : "FROM", 44, y + 5);
        doc.rect(304, y, 255, 18).fill("#f3f4f6");
        doc.fillColor("#374151").fontSize(8).font("Helvetica-Bold")
          .text(inward ? "RECEIVED BY" : "DELIVER TO", 312, y + 5);

        doc.fillColor("#111827").fontSize(9).font("Helvetica-Bold");
        const usName =
          supplier.company_name || fullName(supplier.first_name, supplier.last_name) || "Supplier";
        const themName = challan.recipient_name || (inward ? "Supplier" : "Customer");
        doc.text(inward ? themName : usName, 44, y + 24, { width: 240 });
        doc.text(inward ? usName : themName, 312, y + 24, { width: 240 });

        doc.fontSize(8).font("Helvetica").fillColor("#4b5563");
        const fromLines = [
          supplier.warehouse_address || supplier.city || "",
          supplier.gstin ? `GSTIN: ${supplier.gstin}` : "",
          supplier.contact_phone || supplier.phone || "",
        ].filter(Boolean);
        const toLines = [
          challan.recipient_address || "",
          challan.recipient_city || "",
          challan.recipient_gstin ? `GSTIN: ${challan.recipient_gstin}` : "",
          challan.recipient_phone || "",
        ].filter(Boolean);
        // The addresses follow the names above, or the paper would name one
        // party and give the other one's address underneath it.
        doc.text((inward ? toLines : fromLines).join("\n"), 44, y + 38, { width: 240 });
        doc.text((inward ? fromLines : toLines).join("\n"), 312, y + 38, { width: 240 });

        y += 96;

        // What it came from, so the goods can be traced back.
        const against = [
          challan.sale_number ? `Sale: ${challan.sale_number}` : "",
          challan.purchase_number ? `Purchase: ${challan.purchase_number}` : "",
          challan.order_number ? `Order: ${challan.order_number}` : "",
          challan.supplier_challan_number
            ? `Their challan: ${challan.supplier_challan_number}` : "",
        ].filter(Boolean).join("    ");
        if (against) {
          doc.fontSize(8).font("Helvetica").fillColor("#4b5563").text(against, 36, y);
          y += 16;
        }

        // The lines. Value only: no rate of tax, no tax amount, by instruction.
        doc.rect(36, y, 523, 20).fill("#4b5563");
        doc.fillColor("#ffffff").fontSize(8).font("Helvetica-Bold");
        doc.text("#", 44, y + 6);
        doc.text("DESCRIPTION OF GOODS", 66, y + 6);
        doc.text("HSN", 300, y + 6);
        doc.text("QTY", 360, y + 6, { width: 50, align: "right" });
        doc.text("UNIT", 416, y + 6);
        doc.text("VALUE", 460, y + 6, { width: 90, align: "right" });
        y += 20;

        let totalQty = 0;
        (challan.items || []).forEach((item, index) => {
          if (index % 2 === 0) doc.rect(36, y, 523, 18).fill("#f9fafb");
          doc.fillColor("#111827").fontSize(8).font("Helvetica");
          doc.text(String(index + 1), 44, y + 5);
          doc.text(item.item_name || "Item", 66, y + 5, { width: 228, ellipsis: true });
          doc.text(item.hsn_code || "-", 300, y + 5);
          doc.text(Number(item.quantity || 0).toFixed(3), 360, y + 5, { width: 50, align: "right" });
          doc.text(item.unit || "", 416, y + 5);
          doc.text(rupees(item.total), 460, y + 5, { width: 90, align: "right" });
          totalQty += Number(item.quantity || 0);
          y += 18;
        });

        doc.rect(36, y, 523, 1).fill("#9ca3af");
        y += 8;

        /**
         * Two different numbers, and the page has to say which is which.
         *
         * The lines above are the value of the goods BEFORE tax, because this
         * document carries no tax by instruction. What the customer owes is
         * the sale total, which includes it. Printing the second against a
         * column that sums to the first made the page disagree with itself.
         */
        const goodsValue = (challan.items || []).reduce(
          (sum, item) => sum + Number(item.total || 0), 0,
        );
        const owed = Number(challan.total_value || 0);
        const paid = Number(challan.amount_paid || 0);
        const due = Number((owed - paid).toFixed(2));

        doc.fontSize(8).font("Helvetica").fillColor("#4b5563");
        doc.text(`Total quantity: ${totalQty.toFixed(3)}`, 36, y);

        const rowRight = (label, amount, bold = false) => {
          doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 9 : 8);
          doc.fillColor(bold ? "#111827" : "#4b5563");
          doc.text(label, 300, y);
          doc.text(rupees(amount), 440, y, { width: 110, align: "right" });
          y += bold ? 16 : 13;
        };
        rowRight("Value of goods (before tax):", goodsValue, true);

        /**
         * The money block, only where money was actually received.
         *
         * `amount_paid > 0` and NOT "was it raised from a sale". The sale link
         * is not the marker it looks like: stampBilled sets sale_id when a
         * challan is billed, so a movement challan acquires one the moment it
         * is used, and the block came back with "Received 0, Balance 2,000" on
         * a document whose whole point is that nothing is owed until the bill.
         *
         * A part paid challan from the old payment-driven rule still carries a
         * real snapshot and still prints it. One with nothing received has
         * nothing to say: "Received 0, Balance the lot" is the invented-debt
         * reading whichever rule raised it.
         */
        if (paid > 0) {
          rowRight("Sale total, tax included:", owed);
          // Anchored to the date of the challan, not to now. Both figures are
          // frozen when it is raised and nothing updates them, which is right
          // for a document that went out with the goods. "Received so far"
          // and "Outstanding" read as live, so a challan printed a year after
          // the money came in said the customer still owed it.
          rowRight("Received by this date:", paid);
          rowRight("Balance on this date:", due, true);
        }

        y += 6;
        doc.fontSize(8).font("Helvetica-Oblique").fillColor("#4b5563");
        doc.text(`Value of goods: ${amountInWords(goodsValue)}`, 36, y, { width: 523 });
        y += 22;

        // The whole point of the document, said plainly.
        doc.rect(36, y, 523, 40).fill("#fef3c7");
        doc.fillColor("#92400e").fontSize(8).font("Helvetica-Bold");
        doc.text("Challan, not a tax invoice.", 44, y + 8);
        doc.font("Helvetica").fontSize(7.5);
        // Rewritten 17 Sept. It used to say the goods went out "while payment
        // is outstanding" and that the invoice follows "once the balance is
        // settled", which was the old payment-driven rule. It is wrong twice
        // over now: the bill no longer waits for money, and on an inward
        // challan nothing was sent out by us at all.
        doc.text(
          inward
            ? "Goods received before the supplier's bill. The purchase is entered when that bill arrives. Do not claim input tax credit against this document."
            : "Goods sent out before the bill. The tax invoice follows. Do not claim input tax credit against this document.",
          44, y + 20, { width: 500 },
        );
        y += 56;

        doc.fontSize(8).font("Helvetica").fillColor("#6b7280");
        doc.text(inward ? "Checked in by" : "Receiver's signature", 36, y + 30);
        doc.text(`For ${supplier.company_name || "Supplier"}`, 360, y + 30, { align: "right", width: 199 });

        doc.end();
      } catch (err) {
        console.error("Challan PDF error:", err);
        if (res && !res.headersSent) res.status(500).send("Error generating the challan");
        else reject(err);
      }
    });
  }

  async generateStatementPDF(statement, supplier = {}, res = null) {
    // Prime the formatter before any amount is drawn.
    await loadFormat();

    const { party, from, to, openingBalance, rows, totals, closingBalance } = statement;

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: "A4", margin: 36, bufferPages: true });
        const buffers = [];

        const safeName = String(party.name || "statement").replace(/[^A-Za-z0-9._-]/g, "_");
        if (res) {
          res.setHeader("Content-Type", "application/pdf");
          res.setHeader("Content-Disposition", `inline; filename=Statement-${safeName}.pdf`);
          doc.pipe(res);
          // Without this the promise never settles when streaming to a
          // response, so the caller hangs. Same as the other two generators.
          doc.on("end", () => resolve());
        } else {
          doc.on("data", (chunk) => buffers.push(chunk));
          doc.on("end", () => resolve(Buffer.concat(buffers)));
        }
        doc.on("error", (err) => reject(err));

        const period =
          !from && !to
            ? "Everything so far"
            : from && to
              ? `${dateOf(from)} to ${dateOf(to)}`
              : from
                ? `From ${dateOf(from)}`
                : `Up to ${dateOf(to)}`;

        const BOTTOM = 720;
        let y = 0;

        const header = () => {
          doc.rect(36, 36, 523, 65).fill("#0f172a");
          doc.fillColor("#ffffff").fontSize(20).font("Helvetica-Bold");
          doc.text("STATEMENT OF ACCOUNT", 50, 48);
          doc.fontSize(9).font("Helvetica").fillColor("#94a3b8");
          doc.text(supplier.company_name || fullName(supplier.first_name, supplier.last_name) || "Supplier", 50, 72);
          doc.fillColor("#ffffff").fontSize(11).font("Helvetica-Bold");
          doc.text(party.business_name || party.name || "Customer", 300, 50, {
            align: "right",
            width: 245,
          });
          doc.fontSize(8).font("Helvetica").fillColor("#cbd5e1");
          doc.text(period, 300, 68, { align: "right", width: 245 });
          if (party.gstin) {
            doc.text(`GSTIN: ${party.gstin}`, 300, 80, { align: "right", width: 245 });
          }
          y = 115;
        };

        const columns = () => {
          doc.rect(36, y, 523, 20).fill("#0f172a");
          doc.fillColor("#ffffff").fontSize(8).font("Helvetica-Bold");
          doc.text("DATE", 44, y + 6, { width: 70 });
          doc.text("PARTICULARS", 120, y + 6, { width: 210 });
          doc.text("BILLED", 335, y + 6, { width: 70, align: "right" });
          doc.text("RECEIVED", 410, y + 6, { width: 70, align: "right" });
          doc.text("BALANCE", 485, y + 6, { width: 66, align: "right" });
          y += 20;
        };

        const carried = (label, amount) => {
          doc.rect(36, y, 523, 18).fill("#f1f5f9");
          doc.fillColor("#334155").fontSize(8).font("Helvetica-Bold");
          doc.text(label, 44, y + 5, { width: 300 });
          doc.text(rupees(amount), 485, y + 5, { width: 66, align: "right" });
          y += 18;
        };

        header();
        columns();
        carried("Balance brought forward", openingBalance);

        let index = 0;
        for (const row of rows) {
          if (y > BOTTOM) {
            doc.addPage();
            header();
            columns();
            // A ledger that continues on a second sheet says where it left
            // off, or the first line on the new page looks like an opening.
            carried("Carried forward from the previous page", rows[index - 1].balance);
          }

          if (index % 2 === 0) doc.rect(36, y, 523, 18).fill("#f8fafc");
          doc.fillColor("#1e293b").fontSize(8).font("Helvetica");
          doc.text(dateOf(row.date), 44, y + 5, { width: 70 });
          doc.text(particularsOf(row), 120, y + 5, { width: 210, height: 10, ellipsis: true });
          doc.text(row.debit > 0 ? rupees(row.debit) : "", 335, y + 5, { width: 70, align: "right" });
          doc.text(row.credit > 0 ? rupees(row.credit) : "", 410, y + 5, { width: 70, align: "right" });
          doc.font("Helvetica-Bold").text(rupees(row.balance), 485, y + 5, { width: 66, align: "right" });
          y += 18;
          index += 1;
        }

        if (y > BOTTOM - 60) {
          doc.addPage();
          header();
        }

        y += 8;
        doc.rect(36, y, 523, 1).fill("#cbd5e1");
        y += 8;
        doc.fillColor("#475569").fontSize(8).font("Helvetica");
        doc.text("Total billed this period", 120, y, { width: 210 });
        doc.text(rupees(totals.billed), 335, y, { width: 70, align: "right" });
        y += 14;
        doc.text("Total received this period", 120, y, { width: 210 });
        doc.text(rupees(totals.received), 410, y, { width: 70, align: "right" });
        y += 20;

        // The closing balance, ruled rather than reversed out of a dark bar.
        doc.rect(36, y, 523, 1).fill("#0f172a");
        doc.fillColor("#0f172a").fontSize(11).font("Helvetica-Bold");
        doc.text(
          Number(closingBalance) < 0 ? "IN CREDIT WITH US" : "BALANCE DUE",
          44,
          y + 7,
        );
        doc.text(rupees(Math.abs(Number(closingBalance))), 380, y + 7, {
          width: 171,
          align: "right",
        });
        doc.rect(36, y + 23, 523, 1).fill("#0f172a");

        const range = doc.bufferedPageRange();
        for (let i = range.start; i < range.start + range.count; i++) {
          doc.switchToPage(i);
          const footerY = 750;
          doc.rect(36, footerY, 523, 1).fill("#e2e8f0");
          doc.fontSize(7).font("Helvetica").fillColor("#64748b");
          doc.text(
            "This is a statement of account, not a tax invoice. Please tell us if anything here does not match your books.",
            36,
            footerY + 8,
            { width: 380 },
          );
          doc.text(`Page ${i + 1} of ${range.count}`, 400, footerY + 8, {
            width: 159,
            align: "right",
          });
        }

        doc.end();
      } catch (err) {
        console.error("Statement PDF generation error:", err);
        if (res) res.status(500).send("Error generating statement");
        else reject(err);
      }
    });
  }

  /**
   * Generates the PDF and caches it on disk.
   *
   * Deliberately NOT under uploads/, which app.js serves statically: invoice
   * numbers are sequential, so a public uploads/invoices/INV-2026-000007.pdf
   * lets anyone walk the whole ledger and read buyer names, GSTINs and
   * amounts. The cache lives in a private directory and is only ever handed
   * out through the authorized /api/invoices routes.
   */
  async generateAndSaveInvoicePDF(invoice) {
    const pdfBuffer = await this.generateInvoicePDF(invoice);

    const cacheDir = path.join(__dirname, "..", "..", "storage", "invoices");
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    // The invoice number reaches the filesystem, so keep it to characters that
    // cannot escape the directory.
    const safeName = String(invoice.invoice_number || invoice.id).replace(
      /[^A-Za-z0-9._-]/g,
      "_",
    );
    const absolutePath = path.join(cacheDir, `${safeName}.pdf`);

    fs.writeFileSync(absolutePath, pdfBuffer);

    // The download URL stays an API route, which checks who is asking.
    const downloadUrl = `/api/invoices/${invoice.id}/pdf`;
    await invoiceRepository.updateInvoice(invoice.id, {
      pdf_path: absolutePath,
      pdf_url: downloadUrl,
    });

    return { pdfBuffer, relativePath: downloadUrl, absolutePath };
  }
}

module.exports = new PDFService();

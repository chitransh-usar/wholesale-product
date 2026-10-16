import { useState, useEffect } from "react";
import { X, Printer, Download, Send } from "lucide-react";
import { toast } from "sonner";
import { downloadFile } from "../../utils/download";
import InvoiceStatusBadge from "./InvoiceStatusBadge";
import { amount as money, dateLabel } from "../../utils/money";

// How the goods travel, as a person reads it. The e-way bill API numbers these
// 1 to 4, which is an encoding detail of that API and means nothing on a page.
const TRANSPORT_MODE_TEXT = {
  road: "Road",
  rail: "Rail",
  air: "Air",
  ship: "Ship",
};

/**
 * The PAN inside a GSTIN, characters 3 to 12 by the number's own definition.
 * Not a second field to store and keep in step, the same number read
 * differently. The PDF does this too and for the same reason.
 */
const panFromGstin = (gstin) => {
  const clean = String(gstin || "").toUpperCase().replace(/[\s-]/g, "");
  return clean.length === 15 ? clean.slice(2, 12) : null;
};

/** "Bhiwandi, Maharashtra (27) - 421302", skipping whatever is blank. */
const placeLine = (city, state, code, pincode) => {
  const where = [city, state && code ? `${state} (${code})` : state]
    .filter(Boolean)
    .join(", ");
  return [where, pincode].filter(Boolean).join(" - ") || null;
};

const Caption = ({ children }) => (
  <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
    {children}
  </span>
);

/** A run of address lines with the blanks dropped. */
const Lines = ({ lines }) => (
  <div className="mt-1 space-y-0.5">
    {lines.filter(Boolean).map((line, i) => (
      <p key={i} className="text-xs text-espresso/70">
        {line}
      </p>
    ))}
  </div>
);

export default function InvoicePreview({ invoice, onClose, onSendEmail }) {
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!invoice) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose?.();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [invoice, onClose]);

  if (!invoice) return null;

  const isPaid = (invoice.payment_status || "").toLowerCase() === "paid";
  const items = invoice.items || [];

  const handlePrint = () => {
    window.print();
  };

  // The frozen columns win over the joins, exactly as they do on the PDF.
  const sellerName =
    invoice.seller_name || invoice.supplier_company || invoice.supplier_name || "Wholesaler";
  const sellerGstin = invoice.seller_gstin || invoice.supplier_gstin;
  const pan = panFromGstin(sellerGstin);

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

  const transportCells = [
    ["Transporter", invoice.transporter_name],
    ["Transporter ID", invoice.transporter_id],
    ["Mode", TRANSPORT_MODE_TEXT[invoice.transport_mode] || invoice.transport_mode],
    ["Vehicle", invoice.vehicle_number],
    ["LR/RR No.", invoice.transport_doc_number],
    ["LR/RR Date", invoice.transport_doc_date ? dateLabel(invoice.transport_doc_date) : null],
    ["GR No.", invoice.gr_number],
    ["GR Date", invoice.gr_date ? dateLabel(invoice.gr_date) : null],
  ];

  const handleDownloadPDF = async () => {
    setDownloading(true);
    try {
      await downloadFile(
        `/api/invoices/${invoice.id}/pdf`,
        `${invoice.invoice_number || "Invoice"}.pdf`,
      );
      toast.success("Invoice downloaded");
    } catch (err) {
      console.error("Download PDF error:", err);
      toast.error(err.message || "Could not download the invoice PDF");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Top Bar */}
        {/* Wraps on a narrow screen. The title, two badges and three buttons
            do not fit across a phone, and the PDF button was being cut off at
            the right edge, which is the one a wholesaler actually reaches for. */}
        <div className="flex flex-wrap items-center justify-between gap-y-2 px-6 py-4 border-b border-slate-100 bg-slate-50">
          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
            <h2 className="text-base font-bold text-espresso sm:text-lg">
              Invoice Preview #{invoice.invoice_number}
            </h2>
            <InvoiceStatusBadge status={invoice.invoice_status} />
            <InvoiceStatusBadge status={invoice.payment_status} />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="p-2 text-slate-600 hover:text-espresso border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors"
              title="Print Invoice"
            >
              <Printer className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={handleDownloadPDF}
              disabled={downloading}
              className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs disabled:opacity-50"
            >
              <Download className="w-4 h-4" /> {downloading ? "Downloading..." : "PDF"}
            </button>

            {onSendEmail && (
              <button
                onClick={() => onSendEmail(invoice.id)}
                className="px-3 py-2 bg-clay hover:bg-espresso text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs"
              >
                <Send className="w-4 h-4" /> Email
              </button>
            )}

            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-espresso"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Modal Body */}
        <div className="p-8 overflow-y-auto flex-1 relative bg-white print:p-0 print:overflow-visible">
          {/* Watermark Overlay */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none overflow-hidden opacity-10">
            <span
              className={`text-8xl font-extrabold uppercase -rotate-45 tracking-widest ${
                isPaid ? "text-emerald-600" : "text-amber-500"
              }`}
            >
              {isPaid ? "PAID" : "UNPAID"}
            </span>
          </div>

          {/*
            The invoice head, laid out the way the PDF lays it out.

            These two are the same document seen twice, and they had drifted:
            this one still showed the number floating on the right and knew
            nothing about the seller's address, the shipped-to, or the
            transport. A preview that does not match the paper is worse than no
            preview, because somebody checks it and then posts something else.

            The frozen columns win over the joins throughout, for the same
            reason they do on the PDF: a reprint has to show what the bill went
            out with.
          */}
          <div className="border-2 border-slate-900 mb-6">
            <div className="flex items-center justify-between bg-slate-900 px-4 py-3">
              <h1 className="text-lg font-black uppercase tracking-tight text-white">
                Tax Invoice
              </h1>
              <span className="text-[10px] uppercase tracking-wider text-slate-300">
                Original for recipient
              </span>
            </div>

            <div className="grid grid-cols-1 border-b border-slate-300 sm:grid-cols-2">
              <div className="border-b border-slate-300 p-4 sm:border-b-0 sm:border-r">
                <Caption>Supplier (issuer)</Caption>
                <p className="text-sm font-bold text-espresso">{sellerName}</p>
                <Lines
                  lines={[
                    invoice.seller_address,
                    placeLine(
                      invoice.seller_city || invoice.supplier_city,
                      invoice.seller_state || invoice.supplier_state,
                      invoice.seller_state_code,
                      invoice.seller_pincode,
                    ),
                    sellerGstin ? `GSTIN  ${sellerGstin}` : null,
                    pan ? `PAN  ${pan}` : null,
                    (invoice.seller_phone || invoice.supplier_phone)
                      ? `Phone  ${invoice.seller_phone || invoice.supplier_phone}` : null,
                    invoice.supplier_upi_id ? `UPI  ${invoice.supplier_upi_id}` : null,
                  ]}
                />
              </div>

              {/* The particulars, as label and value pairs. Somebody chasing a
                  payment reads down this column, so only what is known shows:
                  a row reading "Due Date -" is noise. */}
              <dl className="space-y-1.5 p-4">
                {[
                  ["Invoice No.", invoice.invoice_number],
                  ["Invoice Date", invoice.issue_date ? dateLabel(invoice.issue_date) : null],
                  ["Due Date", invoice.due_date ? dateLabel(invoice.due_date) : null],
                  ["Place of Supply", invoice.place_of_supply
                    ? `${invoice.place_of_supply}${invoice.place_of_supply_code ? ` (${invoice.place_of_supply_code})` : ""}`
                    : null],
                  ["Reverse Charge", invoice.reverse_charge ? "Yes" : "No"],
                  ["Reference", invoice.sale_number || invoice.order_number || null],
                ]
                  .filter(([, v]) => v)
                  .map(([label, value]) => (
                    <div key={label} className="flex gap-3 text-xs">
                      <dt className="w-28 shrink-0 text-slate-500">{label}</dt>
                      <dd className="font-bold text-espresso">{value}</dd>
                    </div>
                  ))}
              </dl>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2">
              <div className="border-b border-slate-300 p-4 sm:border-b-0 sm:border-r">
                <Caption>Billed to</Caption>
                <p className="text-sm font-bold text-espresso">
                  {invoice.recipient_name || invoice.buyer_company || invoice.buyer_name}
                </p>
                <Lines
                  lines={[
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
                  ]}
                />
              </div>

              <div className="p-4">
                <Caption>Shipped to</Caption>
                {shipLines.length > 0 ? (
                  <>
                    <p className="text-sm font-bold text-espresso">{shipLines[0]}</p>
                    <Lines lines={shipLines.slice(1)} />
                  </>
                ) : (
                  // Repeating the billing address would only add noise. The
                  // paper says the same thing.
                  <p className="text-xs italic text-slate-400">
                    Same as the billing address
                  </p>
                )}

                {dispatchLines.length > 0 && (
                  <div className="mt-3">
                    <Caption>Dispatched from</Caption>
                    <Lines lines={dispatchLines} />
                  </div>
                )}
              </div>
            </div>

            {/*
              Transport, as a table with its own column headings.

              These are the e-way bill fields, read across by somebody
              comparing them against the lorry in front of them, which is what
              ruled columns are for. Shown only when something was recorded:
              most counter sales have no transport, and an empty row of
              headings reads like a gap.
            */}
            {transportCells.some(([, v]) => v) && (
              <div className="overflow-x-auto border-t border-slate-300">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="bg-slate-100">
                      {transportCells.map(([label]) => (
                        <th
                          key={label}
                          className="whitespace-nowrap border-r border-slate-300 px-2 py-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-500 last:border-r-0"
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {transportCells.map(([label, value]) => (
                        <td
                          key={label}
                          className="whitespace-nowrap border-t border-r border-slate-300 px-2 py-1.5 text-[11px] text-espresso last:border-r-0"
                        >
                          {value || "-"}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Line Items Table */}
          <table className="w-full text-left text-xs mb-6 border-collapse">
            <thead>
              <tr className="bg-slate-900 text-white font-bold uppercase tracking-wider">
                <th className="py-2.5 px-3">Item Description</th>
                <th className="py-2.5 px-3 text-center">HSN</th>
                <th className="py-2.5 px-3 text-center">Qty</th>
                <th className="py-2.5 px-3 text-right">Unit Price</th>
                <th className="py-2.5 px-3 text-center">GST %</th>
                <th className="py-2.5 px-3 text-right">Tax</th>
                <th className="py-2.5 px-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-espresso/70">
              {items.map((item, idx) => (
                <tr
                  key={idx}
                  className={idx % 2 === 0 ? "bg-slate-50/50/30" : ""}
                >
                  <td className="py-2.5 px-3 font-semibold text-espresso">
                    {item.product_name}
                  </td>
                  <td className="py-2.5 px-3 text-center font-mono text-slate-500">
                    {item.hsn_code || "-"}
                  </td>
                  <td className="py-2.5 px-3 text-center font-bold">
                    {/* The unit as GST accepts it, beside the figure, the
                        same as the PDF. Absent when the unit has no UQC
                        decided yet, rather than showing a stand in code. */}
                    {item.uqc ? `${Number(item.quantity)} ${item.uqc}` : Number(item.quantity)}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    ₹{money(item.unit_price)}
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    {item.gst_percent}%
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    ₹{money(item.tax_amount)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-bold">
                    ₹{money(item.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals Breakdown */}
          <div className="flex justify-between items-start pt-4 border-t border-slate-200 text-xs">
            <div className="max-w-xs text-slate-500 space-y-2">
              <div className="font-bold text-espresso/70 uppercase tracking-wider text-[10px]">
                Terms & Conditions
              </div>
              <p className="text-[11px] whitespace-pre-line">
                {invoice.terms_conditions || "Standard B2B terms apply."}
              </p>
            </div>

            <div className="w-64 space-y-1.5 text-right font-medium">
              <div className="flex justify-between">
                <span className="text-slate-500">Subtotal:</span>
                <span>₹{money(invoice.subtotal || 0)}</span>
              </div>
              {Number(invoice.discount) > 0 && (
                <div className="flex justify-between text-emerald-600">
                  <span>Discount:</span>
                  <span>-₹{money(invoice.discount)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-espresso pt-1 border-t border-slate-100">
                <span>Taxable Amount:</span>
                <span>₹{money(invoice.taxable_amount || 0)}</span>
              </div>
              {Number(invoice.cgst) > 0 && (
                <div className="flex justify-between text-slate-500">
                  <span>CGST:</span>
                  <span>₹{money(invoice.cgst)}</span>
                </div>
              )}
              {Number(invoice.sgst) > 0 && (
                <div className="flex justify-between text-slate-500">
                  <span>SGST:</span>
                  <span>₹{money(invoice.sgst)}</span>
                </div>
              )}
              {Number(invoice.igst) > 0 && (
                <div className="flex justify-between text-slate-500">
                  <span>IGST:</span>
                  <span>₹{money(invoice.igst)}</span>
                </div>
              )}
              <div className="flex justify-between text-slate-500">
                <span>Total Tax:</span>
                <span>₹{money(invoice.total_tax || 0)}</span>
              </div>
              {/* Its own line, because it is its own levy. Cess does not come
                  out of the GST above it and is not part of that figure. */}
              {Number(invoice.total_cess) > 0 && (
                <div className="flex justify-between text-slate-500">
                  <span>Cess:</span>
                  <span>₹{money(invoice.total_cess)}</span>
                </div>
              )}
              {/* Ruled, not filled. A rounded dark pill is a web button
                  shape, and a bill is a document: the total is set apart the
                  way a printed invoice does it, with a rule above and below
                  and the figure carrying the weight. */}
              <div className="mt-2.5 flex items-baseline justify-between border-y-2 border-espresso py-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-espresso">
                  Grand total
                </span>
                <span className="text-lg font-black tabular-nums text-espresso">
                  ₹{money(invoice.grand_total || 0)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

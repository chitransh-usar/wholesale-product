import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Bell,
  Download,
  Eye,
  FileText,
  RotateCcw,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import axios from "../../utils/axios";
import { downloadFile } from "../../utils/download";
import InvoiceStatusBadge from "../../components/invoice/InvoiceStatusBadge";
import PaymentHistory from "../../components/invoice/PaymentHistory";
import InvoiceTimeline from "../../components/invoice/InvoiceTimeline";
import InvoicePreview from "../../components/invoice/InvoicePreview";
import CreditNoteModal from "../../components/CreditNoteModal";
import { rupees, dateLabel } from "../../utils/money";

/**
 * Every figure on this page went through Number(x).toFixed(2) with a hard
 * coded symbol, so a bill read "Rs.1500.00" while the same amount read
 * "Rs.1,500" on the customer page and the dashboard. Asked about on 14 Sept,
 * after the eighteen other copies had already been collapsed and this one
 * was missed.
 *
 * Document precision, because these have to foot: the lines must add up to
 * the total printed underneath them.
 */
const inr = (value) => rupees(value, { document: true });

// Plain English, not the stored code. A wholesaler reading their own bill
// should not have to decode "rate_revised".
const CREDIT_REASONS = {
  sale_cancelled: "The sale was cancelled.",
  goods_returned: "The goods came back.",
  rate_revised: "The rate was corrected.",
  other: "This bill has been reversed.",
};

export default function InvoiceDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [showCredit, setShowCredit] = useState(false);

  const fetchInvoiceDetails = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const res = await axios.get(`/api/invoices/${id}`);
      if (res.data.success) {
        setInvoice(res.data.invoice);
      }
    } catch (err) {
      console.error("Error loading invoice details:", err);
      setError(
        err.response?.data?.message || "Invoice not found or access denied.",
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      await fetchInvoiceDetails();
    })();
  }, [id, fetchInvoiceDetails]);

  const handleRecordPayment = async (paymentPayload) => {
    try {
      const res = await axios.post(
        `/api/invoices/${id}/payment`,
        paymentPayload,
      );
      if (res.data.success) {
        toast.success("Payment recorded");
        fetchInvoiceDetails();
      }
    } catch (err) {
      console.error("Payment error:", err);
      toast.error(err.response?.data?.message || "Failed to record payment");
    }
  };

  const handleDownloadPDF = async () => {
    try {
      await downloadFile(
        `/api/invoices/${id}/pdf`,
        `${invoice?.invoice_number || "Invoice"}.pdf`,
      );
    } catch (err) {
      console.error("Download PDF error:", err);
      toast.error("Could not download the invoice PDF");
    }
  };

  const handleDownloadCreditNote = async () => {
    try {
      await downloadFile(
        `/api/credit-notes/${invoice.credit_note_id}/pdf`,
        `${invoice.credit_note_number || "credit-note"}.pdf`,
      );
    } catch (err) {
      console.error("Download credit note error:", err);
      toast.error("Could not download the credit note");
    }
  };

  const handleSendEmail = async () => {
    try {
      const res = await axios.post(`/api/invoices/${id}/send`);
      if (res.data.success) {
        toast.success(
          res.data.message ||
            `Invoice sent to ${invoice?.buyer_email || "the buyer"}`,
        );
        fetchInvoiceDetails();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to send email");
    }
  };

  const handleSendReminder = async () => {
    try {
      const res = await axios.post(`/api/invoices/${id}/reminder`);
      if (res.data.success) {
        toast.success(res.data.message || "Payment reminder sent");
        fetchInvoiceDetails();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to send reminder");
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent" />
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
        <FileText className="w-12 h-12 text-slate-300 mb-3" />
        <h2 className="text-lg font-bold text-espresso">
          {error || "Invoice not found"}
        </h2>
        <button
          onClick={() => navigate("/seller/invoices")}
          className="mt-4 px-4 py-2 bg-clay text-white rounded-xl text-xs font-bold"
        >
          Back to invoices
        </button>
      </div>
    );
  }

  const items = invoice.items || [];
  const payments = invoice.payments || [];
  const logs = invoice.logs || [];
  const isPaid = (invoice.payment_status || "").toLowerCase() === "paid";
  // Reversed by a credit note. The invoice's own two badges cannot say this:
  // it is still Generated, and still Paid if the money had come in.
  const isCredited = Boolean(invoice.credit_note_number);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Top Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/seller/invoices")}
            className="p-2 text-slate-500 hover:text-espresso border border-slate-200 rounded-xl hover:bg-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-black text-espresso font-mono">
                {invoice.invoice_number}
              </h1>
              <InvoiceStatusBadge status={invoice.invoice_status} />
              <InvoiceStatusBadge status={invoice.payment_status} />
            </div>
            <p className="text-xs text-espresso/50 mt-0.5">
              Issued: {invoice.issue_date ? dateLabel(invoice.issue_date) : "N/A"}{" "}
              | Due: {invoice.due_date ? dateLabel(invoice.due_date) : "N/A"}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowPreview(true)}
            className="px-3 py-2 bg-white border border-slate-200 hover:bg-slate-100 text-espresso/70 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <Eye className="w-4 h-4 text-clay" /> Preview
          </button>

          <button
            onClick={handleDownloadPDF}
            className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-espresso/70 transition-colors hover:bg-slate-100"
          >
            <Download className="w-4 h-4" /> Download PDF
          </button>

          <button
            onClick={handleSendEmail}
            className="px-3 py-2 bg-clay hover:bg-espresso text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs"
          >
            <Send className="w-4 h-4" /> Send Email
          </button>

          {/* No chasing money for a bill that has been reversed. */}
          {!isPaid && !isCredited && (
            <button
              onClick={handleSendReminder}
              className="px-3 py-2 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <Bell className="w-4 h-4" /> Send Reminder
            </button>
          )}

          {/* The honest way to correct a bill that has gone out. A voided
              invoice is only right for one raised in error that never left
              the office, which is what the Cancelled status is still for. */}
          {!isCredited && invoice.invoice_status !== "Cancelled" && (
            <button
              onClick={() => setShowCredit(true)}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-espresso/70 transition-colors hover:bg-slate-100"
            >
              <RotateCcw className="w-4 h-4" /> Reverse this bill
            </button>
          )}
        </div>
      </div>

      {/* Says plainly that this bill no longer stands. Sits above everything
          else because every number below it has been reversed. */}
      {isCredited && (
        <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4">
          <RotateCcw className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-sky-900">
              Reversed by credit note {invoice.credit_note_number}
            </p>
            <p className="mt-1 text-xs text-sky-800">
              {CREDIT_REASONS[invoice.credit_reason] ||
                "This bill has been reversed."}{" "}
              {inr(invoice.credited_amount || 0)} was credited back on{" "}
              {invoice.credited_on
                ? dateLabel(invoice.credited_on)
                : "the same day"}
              . The bill itself stays exactly as it was issued, because a bill
              that has gone out cannot be rewritten.
            </p>
            {invoice.credit_reason_note && (
              <p className="mt-1 text-xs italic text-sky-800/80">
                {invoice.credit_reason_note}
              </p>
            )}
            <button
              onClick={handleDownloadCreditNote}
              className="mt-3 flex items-center gap-1.5 rounded-lg border border-sky-300 bg-white px-3 py-2 text-xs font-bold text-sky-800 transition-colors hover:bg-sky-100"
            >
              <Download className="h-4 w-4" />
              Download credit note
            </button>
          </div>
        </div>
      )}

      {/* Main Details Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Invoice Sheet */}
        <div className="lg:col-span-2 space-y-6">
          {/* Parties Card */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Supplier / Issuer
              </span>
              <div className="font-bold text-espresso text-sm">
                {invoice.supplier_company || invoice.supplier_name}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                GSTIN: {invoice.supplier_gstin || "N/A"}
              </p>
              <p className="text-xs text-slate-500">
                Phone: {invoice.supplier_phone || "N/A"}
              </p>
              <p className="text-xs text-slate-500">
                Email: {invoice.supplier_email || "N/A"}
              </p>
              {invoice.supplier_upi_id && (
                <p className="text-xs font-bold text-clay mt-1">
                  UPI ID: {invoice.supplier_upi_id}
                </p>
              )}
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Billed Buyer
              </span>
              <div className="font-bold text-espresso text-sm">
                {invoice.buyer_company || invoice.buyer_name}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                GSTIN: {invoice.buyer_gstin || "N/A"}
              </p>
              <p className="text-xs text-slate-500">
                Phone: {invoice.buyer_phone || "N/A"}
              </p>
              <p className="text-xs text-slate-500">
                Email: {invoice.buyer_email || "N/A"}
              </p>
              {invoice.order_number && (
                <p className="text-xs text-slate-400 mt-1 font-mono">
                  Linked Order: #{invoice.order_number}
                </p>
              )}
            </div>
          </div>

          {/* Line Items Table */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs overflow-hidden">
            <h3 className="text-sm font-bold text-espresso mb-4">
              Itemized Product List
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-espresso/50 font-semibold uppercase tracking-wider">
                    <th className="py-3 px-3">Product Name</th>
                    <th className="py-3 px-3 text-center">HSN</th>
                    <th className="py-3 px-3 text-center">Qty</th>
                    <th className="py-3 px-3 text-right">Unit Price</th>
                    <th className="py-3 px-3 text-center">GST %</th>
                    <th className="py-3 px-3 text-right">Tax Amount</th>
                    <th className="py-3 px-3 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-espresso/70">
                  {items.map((item, idx) => (
                    <tr key={idx}>
                      <td className="py-3 px-3 font-semibold text-espresso">
                        {item.product_name}
                      </td>
                      <td className="py-3 px-3 text-center text-slate-400 font-mono">
                        {item.hsn_code || "-"}
                      </td>
                      {/* Through Number: the column is NUMERIC(12,3), so it
                          arrives as "2.500" and reads as a typo. */}
                      <td className="py-3 px-3 text-center font-bold">
                        {Number(item.quantity)}
                      </td>
                      <td className="py-3 px-3 text-right">
                        {inr(item.unit_price)}
                      </td>
                      <td className="py-3 px-3 text-center">
                        {item.gst_percent}%
                      </td>
                      <td className="py-3 px-3 text-right">
                        {inr(item.tax_amount)}
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-espresso">
                        {inr(item.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals Section */}
            <div className="flex flex-col sm:flex-row justify-between items-start pt-6 mt-4 border-t border-slate-100 gap-4 text-xs">
              <div className="text-slate-500 max-w-sm">
                <span className="font-bold text-espresso/70 block mb-1">
                  Notes:
                </span>
                <p className="text-[11px]">
                  {invoice.notes || "No custom notes."}
                </p>
              </div>

              <div className="w-full sm:w-64 space-y-2 text-right">
                <div className="flex justify-between text-espresso/60">
                  <span>Subtotal:</span>
                  <span>{inr(invoice.subtotal || 0)}</span>
                </div>
                {Number(invoice.discount) > 0 && (
                  <div className="flex justify-between text-emerald-600">
                    <span>Discount:</span>
                    <span>-{inr(invoice.discount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-espresso pt-1 border-t border-slate-100">
                  <span>Taxable Amount:</span>
                  <span>{inr(invoice.taxable_amount || 0)}</span>
                </div>
                {Number(invoice.cgst) > 0 && (
                  <div className="flex justify-between text-slate-500">
                    <span>CGST:</span>
                    <span>{inr(invoice.cgst)}</span>
                  </div>
                )}
                {Number(invoice.sgst) > 0 && (
                  <div className="flex justify-between text-slate-500">
                    <span>SGST:</span>
                    <span>{inr(invoice.sgst)}</span>
                  </div>
                )}
                {Number(invoice.igst) > 0 && (
                  <div className="flex justify-between text-slate-500">
                    <span>IGST:</span>
                    <span>{inr(invoice.igst)}</span>
                  </div>
                )}
                <div className="flex justify-between text-slate-500">
                  <span>Total Tax:</span>
                  <span>{inr(invoice.total_tax || 0)}</span>
                </div>
                {/*
                  Why the tax split is what it is, in words.

                  Same state as the customer is CGST plus SGST, a different
                  state is IGST, and it is a number on a legal document. A
                  wholesaler who reads "IGST, because they are in Gujarat" can
                  catch a customer record with the wrong state on it before the
                  bill goes out, which is the cheapest moment there is to catch
                  it. Afterwards it means a credit note.

                  Only shown when the invoice actually records the states it
                  compared. Guessing at the reason would be worse than silence.
                */}
                {(invoice.place_of_supply || invoice.recipient_state) &&
                  (invoice.supplier_state || invoice.seller_state) && (
                    <p className="pt-1 text-[11px] leading-snug text-slate-400">
                      {Number(invoice.igst) > 0 ? (
                        <>
                          IGST, because you are in{" "}
                          {invoice.seller_state || invoice.supplier_state} and they are in{" "}
                          {invoice.place_of_supply || invoice.recipient_state}.
                        </>
                      ) : (
                        <>
                          CGST and SGST, because you and they are both in{" "}
                          {invoice.seller_state || invoice.supplier_state}.
                        </>
                      )}
                    </p>
                  )}
                {/* Same treatment as the preview and the PDF: a rule, not a
                    dark rounded pill. The three should look like one bill. */}
                <div className="mt-2.5 flex items-baseline justify-between border-y-2 border-espresso py-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-espresso">
                    Grand total
                  </span>
                  <span className="text-lg font-black tabular-nums text-espresso">
                    {inr(invoice.grand_total || 0)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Payment History Sub-Component */}
          <PaymentHistory
            invoice={invoice}
            payments={payments}
            onRecordPayment={handleRecordPayment}
          />
        </div>

        {/* Right Column: Activity Timeline */}
        <div>
          <InvoiceTimeline logs={logs} />
        </div>
      </div>

      {/* Modal Preview Component */}
      {showPreview && (
        <InvoicePreview
          invoice={invoice}
          onClose={() => setShowPreview(false)}
          onSendEmail={handleSendEmail}
        />
      )}

      {showCredit && (
        <CreditNoteModal
          invoice={invoice}
          onClose={() => setShowCredit(false)}
          onSaved={() => {
            setShowCredit(false);
            fetchInvoiceDetails();
          }}
        />
      )}
    </div>
  );
}

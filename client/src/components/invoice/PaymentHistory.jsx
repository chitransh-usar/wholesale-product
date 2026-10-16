import { useState } from "react";
import { CreditCard, Plus } from "lucide-react";
import { toast } from "sonner";
import { amount as money, dateLabel } from "../../utils/money";
import ModalShell from "../ModalShell";

export default function PaymentHistory({
  payments = [],
  invoice,
  onRecordPayment,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("UPI");
  const [transactionId, setTransactionId] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [remarks, setRemarks] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const grandTotal = Number(invoice?.grand_total || 0);
  const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const balanceDue = Math.max(0, grandTotal - totalPaid);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      toast.error("Enter a payment amount greater than zero");
      return;
    }

    try {
      setIsSubmitting(true);
      await onRecordPayment({
        amount: numAmount,
        paymentMethod,
        transactionId,
        paymentReference,
        remarks,
      });
      setIsOpen(false);
      setAmount("");
      setTransactionId("");
      setPaymentReference("");
      setRemarks("");
    } catch (err) {
      console.error("Error recording payment:", err);
      toast.error(err.message || "Failed to record payment");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-bold text-espresso flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-clay" />
            Payment History
          </h3>
          <p className="text-xs text-espresso/50 mt-0.5">
            Total Paid:{" "}
            <span className="font-bold text-emerald-600">
              ₹{money(totalPaid)}
            </span>{" "}
            | Balance Due:{" "}
            <span className="font-bold text-rose-600">
              ₹{money(balanceDue)}
            </span>
          </p>
        </div>

        {balanceDue > 0 && (
          <button
            onClick={() => {
              setAmount(String(balanceDue));
              setIsOpen(true);
            }}
            className="px-3.5 py-2 bg-clay hover:bg-espresso text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs"
          >
            <Plus className="w-4 h-4" /> Record Payment
          </button>
        )}
      </div>

      {/* Payments List Table */}
      {payments.length === 0 ? (
        <div className="py-8 text-center text-espresso/40 border border-dashed border-slate-200 rounded-xl">
          <CreditCard className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-xs font-medium">No payments recorded yet</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-espresso/50 uppercase tracking-wider font-semibold">
                <th className="py-2.5 px-3">Date</th>
                <th className="py-2.5 px-3">Method</th>
                <th className="py-2.5 px-3">Transaction ID / Ref</th>
                <th className="py-2.5 px-3 text-right">Amount</th>
                <th className="py-2.5 px-3">Remarks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-espresso/70">
              {payments.map((payment) => (
                <tr key={payment.id}>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    {payment.paid_at ? dateLabel(payment.paid_at) : "N/A"}
                  </td>
                  <td className="py-2.5 px-3 font-semibold text-espresso">
                    {payment.payment_method}
                  </td>
                  <td className="py-2.5 px-3 text-espresso/50 font-mono">
                    {payment.transaction_id || payment.payment_reference || "-"}
                  </td>
                  <td className="py-2.5 px-3 text-right font-bold text-emerald-600">
                    +₹
                    {money(payment.amount)}
                  </td>
                  <td className="py-2.5 px-3 text-espresso/50">
                    {payment.remarks || "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Record Payment Modal */}
      {isOpen && (
        <ModalShell
          onClose={() => setIsOpen(false)}
          maxWidth="max-w-md"
          title={
            <div className="flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-clay" />
              <span className="text-base font-bold text-espresso">Record Invoice Payment</span>
            </div>
          }
        >
          <div className="p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-espresso/70 mb-1">
                  Payment Amount (₹) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  max={balanceDue}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-espresso focus:ring-2 focus:ring-clay/20 focus:outline-none"
                  required
                />
                <div className="text-[11px] text-slate-400 mt-1">
                  Balance Remaining: ₹{money(balanceDue)}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-espresso/70 mb-1">
                  Payment Method *
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-espresso focus:ring-2 focus:ring-clay/20 focus:outline-none"
                >
                  <option value="UPI">UPI / QR Code</option>
                  <option value="Cash">Cash</option>
                  <option value="Bank Transfer">
                    Bank Transfer (NEFT/RTGS/IMPS)
                  </option>
                  <option value="Card">Credit / Debit Card</option>
                  <option value="Cheque">Cheque</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-espresso/70 mb-1">
                  Transaction ID / UTR
                </label>
                <input
                  type="text"
                  placeholder="e.g. UTR92837491823"
                  value={transactionId}
                  onChange={(e) => setTransactionId(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-espresso focus:ring-2 focus:ring-clay/20 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-espresso/70 mb-1">
                  Remarks / Notes
                </label>
                <textarea
                  rows={2}
                  placeholder="Payment notes..."
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-espresso focus:ring-2 focus:ring-clay/20 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-espresso/60 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-clay hover:bg-espresso text-white text-xs font-semibold rounded-xl transition-colors shadow-xs disabled:opacity-50"
                >
                  {isSubmitting ? "Recording..." : "Save Payment"}
                </button>
              </div>
            </form>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

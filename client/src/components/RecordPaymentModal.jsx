import { useState } from "react";
import api from "../utils/axios";
import ModalShell from "./ModalShell";
import PaidInFull from "./PaidInFull";
import { toast } from "sonner";

/**
 * Money coming in from a customer. Naming a specific bill is optional on
 * purpose: a trader usually hands over a round sum against whatever is
 * outstanding, without saying which bill it settles.
 *
 * `forSale` opens it against ONE sale, which is how the sale screen reaches
 * it. Taking money used to mean leaving the sale, opening Customers, finding
 * the customer and picking the sale back out of a list, which is four steps
 * to answer a question the screen already knew the answer to. With forSale
 * set the picker is gone and the payment is attached to that sale.
 */
const RecordPaymentModal = ({
  partyId, partyName, outstanding, sales = [], forSale = null, onClose, onSaved,
}) => {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [paidOn, setPaidOn] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [saleId, setSaleId] = useState(forSale?.id || "");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // Only unsettled sales are worth offering to attach a payment to.
  const openSales = sales.filter((sale) => sale.status !== "cancelled");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!(Number(amount) > 0)) {
      toast.error("Enter an amount.");
      return;
    }

    setSaving(true);
    try {
      await api.post(`/api/parties/${partyId}/payments`, {
        amount,
        method,
        paidOn,
        note,
        saleId: saleId || undefined,
      });
      toast.success("Payment recorded.");
      onSaved();
    } catch (error) {
      toast.error(
        error.response?.data?.message || "Could not record this payment.",
      );
      setSaving(false);
    }
  };

  return (
    <ModalShell
      onClose={onClose}
      maxWidth="sm:max-w-md"
      labelledBy="record-payment-title"
      closeOnOverlayClick={false}
      title={
        <>
          <h3 className="text-lg font-black text-espresso">Record payment</h3>
          <p className="truncate text-xs font-semibold text-slate-500">
            From {partyName}
          </p>
        </>
      }
      footer={
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="record-payment-form"
            disabled={saving}
            className="flex-1 rounded-lg bg-clay py-2.5 text-sm font-bold text-cream transition-colors hover:bg-espresso disabled:opacity-60"
          >
            {saving ? "Saving..." : "Record payment"}
          </button>
        </div>
      }
    >
      <form id="record-payment-form" onSubmit={handleSubmit}>
        <div className="space-y-4 px-6 py-5">
          {Number(outstanding) > 0 && (
            <div className="rounded-xl bg-amber-50 px-4 py-3">
              <p className="text-xs font-semibold text-amber-800">
                They currently owe ₹
                {Number(outstanding).toLocaleString("en-IN")}
              </p>
            </div>
          )}

          <div>
            <label
              htmlFor="pay-amount"
              className="mb-1.5 block text-sm font-bold text-espresso"
            >
              Amount received <span className="text-clay">*</span>
            </label>
            <input
              id="pay-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              autoFocus
              placeholder="0"
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-lg font-bold outline-none transition-colors focus:border-clay"
            />
            {/* Settling the lot is the common case, so it is one tick rather
                than reading the figure off the panel above and typing it back
                in. */}
            <div className="mt-2">
              <PaidInFull
                id="pay-in-full"
                total={outstanding}
                value={amount}
                onChange={setAmount}
                label="Clearing everything they owe"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="pay-method"
                className="mb-1.5 block text-sm font-bold text-espresso"
              >
                How
              </label>
              <select
                id="pay-method"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition-colors focus:border-clay"
              >
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="bank">Bank transfer</option>
                <option value="cheque">Cheque</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="pay-date"
                className="mb-1.5 block text-sm font-bold text-espresso"
              >
                When
              </label>
              <input
                id="pay-date"
                type="date"
                value={paidOn}
                onChange={(e) => setPaidOn(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none transition-colors focus:border-clay"
              />
            </div>
          </div>

          {/* Opened from one sale, so there is nothing to choose. Said out
              loud rather than hidden, because the money is being attached to
              a particular bill and that is worth seeing. */}
          {forSale && (
            <div className="rounded-xl bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold text-slate-500">Against</p>
              <p className="text-sm font-bold text-espresso">
                {forSale.sale_number}
              </p>
            </div>
          )}

          {!forSale && openSales.length > 0 && (
            <div>
              <label
                htmlFor="pay-sale"
                className="mb-1.5 block text-sm font-bold text-espresso"
              >
                Against a bill
              </label>
              <select
                id="pay-sale"
                value={saleId}
                onChange={(e) => setSaleId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition-colors focus:border-clay"
              >
                <option value="">Not for any one bill</option>
                {openSales.map((sale) => (
                  <option key={sale.id} value={sale.id}>
                    {sale.sale_number} · ₹
                    {Number(sale.total).toLocaleString("en-IN")}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">
                Leave this alone if the money is just against what they owe.
              </p>
            </div>
          )}

          <div>
            <label
              htmlFor="pay-note"
              className="mb-1.5 block text-sm font-bold text-espresso"
            >
              Note
            </label>
            <input
              id="pay-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Cheque number, who gave it, anything"
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none transition-colors focus:border-clay"
            />
          </div>

        </div>
      </form>
    </ModalShell>
  );
};

export default RecordPaymentModal;

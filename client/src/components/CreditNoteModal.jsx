import { useState } from "react";
import api from "../utils/axios";
import ModalShell from "./ModalShell";
import { toast } from "sonner";

/**
 * Reverses a bill that has already been issued.
 *
 * "Sale cancelled" is not offered here. That reason is stamped automatically
 * when a sale is cancelled, and picking it by hand would leave a note saying
 * a sale was cancelled when it was not.
 *
 * Every note reverses the whole bill, which the wording says plainly rather
 * than leaving them to find out after pressing the button. Part returns need a
 * quantity per line and are not built.
 */
const REASONS = [
  {
    value: "goods_returned",
    label: "The goods came back",
    help: "They returned everything on this bill.",
  },
  {
    value: "rate_revised",
    label: "The rate was wrong",
    help: "Reverse this bill, then record the sale again at the right rate.",
  },
  {
    value: "other",
    label: "Something else",
    help: "Write what happened in the note below so the bill makes sense later.",
  },
];

const CreditNoteModal = ({ invoice, onClose, onSaved }) => {
  const [reason, setReason] = useState("goods_returned");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const chosen = REASONS.find((r) => r.value === reason);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await api.post("/api/credit-notes", {
        invoiceId: invoice.id,
        reason,
        reasonNote: note.trim() || undefined,
      });
      toast.success(`Credit note ${data.note_number} raised.`);
      onSaved(data);
    } catch (error) {
      toast.error(
        error.response?.data?.message || "Could not raise the credit note.",
      );
      setSaving(false);
    }
  };

  return (
    <ModalShell
      onClose={onClose}
      maxWidth="sm:max-w-md"
      labelledBy="credit-note-title"
      closeOnOverlayClick={false}
      title={
        <>
          <h3 className="text-lg font-black text-espresso">
            Reverse this bill
          </h3>
          <p className="truncate text-xs font-semibold text-slate-500">
            {invoice.invoice_number} · {invoice.buyer_name}
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
            form="credit-note-form"
            disabled={saving || (reason === "other" && !note.trim())}
            className="flex-1 rounded-lg bg-clay py-2.5 text-sm font-bold text-cream transition-colors hover:bg-espresso disabled:opacity-60"
          >
            {saving ? "Raising..." : "Raise credit note"}
          </button>
        </div>
      }
    >
      <form id="credit-note-form" onSubmit={handleSubmit}>
        <div className="space-y-4 px-6 py-5">
            <div className="rounded-xl bg-sky-50 px-4 py-3">
              <p className="text-xs font-semibold text-sky-900">
                A credit note of ₹
                {Number(invoice.grand_total || 0).toLocaleString("en-IN", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{" "}
                will be raised, reversing the whole bill.
              </p>
              <p className="mt-1 text-xs text-sky-800">
                The bill itself stays as it was issued. Give the credit note to
                the customer along with it. Only one can be raised per bill, and
                it cannot be undone.
              </p>
            </div>

            <fieldset>
              <legend className="mb-2 text-sm font-bold text-espresso">
                What happened?
              </legend>
              <div className="space-y-2">
                {REASONS.map((option) => (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                      reason === option.value
                        ? "border-clay bg-clay/5"
                        : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="credit-reason"
                      value={option.value}
                      checked={reason === option.value}
                      onChange={(e) => setReason(e.target.value)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-clay"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-espresso">
                        {option.label}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {option.help}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <label
                htmlFor="credit-note-text"
                className="mb-1.5 block text-sm font-bold text-espresso"
              >
                Note {chosen?.value === "other" && <span className="text-clay">*</span>}
              </label>
              <input
                id="credit-note-text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Printed on the credit note"
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none transition-colors focus:border-clay"
              />
            </div>
        </div>
      </form>
    </ModalShell>
  );
};

export default CreditNoteModal;

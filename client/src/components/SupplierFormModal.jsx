import { useState } from "react";
import api from "../utils/axios";
import { toast } from "sonner";
import ModalShell from "./ModalShell";

/**
 * Adds a supplier or edits one, from anywhere.
 *
 * The supplier form used to be an inline panel that only the Suppliers page
 * could open, which is why recording a purchase from a mill not yet in the
 * book meant leaving the half typed purchase, going to Suppliers, adding them,
 * and coming back to start again. Lifted into a modal so the purchase screen
 * can open it in place.
 *
 * Built on ModalShell rather than its own overlay, for the same reason
 * PartyFormModal now is: there were fourteen modals and two conventions, and
 * a new one written from scratch never quite matches the last.
 *
 * Only the name is required, as on the customer side. A wholesaler entering
 * forty mills out of an old ledger should not be stopped by a field they do
 * not have in front of them.
 */
const SupplierFormModal = ({ supplier, onClose, onSaved }) => {
  const editing = Boolean(supplier);

  const [form, setForm] = useState({
    name: supplier?.name || "",
    businessName: supplier?.business_name || "",
    phone: supplier?.phone || "",
    city: supplier?.city || "",
    gstin: supplier?.gstin || "",
    address: supplier?.address || "",
    notes: supplier?.notes || "",
    // Positive is what YOU owe them, the mirror of the customer side.
    openingBalance:
      supplier?.opening_balance && Number(supplier.opening_balance) !== 0
        ? String(Number(supplier.opening_balance))
        : "",
    openingBalanceOn: supplier?.opening_balance_on
      ? String(supplier.opening_balance_on).slice(0, 10)
      : "",
  });
  const [status, setStatus] = useState(supplier?.status || "active");
  const [saving, setSaving] = useState(false);

  const set = (field) => (e) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Same as PartyFormModal: this opens from inside the purchase form, and
    // a React portal still carries the submit up the React tree to it. Adding
    // a supplier mid-bill was also trying to save the bill, and answering
    // "Choose a supplier" behind the toast saying the supplier was added.
    e.stopPropagation();
    if (!form.name.trim()) {
      toast.error("Give this supplier a name.");
      return;
    }

    setSaving(true);
    try {
      const { data } = editing
        ? await api.put(`/api/suppliers/${supplier.id}`, { ...form, status })
        : await api.post("/api/suppliers", form);
      toast.success(editing ? "Supplier saved." : "Supplier added.");
      onSaved(data);
    } catch (error) {
      toast.error(
        error.response?.data?.message ||
          (editing ? "Could not save changes." : "Could not add this supplier."),
      );
      setSaving(false);
    }
  };

  const box =
    "w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none transition-colors focus:border-clay";

  const field = (name, label, props = {}) => (
    <div className={props.wide ? "sm:col-span-2" : undefined}>
      <label
        htmlFor={`supplier-${name}`}
        className="mb-1.5 block text-sm font-bold text-espresso"
      >
        {label}
        {props.required && <span className="text-clay"> *</span>}
      </label>
      <input
        id={`supplier-${name}`}
        value={form[name]}
        onChange={set(name)}
        placeholder={props.placeholder}
        inputMode={props.inputMode}
        className={`${box} ${props.uppercase ? "uppercase" : ""}`}
      />
      {props.hint && <p className="mt-1 text-xs text-slate-500">{props.hint}</p>}
    </div>
  );

  return (
    <ModalShell
      onClose={onClose}
      maxWidth="sm:max-w-lg"
      labelledBy="supplier-form-title"
      title={editing ? "Edit supplier" : "Add supplier"}
      closeOnOverlayClick={false}
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
            form="supplier-form"
            disabled={saving}
            className="flex-1 rounded-lg bg-clay py-2.5 text-sm font-bold text-cream transition-colors hover:bg-espresso disabled:opacity-60"
          >
            {saving ? "Saving..." : editing ? "Save changes" : "Add supplier"}
          </button>
        </div>
      }
    >
      <form id="supplier-form" onSubmit={handleSubmit}>
        <div className="space-y-4 px-6 py-5">
          <div>
            <label
              htmlFor="supplier-name"
              className="mb-1.5 block text-sm font-bold text-espresso"
            >
              Name <span className="text-clay">*</span>
            </label>
            <input
              id="supplier-name"
              value={form.name}
              onChange={set("name")}
              placeholder="Arvind Mills"
              className={box}
            />
            <p className="mt-1 text-xs text-slate-500">
              Whatever you call them.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {field("phone", "Phone", {
              placeholder: "98765 43210",
              inputMode: "tel",
            })}
            {field("city", "City", { placeholder: "Ahmedabad" })}
          </div>

          {field("businessName", "Firm name", {
            placeholder: "Arvind Mills Pvt Ltd",
          })}

          {field("gstin", "GST number", {
            placeholder: "24AAACC1206D1ZM",
            uppercase: true,
            hint: "Leave empty if they are not registered. An unregistered supplier's bill carries no input credit.",
          })}

          {field("address", "Address", {
            placeholder: "Plot number, area",
          })}

          {/* What you already owed them before this book existed. Same
              reasoning as the customer side, opposite direction. */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-bold text-espresso">
              Already owed, before you started using this
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              Leave both empty for a new supplier.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="supplier-opening"
                  className="mb-1 block text-xs font-semibold text-slate-600"
                >
                  Amount
                </label>
                <input
                  id="supplier-opening"
                  value={form.openingBalance}
                  onChange={set("openingBalance")}
                  inputMode="decimal"
                  placeholder="0"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition-colors focus:border-clay"
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  {Number(form.openingBalance) < 0
                    ? "They are holding your money."
                    : "What you owed them. Put a minus in front if they were holding your money."}
                </p>
              </div>
              <div>
                <label
                  htmlFor="supplier-opening-on"
                  className="mb-1 block text-xs font-semibold text-slate-600"
                >
                  As at
                </label>
                <input
                  id="supplier-opening-on"
                  type="date"
                  value={form.openingBalanceOn}
                  onChange={set("openingBalanceOn")}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition-colors focus:border-clay"
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Their statement starts from this date.
                </p>
              </div>
            </div>
          </div>

          <div>
            <label
              htmlFor="supplier-notes"
              className="mb-1.5 block text-sm font-bold text-espresso"
            >
              Private note
            </label>
            <textarea
              id="supplier-notes"
              value={form.notes}
              onChange={set("notes")}
              rows={2}
              placeholder="Delivers on Tuesdays, pays attention to selvedge"
              className={`${box} resize-none`}
            />
            <p className="mt-1 text-xs text-slate-500">
              Only you ever see this. It never appears on a bill.
            </p>
          </div>

          {editing && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={status === "inactive"}
                  onChange={(e) =>
                    setStatus(e.target.checked ? "inactive" : "active")
                  }
                  className="mt-0.5 h-4 w-4 shrink-0 accent-clay"
                />
                <span>
                  <span className="block text-sm font-bold text-espresso">
                    Not buying from them any more
                  </span>
                  {/* Not a delete. Their purchases and payments have to stay. */}
                  <span className="block text-xs text-slate-500">
                    Hides them from your supplier list. Everything you have
                    bought stays exactly as it is.
                  </span>
                </span>
              </label>
            </div>
          )}
        </div>
      </form>
    </ModalShell>
  );
};

export default SupplierFormModal;

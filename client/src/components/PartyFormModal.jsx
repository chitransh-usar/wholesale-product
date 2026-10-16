import { useState } from "react";
import api from "../utils/axios";
import ModalShell from "./ModalShell";
import { toast } from "sonner";
import { gstinFeedback, INDIAN_STATES } from "../utils/gstin";

/**
 * Adds a customer or edits one. The same form does both, because the fields
 * are identical and keeping two copies is how they drift apart.
 *
 * Only the name is required. Somebody typing sixty customers out of their phone
 * should not be stopped by a field they do not have in front of them, and the
 * rest can be filled in later from the customer's own page.
 */
const PartyFormModal = ({ party, onClose, onSaved }) => {
  const editing = Boolean(party);

  const [form, setForm] = useState({
    name: party?.name || "",
    businessName: party?.business_name || "",
    phone: party?.phone || "",
    city: party?.city || "",
    state: party?.state || "",
    gstin: party?.gstin || "",
    address: party?.address || "",
    notes: party?.notes || "",
    // Signed: positive is what they owe, negative is their money you are holding.
    // Kept as a string so the box can be empty, which is not the same as zero.
    openingBalance:
      party?.opening_balance && Number(party.opening_balance) !== 0
        ? String(Number(party.opening_balance))
        : "",
    openingBalanceOn: party?.opening_balance_on
      ? String(party.opening_balance_on).slice(0, 10)
      : "",
    // How much you are willing to let this customer owe. Blank means no
    // limit, which is what almost every customer has.
    creditLimit:
      party?.credit_limit && Number(party.credit_limit) !== 0
        ? String(Number(party.credit_limit))
        : "",
  });
  const [status, setStatus] = useState(party?.status || "active");
  const [saving, setSaving] = useState(false);

  const set = (field) => (e) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const gst = gstinFeedback(form.gstin);

  const handleSubmit = async (e) => {
    e.preventDefault();
    // The modal is opened from inside the sale form, and a React portal
    // still bubbles this submit up the React tree to that form's onSubmit.
    // Without this, adding a customer mid-sale also tried to save the sale,
    // which answered "Choose a customer" over the top of the customer just
    // being added. preventDefault does not stop that: it stops the browser
    // navigating, not the event travelling.
    e.stopPropagation();
    if (!form.name.trim()) {
      toast.error("Please enter a name.");
      return;
    }
    // A half typed number counts as wrong at this point: they pressed save.
    if (form.gstin.trim() && gst.state !== "good") {
      toast.error("Please check the GST number, or clear it.");
      return;
    }

    setSaving(true);
    try {
      // Every field is sent on an edit, including the empty ones, because
      // emptying a box is how a wrong phone number gets removed.
      const { data } = editing
        ? await api.put(`/api/parties/${party.id}`, { ...form, status })
        : await api.post("/api/parties", form);
      onSaved(data);
    } catch (error) {
      toast.error(
        error.response?.data?.message ||
          (editing ? "Could not save changes." : "Could not add this customer."),
      );
      setSaving(false);
    }
  };

  const field = (id, label, props = {}) => (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-sm font-bold text-espresso"
      >
        {label}
      </label>
      <input
        id={id}
        value={form[props.name]}
        onChange={set(props.name)}
        placeholder={props.placeholder}
        inputMode={props.inputMode}
        className={`w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none transition-colors focus:border-clay ${
          props.uppercase ? "uppercase" : ""
        }`}
      />
      {props.hint && (
        <p className="mt-1 text-xs text-slate-500">{props.hint}</p>
      )}
    </div>
  );

  return (
    <ModalShell
      onClose={onClose}
      maxWidth="sm:max-w-lg"
      labelledBy="party-form-title"
      title={editing ? "Edit customer" : "Add customer"}
      /* A half typed customer is not worth losing to a stray click on the
         dark area. Escape still closes it, which is deliberate rather than
         an oversight: that one takes a decision, a misplaced click does not. */
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
          {/* Outside the form element, so `form` ties it back to the form it
              submits. That is what lets the button stay pinned below the
              scroll area instead of scrolling off the bottom of a phone. */}
          <button
            type="submit"
            form="party-form"
            disabled={saving}
            className="flex-1 rounded-lg bg-clay py-2.5 text-sm font-bold text-cream transition-colors hover:bg-espresso disabled:opacity-60"
          >
            {saving ? "Saving..." : editing ? "Save changes" : "Add customer"}
          </button>
        </div>
      }
    >
      <form id="party-form" onSubmit={handleSubmit}>
        <div className="space-y-4 px-6 py-5">
          <div>
            <label
              htmlFor="party-name"
              className="mb-1.5 block text-sm font-bold text-espresso"
            >
              Name <span className="text-clay">*</span>
            </label>
            <input
              id="party-name"
              value={form.name}
              onChange={set("name")}
              autoFocus={!editing}
              placeholder="Ramesh Bhai"
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none transition-colors focus:border-clay"
            />
            <p className="mt-1 text-xs text-slate-500">
              Whatever you call them.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {field("party-phone", "Phone", {
              name: "phone",
              placeholder: "98765 43210",
              inputMode: "tel",
            })}
            {field("party-city", "City", {
              name: "city",
              placeholder: "Surat",
            })}
          </div>

          {/* The state decides the tax on their bill: same state as you is CGST
              plus SGST, a different one is IGST. A GST number answers it on
              its own, so this is for the customer who has none. Left empty it
              is treated as your own state, which is what local trade is. */}
          <div>
            <label
              htmlFor="party-state"
              className="mb-1.5 block text-sm font-bold text-espresso"
            >
              State
            </label>
            <select
              id="party-state"
              value={form.state}
              onChange={set("state")}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition-colors focus:border-clay"
            >
              <option value="">Same state as you</option>
              {INDIAN_STATES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              Only needed for a customer in another state who has no GST
              number. Their bill will show IGST instead of CGST and SGST.
            </p>
          </div>

          {field("party-business", "Shop name", {
            name: "businessName",
            placeholder: "Ramesh Cloth Store",
          })}

          {/* Checked as it is typed. The number carries its own check
              digit, so a mistyped one can be caught here with nothing to
              call and nothing to pay for. The server checks it again. */}
          <div>
            <label
              htmlFor="party-gstin"
              className="mb-1.5 block text-sm font-bold text-espresso"
            >
              GST number
            </label>
            <input
              id="party-gstin"
              value={form.gstin}
              onChange={set("gstin")}
              placeholder="24AAACC1206D1ZM"
              className={`w-full rounded-lg border px-3 py-2.5 text-sm uppercase outline-none transition-colors ${
                gst.state === "bad"
                  ? "border-rose-300 focus:border-rose-400"
                  : "border-slate-200 focus:border-clay"
              }`}
            />
            <p
              className={`mt-1 text-xs ${
                gst.state === "bad"
                  ? "text-rose-600"
                  : gst.state === "good"
                    ? "text-emerald-700"
                    : "text-slate-500"
              }`}
            >
              {gst.state === "good"
                ? `Looks right. Registered in ${gst.stateName}.`
                : gst.state === "bad" || gst.state === "typing"
                  ? gst.message
                  : "Leave blank if they are not registered. Goes on their bill so they can claim input credit."}
            </p>
          </div>

          {field("party-address", "Address", {
            name: "address",
            placeholder: "Shop number, street, area",
          })}

          {/* What they already owed when this book was opened.
              
              Without it a wholesaler who has traded for twenty years opens their
              customer book and is told nobody owes them anything. Their only ways
              round it were entering a fake sale, which puts goods in their books
              they never sold, or not using the product. */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-bold text-espresso">
              Already owed, before you started using this
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              Leave both empty for a new customer.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="party-opening"
                  className="mb-1 block text-xs font-semibold text-slate-600"
                >
                  Amount
                </label>
                <input
                  id="party-opening"
                  value={form.openingBalance}
                  onChange={set("openingBalance")}
                  inputMode="decimal"
                  placeholder="0"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition-colors focus:border-clay"
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  {Number(form.openingBalance) < 0
                    ? "You are holding their money."
                    : "What they owed you. Put a minus in front if you were holding their money."}
                </p>
              </div>
              <div>
                <label
                  htmlFor="party-opening-on"
                  className="mb-1 block text-xs font-semibold text-slate-600"
                >
                  As at
                </label>
                <input
                  id="party-opening-on"
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

          {/* How far you will let them run. Nothing is ever refused on it: the
              sale form says something after the fact, because by the time a
              wholesaler is writing a sale down the goods have usually already
              gone and refusing to record it would only lose the sale from the
              khata. */}
          <div>
            <label
              htmlFor="party-credit-limit"
              className="mb-1.5 block text-sm font-bold text-espresso"
            >
              Credit limit
            </label>
            <input
              id="party-credit-limit"
              value={form.creditLimit}
              onChange={set("creditLimit")}
              inputMode="decimal"
              placeholder="No limit"
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none transition-colors focus:border-clay"
            />
            <p className="mt-1 text-xs text-slate-500">
              Leave it empty for no limit. If they go past it you get a warning
              when you record a sale. Nothing is ever blocked.
            </p>
          </div>

          <div>
            <label
              htmlFor="party-notes"
              className="mb-1.5 block text-sm font-bold text-espresso"
            >
              Private note
            </label>
            <textarea
              id="party-notes"
              value={form.notes}
              onChange={set("notes")}
              rows={2}
              placeholder="Pays on the 5th, deliver before 11"
              className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none transition-colors focus:border-clay"
            />
            <p className="mt-1 text-xs text-slate-500">
              Only you can see this. It never appears on a bill.
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
                    Not dealing with them any more
                  </span>
                  {/* Not a delete. Their sales and bills have to stay. */}
                  <span className="block text-xs text-slate-500">
                    Hides them from your customer list. Everything you have
                    sold them stays exactly as it is.
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

export default PartyFormModal;

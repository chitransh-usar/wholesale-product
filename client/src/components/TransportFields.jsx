import { ChevronDown } from "lucide-react";

/**
 * The transport block, in one place, used by the sale screen and the invoice
 * screen.
 *
 * Two copies of eight fields is how one screen ends up offering a mode the
 * other refuses, or labelling the same box two different ways in front of the
 * same wholesaler. The server keeps its single copy in transportDetails.js for
 * the same reason.
 *
 * These are the e-way bill fields, which is why they are worth the care. They
 * matter beyond printing: the payload that eventually goes to NIC is built
 * from exactly these.
 */

/**
 * One labelled box.
 *
 * Reads its own value out of the group's state by name, so a field cannot be
 * wired to the wrong key and still look right.
 */
export const Field = ({ label, name, value, onChange, type = "text", placeholder }) => (
  <div>
    <label className="mb-1 block text-xs font-semibold text-espresso/70">{label}</label>
    <input
      type={type}
      value={value[name] || ""}
      placeholder={placeholder}
      onChange={(e) => onChange(name, e.target.value)}
      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm text-espresso placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-clay/20"
    />
  </div>
);

/**
 * A state, picked by name.
 *
 * The two digit GST code is NOT asked for. It is looked up from the name on
 * the server, because it is the number that decides CGST and SGST against
 * IGST, and asking somebody to type 27 next to Maharashtra is asking them to
 * get it wrong on a tax document.
 *
 * Falls back to a plain box if the state master has not loaded, so the field
 * still works rather than offering an empty list.
 */
export const StateField = ({ label, name, value, onChange, states }) => {
  if (!states?.length) {
    return <Field label={label} name={name} value={value} onChange={onChange} />;
  }
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-espresso/70">{label}</label>
      <select
        value={value[name] || ""}
        onChange={(e) => onChange(name, e.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm text-espresso focus:outline-none focus:ring-2 focus:ring-clay/20"
      >
        <option value="">Not stated</option>
        {states.map((s) => (
          <option key={s.code} value={s.name}>
            {s.name} ({s.code})
          </option>
        ))}
      </select>
    </div>
  );
};

/** The eight transport fields, with nothing around them. */
export const TransportGrid = ({ value, onChange }) => (
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
    <Field label="Transporter" name="transporterName" value={value} onChange={onChange} placeholder="Maruti Roadlines" />
    <Field label="Transporter ID or GSTIN" name="transporterId" value={value} onChange={onChange} />
    <div>
      <label className="mb-1 block text-xs font-semibold text-espresso/70">
        How it travels
      </label>
      <select
        value={value.transportMode || ""}
        onChange={(e) => onChange("transportMode", e.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm text-espresso focus:outline-none focus:ring-2 focus:ring-clay/20"
      >
        <option value="">Not stated</option>
        <option value="road">By road</option>
        <option value="rail">By rail</option>
        <option value="air">By air</option>
        <option value="ship">By ship</option>
      </select>
    </div>
    <Field label="Vehicle number" name="vehicleNumber" value={value} onChange={onChange} placeholder="MH04AB1234" />
    <Field label="LR or RR number" name="transportDocNumber" value={value} onChange={onChange} />
    <Field label="LR or RR date" name="transportDocDate" value={value} onChange={onChange} type="date" />
    <Field label="GR number" name="grNumber" value={value} onChange={onChange} />
    <Field label="GR date" name="grDate" value={value} onChange={onChange} type="date" />
  </div>
);

/**
 * The transport block as its own collapsible card, for a screen that wants
 * only this and not the despatch addresses.
 *
 * Closed by default. Most sales are collected from the shop by the customer
 * and have no lorry at all, so opening on eight empty boxes makes the common
 * case look like work. Opens by itself when something is already filled in,
 * which is what an edit of a sale that HAD transport needs.
 */
const TransportCard = ({ value, onChange, open, onToggle }) => (
  <section className="rounded-2xl border border-slate-200 bg-white shadow-xs">
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-center justify-between gap-3 p-5 text-left"
    >
      <span>
        <span className="block text-sm font-bold text-espresso">
          Transport
        </span>
        <span className="mt-0.5 block text-xs text-espresso/60">
          Only if the goods go out with a transporter. Filled in here, they
          print on the bill raised from this sale without being typed again.
        </span>
      </span>
      <ChevronDown
        className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
      />
    </button>
    {open && (
      <div className="border-t border-slate-100 p-5 pt-4">
        <TransportGrid value={value} onChange={onChange} />
      </div>
    )}
  </section>
);

export default TransportCard;

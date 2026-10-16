import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Info, Lock } from "lucide-react";
import api from "../../utils/axios";
import { toast } from "sonner";
import { resetMasters } from "../../hooks/useMasters";
import { money, taxRate, dateLabel, applyMoneySettings } from "../../utils/money";

/**
 * How the whole platform shows a number and a date.
 *
 * Every field here is a CONVENTION rather than a preference, which is why it
 * is platform level. Indian digit grouping is not something one wholesaler
 * should be able to turn off: 12,00,000 and 1,200,000 are the same number
 * written for two different readerships, and their customers are all in the
 * first. Same for the rupee symbol and the date order.
 *
 * What is deliberately NOT here, and stays on each wholesaler's own Invoice
 * defaults screen: invoice prefix, suffix and padding, due days, default GST
 * rate, notes, terms, bank details, GSTIN. One wholesaler changing their prefix
 * must not change everybody's.
 *
 * THE SAMPLE UPDATES AS YOU TYPE, and it is not decoration. Somebody choosing
 * between "indian" and "western" in a dropdown is choosing between two words;
 * seeing 12,00,000 turn into 1,200,000 is choosing between two numbers.
 */

const FIELDS = [
  {
    group: "Money",
    items: [
      {
        name: "amountDecimals",
        label: "Decimals on screen",
        type: "number",
        min: 0,
        max: 4,
        hint: "What a wholesaler sees at a glance. Zero reads best: they want 27,200, not 27,200.00.",
      },
      {
        name: "documentDecimals",
        label: "Decimals on a document",
        type: "number",
        min: 0,
        max: 4,
        hint: "Invoices, challans, credit notes. Two, because a bill whose lines do not add up to its total is a query from the customer's accountant.",
      },
      {
        name: "digitGrouping",
        label: "Digit grouping",
        type: "choice",
        of: [
          { value: "indian", label: "Indian: 12,00,000" },
          { value: "western", label: "Western: 1,200,000" },
        ],
        hint: "A trader reads lakhs and crores by where the commas fall.",
      },
      { name: "currencySymbol", label: "Currency symbol", type: "text" },
      {
        name: "currencyName",
        label: "Currency, in words",
        type: "text",
        hint: "For the amount in words on a tax invoice.",
      },
      {
        name: "currencySubunitName",
        label: "Sub unit, in words",
        type: "text",
        hint: "Paise. Not derivable from the name above, which is why it is its own field.",
      },
    ],
  },
  {
    group: "Tax",
    items: [
      {
        name: "taxRateDecimals",
        label: "Decimals on a tax rate",
        type: "number",
        min: 0,
        max: 4,
        hint: "Kept apart from money decimals for a real reason: 0.25% is a genuine GST slab, so a rate needs two decimals even where an amount needs none.",
      },
      {
        name: "defaultHsnMinDigits",
        label: "Default minimum HSN digits",
        type: "choice",
        of: [
          { value: 4, label: "4 digits" },
          { value: 6, label: "6 digits" },
          { value: 8, label: "8 digits" },
        ],
        hint: "A starting point for a NEW wholesaler, not a rule. Their own turnover decides their: six above 5 crore, four below.",
      },
    ],
  },
  {
    group: "Dates",
    items: [
      {
        name: "dateFormat",
        label: "Date format",
        type: "choice",
        of: [
          { value: "dd-mmm-yyyy", label: "9 Sep 2026" },
          { value: "dd/mm/yyyy", label: "09/09/2026" },
          { value: "yyyy-mm-dd", label: "2026-09-09" },
        ],
      },
    ],
  },
];

/**
 * Rule 46(b), shown and not editable.
 *
 * An invoice serial may be at most sixteen characters, may use only letters,
 * digits, a hyphen and a slash, and must be unique within a financial year.
 * That is law, not a setting, and putting it in a box somebody can change
 * would imply otherwise. It is here because the administration area is where somebody
 * looks for it.
 */
const LEGAL = [
  ["Invoice serial length", "16 characters at most"],
  ["Allowed characters", "Letters, digits, hyphen and slash"],
  ["Uniqueness", "One series per financial year, per wholesaler"],
  ["Financial year", "1 April to 31 March"],
];

const MasterSettings = () => {
  const { fromMasters } = useOutletContext() || {};
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .get("/api/masters")
      .then(({ data }) => {
        if (!alive) return;
        setForm(data?.settings || null);
        setSaved(data?.settings || null);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        toast.error("Could not load the settings.");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * The sample is drawn with the formatter the whole product uses, not with a
   * copy of it. Pushing the draft in and putting it back is how it can show an
   * unsaved choice honestly: if these two ever disagreed, the preview would be
   * the thing lying about what saving does.
   */
  const preview = () => {
    if (!form) return null;
    applyMoneySettings(form);
    const out = {
      screen: `${form.currencySymbol}${money(1250000)}`,
      document: `${form.currencySymbol}${money(1250000.5, { document: true })}`,
      rate: `${taxRate(0.25)}%`,
      date: dateLabel("2026-09-09"),
    };
    applyMoneySettings(saved);
    return out;
  };

  const set = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));

  const dirty =
    form && saved && FIELDS.flatMap((g) => g.items).some((f) => form[f.name] !== saved[f.name]);

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put("/api/masters/settings", form);
      setForm(data.settings);
      setSaved(data.settings);
      applyMoneySettings(data.settings);
      // So every other screen in this tab picks the change up rather than
      // serving its five minute cache.
      resetMasters();
      toast.success("Settings saved.");
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not save those settings.");
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent" />
      </div>
    );
  }

  if (!form) {
    return (
      <p className="py-20 text-center text-sm text-slate-500">
        Could not load the settings.
      </p>
    );
  }

  const sample = preview();

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-24">
      <div>
        <h2 className="text-2xl font-black text-espresso">Settings</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          How every screen and every document on the platform shows a number, a
          tax rate and a date. These are conventions rather than preferences,
          which is why they are set once here and not by each wholesaler.
        </p>
      </div>

      {/* The sample, above the fields, because it is what the fields mean. */}
      <div className="rounded-2xl border border-clay/30 bg-white p-5 shadow-sm">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
          How it will read
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-4">
          {[
            ["On a screen", sample.screen],
            ["On a document", sample.document],
            ["A tax rate", sample.rate],
            ["A date", sample.date],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-0.5 text-lg font-black text-espresso">{value}</p>
            </div>
          ))}
        </div>
        {dirty && (
          <p className="mt-3 text-xs font-semibold text-clay">
            Showing your unsaved changes.
          </p>
        )}
      </div>

      {FIELDS.map((group) => (
        <div
          key={group.group}
          className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
        >
          <div className="border-b border-slate-100 bg-slate-50 px-5 py-3">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
              {group.group}
            </h3>
          </div>
          <div className="grid gap-5 p-5 sm:grid-cols-2">
            {group.items.map((field) => (
              <div key={field.name}>
                <label
                  htmlFor={`ms-${field.name}`}
                  className="mb-1 block text-xs font-semibold text-slate-600"
                >
                  {field.label}
                </label>
                {field.type === "choice" ? (
                  <select
                    id={`ms-${field.name}`}
                    value={form[field.name]}
                    disabled={!fromMasters}
                    onChange={(e) =>
                      set(
                        field.name,
                        typeof field.of[0].value === "number"
                          ? Number(e.target.value)
                          : e.target.value,
                      )
                    }
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-clay disabled:opacity-60"
                  >
                    {field.of.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`ms-${field.name}`}
                    type={field.type === "number" ? "number" : "text"}
                    min={field.min}
                    max={field.max}
                    value={form[field.name]}
                    disabled={!fromMasters}
                    onChange={(e) =>
                      set(
                        field.name,
                        field.type === "number"
                          ? Number(e.target.value)
                          : e.target.value,
                      )
                    }
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-clay disabled:opacity-60"
                  />
                )}
                {field.hint && (
                  <p className="mt-1 text-[11px] text-slate-400">{field.hint}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Law, not settings. */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-5 py-3">
          <Lock className="h-3.5 w-3.5 text-slate-400" />
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
            Fixed by law
          </h3>
        </div>
        <ul className="divide-y divide-slate-100">
          {LEGAL.map(([label, value]) => (
            <li
              key={label}
              className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"
            >
              <span className="text-sm text-slate-600">{label}</span>
              <span className="text-sm font-bold text-espresso">{value}</span>
            </li>
          ))}
        </ul>
        <p className="flex items-start gap-2 border-t border-slate-100 px-5 py-3 text-[11px] text-slate-400">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Rule 46(b) of the CGST Rules. Shown here because this is where somebody
          looks for it, and not editable because it is not ours to change.
        </p>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <p className="text-xs text-slate-500">
            {dirty ? "You have unsaved changes." : "Everything is saved."}
          </p>
          <button
            onClick={save}
            disabled={saving || !dirty || !fromMasters}
            className="rounded-lg bg-clay px-6 py-2.5 text-sm font-bold text-cream transition-colors hover:bg-espresso disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save settings"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MasterSettings;

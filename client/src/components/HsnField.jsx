import { useEffect, useRef, useState } from "react";
import api from "../utils/axios";
import { hsnFeedback, tidyHsn } from "../utils/hsn";

/**
 * One box for an HSN code, used everywhere a code is entered.
 *
 * Three things, and they are three different kinds of claim, so the screen
 * keeps them apart:
 *
 *   the shape       4, 6 or 8 digits, checked as they type. Certain.
 *   their own codes   what they have put on their own goods before. Certain, because
 *                   they decided it.
 *   common headings a short list for textiles, offered as a starting point.
 *                   NOT certain, and labelled so they check it.
 *
 * The last one is why the list says "check this matches your goods" rather
 * than presenting the label as a fact. A suggestion they accept without reading
 * puts a description of somebody else's goods on their customer's bill.
 */
const HsnField = ({
  id = "hsn-code",
  value,
  onChange,
  label = "HSN code",
  hint = "Printed on your bills. Leave it blank if you do not know it.",
  className = "",
}) => {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  const feedback = hsnFeedback(value);

  // Fetched when the box is opened, and again as they type. Debounced, because
  // this fires on a keystroke and the answer is a convenience, not the point
  // of the screen.
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get("/api/hsn/suggest", {
          params: { q: value || "" },
        });
        if (alive) setSuggestions(Array.isArray(data) ? data : []);
      } catch {
        // No suggestions is a fine outcome. They can type the code.
        if (alive) setSuggestions([]);
      }
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, value]);

  // Closing on an outside click, per instance. The navbar's location menu was
  // broken for months by sharing this kind of state between two copies of a
  // component, so it stays local.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (boxRef.current && !boxRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (code) => {
    onChange(code);
    setOpen(false);
  };

  const tone =
    feedback.state === "bad"
      ? "text-rose-600"
      : feedback.state === "good"
        ? "text-emerald-700"
        : "text-slate-500";

  return (
    <div className={`relative ${className}`} ref={boxRef}>
      <label
        htmlFor={id}
        className="mb-2 block text-xs font-semibold text-slate-600"
      >
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={value || ""}
        onChange={(e) => onChange(tidyHsn(e.target.value))}
        onFocus={() => setOpen(true)}
        placeholder="5208"
        autoComplete="off"
        className={`w-full rounded-lg border bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:bg-white ${
          feedback.state === "bad"
            ? "border-rose-300 focus:border-rose-400"
            : "border-slate-200 focus:border-clay"
        }`}
      />
      <p className={`mt-1.5 text-xs ${tone}`}>{feedback.message || hint}</p>

      {open && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <ul className="max-h-64 overflow-y-auto">
            {suggestions.map((row) => (
              <li key={row.code}>
                <button
                  type="button"
                  onClick={() => pick(row.code)}
                  className="flex w-full items-baseline gap-3 px-3 py-2 text-left transition-colors hover:bg-slate-50"
                >
                  <span className="font-mono text-sm font-bold text-espresso">
                    {row.code}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
                    {row.label}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                      row.from === "yours"
                        ? "bg-sage/15 text-sage"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {row.from === "yours" ? `Used ${row.times}x` : "Common"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="border-t border-slate-100 bg-slate-50/60 px-3 py-2 text-[11px] text-slate-500">
            Codes marked Common are usual textile headings, not a check on your
            goods. Read the description before you pick one.
          </p>
        </div>
      )}
    </div>
  );
};

export default HsnField;

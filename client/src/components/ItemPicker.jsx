import { useMemo, useRef, useState } from "react";
import { trimmed as money } from "../utils/money";

/**
 * Item name box on a sale, with suggestions from the wholesaler's rate list.
 *
 * Picking a suggestion fills the rate and the unit, which is the whole point
 * of keeping a rate list. Typing straight past the suggestions is still fine:
 * a sale has to be recordable for something that was never on the list, which
 * is also why sale_lines stores the name as text rather than a reference.
 */
const ItemPicker = ({ value, items, onChange, onPick, placeholder }) => {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const blurTimer = useRef(null);

  const matches = useMemo(() => {
    const term = String(value || "").trim().toLowerCase();
    const pool = term
      ? items.filter((item) => item.name.toLowerCase().includes(term))
      : items;
    // A long rate list would bury the box under its own suggestions.
    return pool.slice(0, 6);
  }, [items, value]);

  // Nothing to suggest once the text already is an item, exactly.
  const exact = items.some(
    (item) =>
      item.name.toLowerCase() === String(value || "").trim().toLowerCase(),
  );
  const show = open && matches.length > 0 && !exact;

  const choose = (item) => {
    clearTimeout(blurTimer.current);
    onPick(item);
    setOpen(false);
  };

  const handleKeyDown = (e) => {
    if (!show) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(matches[active] ?? matches[0]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Blur fires before a click on a suggestion registers, so the close
        // is deferred just long enough for the click to land.
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold outline-none transition-colors focus:border-clay"
      />

      {show && (
        <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {matches.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                // mousedown rather than click, so the choice is made before
                // the input's blur can close the list underneath the cursor.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(item);
                }}
                onMouseEnter={() => setActive(index)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors ${
                  index === active ? "bg-clay/10" : "hover:bg-slate-50"
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-espresso">
                  {item.name}
                </span>
                <span className="shrink-0 text-xs font-bold text-slate-500">
                  ₹{money(item.rate)}
                  <span className="font-medium text-slate-400">
                    /{item.unit}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default ItemPicker;

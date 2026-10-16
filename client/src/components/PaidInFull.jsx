import { amount as money } from "../utils/money";

/**
 * "Paid in full", beside a box somebody would otherwise retype the total into.
 *
 * Most bills in this trade are settled in one go. Making the wholesaler read
 * the total off the screen and type it back in is both slower and a chance to
 * fat finger a digit, and a mistyped receipt is a customer's balance that is
 * wrong until somebody notices.
 *
 * Ticking it writes the exact figure, to the paisa, and locks the box so the
 * two cannot disagree. Unticking clears it and hands the box back.
 *
 * It unticks ITSELF when the total moves, which matters on a form where the
 * total is still being built: add another line after ticking and the amount
 * would otherwise sit at the old total and quietly understate what was taken.
 * Rather than silently rewriting the figure underneath somebody, it releases
 * the box and lets them decide again.
 */
const PaidInFull = ({ total, value, onChange, label = "Paid in full", id }) => {
  const due = Number(total || 0);

  // To the paisa, and compared as a string, because 1234.5 and "1234.50" are
  // the same money and a number comparison on a typed value is not reliable.
  const exact = due > 0 ? due.toFixed(2) : "";
  const checked = due > 0 && String(value ?? "") === exact;

  if (!(due > 0)) return null;

  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center gap-2 text-sm text-espresso/80 select-none"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked ? exact : "")}
        className="h-4 w-4 accent-clay"
      />
      <span>
        {label}
        <span className="ml-1 font-semibold text-espresso">
          ₹{money(due)}
        </span>
      </span>
    </label>
  );
};

export default PaidInFull;

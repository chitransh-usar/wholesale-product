/**
 * Money arithmetic, in one place.
 *
 * Rupees are summed in paise. A three line bill of odd amounts loses a paisa
 * per line in floating point, and a wholesaler notices a total that is one
 * rupee off.
 *
 * These were copy pasted into three controllers. The copies were identical,
 * which is the good case; the bad case is the day one of them is fixed and
 * the other two are not. This project has already shipped one paisa bug.
 */

const toPaise = (rupees) => Math.round(Number(rupees || 0) * 100);

const fromPaise = (paise) => Number((Number(paise || 0) / 100).toFixed(2));

/**
 * Trims a value and turns an empty string into null, so a cleared form field
 * reaches the database as NULL rather than "".
 */
const clean = (value) => {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
};

/**
 * A number, or null when nothing usable was given. Zero survives, because a
 * zero rate and a zero pack size are real answers.
 */
const optionalNumber = (value) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

const fullName = (first, last) =>
  [first, last].filter(Boolean).join(" ").trim() || null;

module.exports = { toPaise, fromPaise, clean, optionalNumber, fullName };

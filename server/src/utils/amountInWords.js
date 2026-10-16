/**
 * An amount, written out in words, the Indian way.
 *
 * Universal on an Indian invoice and the thing a person checks the figure
 * against, because digits can be altered by hand and words cannot. The
 * example we were shown reads:
 *
 *   Rupees Twenty Seven Lakh Five Thousand Eight Hundred Eleven Only
 *
 * Indian grouping, not international: after the first thousand the groups go
 * in twos, so 27,05,811 is twenty seven LAKH five thousand, never "two
 * million seven hundred five thousand".
 *
 * Paise are named only when there are any. "Rupees Fifty Only" is right;
 * "Rupees Fifty and Zero Paise Only" is not how anybody writes it.
 */

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];

const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty",
  "Ninety",
];

/** 0 to 99. Nineteen and below are their own words, not ten plus nine. */
const twoDigits = (n) => {
  if (n < 20) return ONES[n];
  const tens = TENS[Math.floor(n / 10)];
  const ones = ONES[n % 10];
  return ones ? `${tens} ${ones}` : tens;
};

/** 0 to 999. */
const threeDigits = (n) => {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts = [];
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(" ");
};

/**
 * A whole number in words, in the Indian system.
 *
 * Groups, largest first: crore, lakh, thousand, then the last three digits.
 * Anything at or above a hundred crore is read as "N Crore" with N itself
 * spelled out, which is how it is said.
 */
const wholeNumber = (value) => {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return "Zero";

  const last3 = n % 1000;
  n = Math.floor(n / 1000);
  const thousands = n % 100;
  n = Math.floor(n / 100);
  const lakhs = n % 100;
  const crores = Math.floor(n / 100);

  const parts = [];
  // Crores can run past 99, so they recurse rather than using twoDigits.
  if (crores) parts.push(`${wholeNumber(crores)} Crore`);
  if (lakhs) parts.push(`${twoDigits(lakhs)} Lakh`);
  if (thousands) parts.push(`${twoDigits(thousands)} Thousand`);
  if (last3) parts.push(threeDigits(last3));
  return parts.join(" ");
};

/**
 * The full line for a document.
 *
 * @param {number|string} amount
 * @param {object} [names]  currency words, which Busy keeps as a setting:
 *                          Currency String and Currency Sub-string
 * @returns {string} e.g. "Rupees Twenty Seven Lakh Five Thousand Eight Hundred Eleven Only"
 */
const amountInWords = (amount, { rupees = "Rupees", paise = "Paise" } = {}) => {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "";

  // Rounded to paise first. Reading the words off an unrounded float can
  // disagree with the figure printed beside it, which is the one thing this
  // line exists to prevent.
  const total = Math.round(Math.abs(value) * 100);
  const whole = Math.floor(total / 100);
  const fraction = total % 100;

  const parts = [rupees];
  if (value < 0) parts.push("Minus");
  parts.push(wholeNumber(whole));
  if (fraction) parts.push(`and ${twoDigits(fraction)} ${paise}`);
  parts.push("Only");
  return parts.join(" ");
};

module.exports = { amountInWords, wholeNumber };

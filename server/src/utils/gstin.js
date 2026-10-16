/**
 * Checking a GSTIN without paying anybody.
 *
 * There is no free government API that turns a GSTIN into a business name.
 * The lookups that do exist are resold by GST Suvidha Providers and every one
 * of them is metered. What is free, and what catches almost every mistake a
 * person actually makes, is the number's own arithmetic: a GSTIN carries a
 * check digit, so a mistyped one can be caught on the spot with no network
 * call, no key, no account and no rupee.
 *
 * What this does NOT tell you: whether the business exists, whether the
 * registration is live, or whose it is. A number can be perfectly formed and
 * belong to nobody. Anything that says "verified" on the strength of this
 * alone is lying, so nothing here uses that word.
 *
 * The shape, all 15 characters:
 *
 *   27        state code, 01 to 38, plus 97 for offshore and 99 for a UN body
 *   AAPFU0939F PAN, five letters, four digits, one letter
 *   1         which registration this is for that PAN, 1 to 9 then A to Z
 *   Z         fixed by the rules
 *   V         the check digit, computed from the other fourteen
 */

const CODEPOINTS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// 01 to 38 are the states and union territories. 97 is "other territory",
// used for the offshore area, and 99 is for a UN body or embassy.
const VALID_STATE_CODES = new Set([
  ...Array.from({ length: 38 }, (_, i) => String(i + 1).padStart(2, "0")),
  "97",
  "99",
]);

// Only the state code is checked against this list; the names are here so a
// message can say which state a number belongs to, which is what catches the
// commonest real error: a Gujarat wholesaler typing a Maharashtra GSTIN.
const STATE_NAMES = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab",
  "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana", "07": "Delhi",
  "08": "Rajasthan", "09": "Uttar Pradesh", 10: "Bihar", 11: "Sikkim",
  12: "Arunachal Pradesh", 13: "Nagaland", 14: "Manipur", 15: "Mizoram",
  16: "Tripura", 17: "Meghalaya", 18: "Assam", 19: "West Bengal",
  20: "Jharkhand", 21: "Odisha", 22: "Chhattisgarh", 23: "Madhya Pradesh",
  24: "Gujarat", 25: "Daman and Diu", 26: "Dadra and Nagar Haveli and Daman and Diu",
  27: "Maharashtra", 28: "Andhra Pradesh", 29: "Karnataka", 30: "Goa",
  31: "Lakshadweep", 32: "Kerala", 33: "Tamil Nadu", 34: "Puducherry",
  35: "Andaman and Nicobar Islands", 36: "Telangana", 37: "Andhra Pradesh",
  38: "Ladakh", 97: "Other Territory", 99: "Centre",
};

const STRUCTURE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

/**
 * The states a person can be asked to pick from, in one place.
 *
 * Built from the table above rather than typed out again, so the list a
 * wholesaler chooses from and the list a GSTIN is read against cannot drift
 * apart. Codes 97 and 99 are left out: "Other Territory" is the offshore area
 * and "Centre" is a UN body or an embassy, and neither is somewhere a
 * wholesaler keeps a godown.
 *
 * Two names appear against two codes each, because two states were split and
 * two union territories merged and the old registrations are still live. The
 * name is what gets stored, so the duplicate is dropped and both codes read
 * back to the same answer.
 */
const INDIAN_STATES = [
  ...new Set(
    Object.entries(STATE_NAMES)
      .filter(([code]) => Number(code) >= 1 && Number(code) <= 38)
      .map(([, name]) => name),
  ),
].sort((a, b) => a.localeCompare(b));

/** Case and spacing folded, for comparing two states written by two people. */
const stateKey = (value) =>
  String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** Upper cased, with spaces and dashes taken out. People type both. */
const tidy = (value) => String(value ?? "").toUpperCase().replace(/[\s-]/g, "");

/**
 * The check digit the first fourteen characters imply.
 *
 * Each character is read as a base 36 digit. Working right to left the factor
 * alternates 2, 1, 2, 1; each product is folded by adding its quotient and
 * remainder over 36; the check digit is whatever brings the total to a
 * multiple of 36.
 */
const checkDigit = (first14) => {
  let sum = 0;
  let factor = 2;
  for (let i = first14.length - 1; i >= 0; i--) {
    const point = CODEPOINTS.indexOf(first14[i]);
    if (point < 0) return null;
    const product = point * factor;
    factor = factor === 2 ? 1 : 2;
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CODEPOINTS[(36 - (sum % 36)) % 36];
};

/**
 * Is this a well formed GSTIN?
 *
 * Returns { ok, gstin, stateCode, stateName, pan, reason }. The reason is
 * written for the person typing, not for a log, because it is shown to them.
 */
const checkGstin = (value) => {
  const gstin = tidy(value);

  if (!gstin) return { ok: false, gstin: "", reason: "No GST number given." };
  if (gstin.length !== 15) {
    return {
      ok: false,
      gstin,
      reason: `A GST number is 15 characters. This one has ${gstin.length}.`,
    };
  }
  if (!STRUCTURE.test(gstin)) {
    return {
      ok: false,
      gstin,
      reason:
        "This does not look like a GST number. It should read like 27AAPFU0939F1ZV: two digits, then the PAN, then a digit, then Z, then one more character.",
    };
  }

  const stateCode = gstin.slice(0, 2);
  if (!VALID_STATE_CODES.has(stateCode)) {
    return { ok: false, gstin, reason: `${stateCode} is not a state code.` };
  }

  const expected = checkDigit(gstin.slice(0, 14));
  if (expected !== gstin[14]) {
    return {
      ok: false,
      gstin,
      reason:
        "The last character does not match the rest of the number, so something in it has been mistyped. Please check it against the certificate.",
    };
  }

  return {
    ok: true,
    gstin,
    stateCode,
    stateName: STATE_NAMES[stateCode] || null,
    pan: gstin.slice(2, 12),
  };
};

/** The short form, for a WHERE clause or a badge. */
const isValidGstin = (value) => checkGstin(value).ok;

/**
 * The state a GSTIN belongs to, or null.
 *
 * Worth having on its own: whether a sale is CGST plus SGST or IGST turns on
 * whether the buyer's state matches the seller's, and the first two digits of
 * the GSTIN are the most reliable statement of the buyer's state there is.
 */
const gstinState = (value) => {
  const result = checkGstin(value);
  return result.ok ? { code: result.stateCode, name: result.stateName } : null;
};

module.exports = {
  checkGstin,
  isValidGstin,
  gstinState,
  STATE_NAMES,
  INDIAN_STATES,
  stateKey,
};

/**
 * The same GST number check the server does, done as the person types.
 *
 * The server is the authority and checks again on every save. This copy
 * exists so a mistyped number is caught under the box while it is still on
 * screen, rather than after pressing save and reading a red message. It is
 * arithmetic on the number itself, so there is nothing to call and nothing to
 * pay for: see server/src/utils/gstin.js for what the fifteen characters mean.
 *
 * This does NOT check that the business exists or that the registration is
 * live. Nothing free does. So nothing here ever says "verified".
 */

const CODEPOINTS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const STRUCTURE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

const STATE_NAMES = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab",
  "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana", "07": "Delhi",
  "08": "Rajasthan", "09": "Uttar Pradesh", 10: "Bihar", 11: "Sikkim",
  12: "Arunachal Pradesh", 13: "Nagaland", 14: "Manipur", 15: "Mizoram",
  16: "Tripura", 17: "Meghalaya", 18: "Assam", 19: "West Bengal",
  20: "Jharkhand", 21: "Odisha", 22: "Chhattisgarh", 23: "Madhya Pradesh",
  24: "Gujarat", 25: "Daman and Diu",
  26: "Dadra and Nagar Haveli and Daman and Diu", 27: "Maharashtra",
  28: "Andhra Pradesh", 29: "Karnataka", 30: "Goa", 31: "Lakshadweep",
  32: "Kerala", 33: "Tamil Nadu", 34: "Puducherry",
  35: "Andaman and Nicobar Islands", 36: "Telangana", 37: "Andhra Pradesh",
  38: "Ladakh", 97: "Other Territory", 99: "Centre",
};

/**
 * The states a wholesaler can pick from.
 *
 * Built from the table above, the same way the server builds its copy, so the
 * list on the dropdown and the list a GST number is read against are the same
 * list. 97 and 99 are left out: they are the offshore area and a UN body.
 *
 * "Andhra Pradesh" holds two codes because the state was split, so the name is
 * deduplicated. The name is what gets stored.
 */
export const INDIAN_STATES = [
  ...new Set(
    Object.entries(STATE_NAMES)
      .filter(([code]) => Number(code) >= 1 && Number(code) <= 38)
      .map(([, name]) => name),
  ),
].sort((a, b) => a.localeCompare(b));

export const tidyGstin = (value) =>
  String(value ?? "").toUpperCase().replace(/[\s-]/g, "");

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
 * What to show under the box.
 *
 * Three answers, not two. "Nothing typed yet" is not an error: most small
 * retailers are not registered and the field is meant to be left empty. Half
 * a number is not an error either, or the box would go red on the first
 * keystroke and stay red until the last.
 *
 * Returns { state: "empty" | "typing" | "good" | "bad", message, stateName }.
 */
export const gstinFeedback = (value) => {
  const gstin = tidyGstin(value);
  if (!gstin) return { state: "empty" };
  if (gstin.length < 15) {
    return {
      state: "typing",
      message: `${15 - gstin.length} more character${15 - gstin.length === 1 ? "" : "s"}`,
    };
  }
  if (gstin.length > 15) {
    return { state: "bad", message: "That is longer than 15 characters." };
  }
  if (!STRUCTURE.test(gstin)) {
    return {
      state: "bad",
      message: "This does not look like a GST number. It should read like 27AAPFU0939F1ZV.",
    };
  }
  const code = gstin.slice(0, 2);
  const stateName = STATE_NAMES[code] || STATE_NAMES[String(Number(code))];
  if (!stateName) {
    return { state: "bad", message: `${code} is not a state code.` };
  }
  if (checkDigit(gstin.slice(0, 14)) !== gstin[14]) {
    return {
      state: "bad",
      message: "The last character does not match the rest, so something is mistyped.",
    };
  }
  return { state: "good", message: stateName, stateName };
};

export const isValidGstin = (value) => gstinFeedback(value).state === "good";

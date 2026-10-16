/**
 * The same HSN check the server does, done as the person types.
 *
 * An HSN code is the number that says what a thing is on a tax bill. It has
 * to be 4, 6 or 8 digits: nothing else is a code. The server checks again on
 * every save, so this exists only to catch a slipped keystroke while the box
 * is still on screen.
 *
 * See server/src/services/hsnService.js. Nothing here maps a code to a tax
 * rate, on purpose: rates change and the same code carries different rates by
 * price slab, so the rate stays a number the wholesaler sets themselves.
 */

export const tidyHsn = (value) => String(value ?? "").replace(/[\s.-]/g, "");

/**
 * What to show under the box.
 *
 * Blank is not an error. Most of what a small wholesaler sells has never been
 * classified by anybody, and the field is meant to be leavable.
 *
 * Returns { state: "empty" | "typing" | "good" | "bad", message }.
 */
export const hsnFeedback = (value) => {
  const hsn = tidyHsn(value);
  if (!hsn) return { state: "empty" };

  if (!/^\d+$/.test(hsn)) {
    return { state: "bad", message: "An HSN code is digits only." };
  }
  // Between the valid lengths they are still typing, not wrong. Going red at
  // five digits on the way to six would make the box argue with them.
  if (hsn.length < 4) {
    return { state: "typing", message: "4, 6 or 8 digits" };
  }
  if (hsn.length === 5 || hsn.length === 7) {
    return { state: "typing", message: "4, 6 or 8 digits" };
  }
  if (hsn.length > 8) {
    return { state: "bad", message: "An HSN code is at most 8 digits." };
  }
  return { state: "good", message: `${hsn.length} digit code` };
};

export const isValidHsn = (value) => {
  const state = hsnFeedback(value).state;
  return state === "good" || state === "empty";
};

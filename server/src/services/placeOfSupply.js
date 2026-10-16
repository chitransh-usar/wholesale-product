/**
 * Which state is this person in?
 *
 * One question, asked in one place, because the answer decides whether a bill
 * charges CGST plus SGST or IGST, and that is a number on a legal document.
 *
 * It used to be asked three different ways. The invoice service read
 * `warehouse_state || warehouse_city || city || "Delhi"`, the sale invoice
 * service read a slightly different chain, and gstService then guessed a state
 * from whichever of those turned up by looking the city up in a hand written
 * map of about fifty metros. Three chains and a guess, deciding tax.
 *
 * The order below is by how much each source actually knows:
 *
 *   1. what they declared    the state they typed into their own settings, or the
 *                          state on the customer's card. Somebody sat down and
 *                          said this, so it wins.
 *   2. their GST number      the first two digits of a GSTIN ARE the state. This
 *                          is not a guess or a lookup, it is what the number
 *                          means, and it is right even when the address is
 *                          half filled in.
 *   3. their city            the old map, kept as a last resort, because a book
 *                          full of customers entered as "Surat" with no state
 *                          and no GST number should still bill correctly.
 *
 * When nothing answers, the answer is null, and null is not a state. Read
 * `isIntraState` for what that then does, because "we do not know" and "they
 * are in the same state" are not the same fact and the old code treated both
 * as Delhi.
 */
const { gstinState, stateKey, INDIAN_STATES, STATE_NAMES } = require("../utils/gstin");

// Written any way, read back one way. Two people typing "tamil nadu" and
// "Tamil Nadu" are in the same state and a bill must not say otherwise.
const STATE_CANON = Object.fromEntries(
  INDIAN_STATES.map((name) => [stateKey(name), name]),
);

// The last resort. Nothing here is certain: a city name does not carry its
// state, and this only exists because a wholesaler's older customers were
// entered as a city and nothing else. Both the sources above beat it.
//
// Comparing cities directly, which is what happened before this map existed,
// read Mumbai to Pune as inter-state and put IGST on a bill that owed CGST
// and SGST.
const STATE_BY_CITY = {
  delhi: "Delhi",
  "new delhi": "Delhi",
  noida: "Uttar Pradesh",
  ghaziabad: "Uttar Pradesh",
  lucknow: "Uttar Pradesh",
  kanpur: "Uttar Pradesh",
  agra: "Uttar Pradesh",
  varanasi: "Uttar Pradesh",
  meerut: "Uttar Pradesh",
  gurgaon: "Haryana",
  gurugram: "Haryana",
  faridabad: "Haryana",
  panipat: "Haryana",
  mumbai: "Maharashtra",
  pune: "Maharashtra",
  nagpur: "Maharashtra",
  nashik: "Maharashtra",
  thane: "Maharashtra",
  aurangabad: "Maharashtra",
  solapur: "Maharashtra",
  bhiwandi: "Maharashtra",
  ichalkaranji: "Maharashtra",
  bengaluru: "Karnataka",
  bangalore: "Karnataka",
  mysore: "Karnataka",
  mysuru: "Karnataka",
  hubli: "Karnataka",
  belgaum: "Karnataka",
  chennai: "Tamil Nadu",
  coimbatore: "Tamil Nadu",
  madurai: "Tamil Nadu",
  tirupur: "Tamil Nadu",
  erode: "Tamil Nadu",
  salem: "Tamil Nadu",
  karur: "Tamil Nadu",
  hyderabad: "Telangana",
  warangal: "Telangana",
  secunderabad: "Telangana",
  kolkata: "West Bengal",
  howrah: "West Bengal",
  siliguri: "West Bengal",
  ahmedabad: "Gujarat",
  surat: "Gujarat",
  vadodara: "Gujarat",
  rajkot: "Gujarat",
  jamnagar: "Gujarat",
  bhavnagar: "Gujarat",
  gandhinagar: "Gujarat",
  jaipur: "Rajasthan",
  jodhpur: "Rajasthan",
  udaipur: "Rajasthan",
  kota: "Rajasthan",
  bhilwara: "Rajasthan",
  indore: "Madhya Pradesh",
  bhopal: "Madhya Pradesh",
  gwalior: "Madhya Pradesh",
  jabalpur: "Madhya Pradesh",
  patna: "Bihar",
  chandigarh: "Chandigarh",
  ludhiana: "Punjab",
  amritsar: "Punjab",
  jalandhar: "Punjab",
  kochi: "Kerala",
  ernakulam: "Kerala",
  kozhikode: "Kerala",
  thrissur: "Kerala",
  thiruvananthapuram: "Kerala",
  bhubaneswar: "Odisha",
  cuttack: "Odisha",
  guwahati: "Assam",
  raipur: "Chhattisgarh",
  bhilai: "Chhattisgarh",
  ranchi: "Jharkhand",
  jamshedpur: "Jharkhand",
  dehradun: "Uttarakhand",
  haridwar: "Uttarakhand",
  visakhapatnam: "Andhra Pradesh",
  vijayawada: "Andhra Pradesh",
  guntur: "Andhra Pradesh",
  tirupati: "Andhra Pradesh",
  srinagar: "Jammu and Kashmir",
  jammu: "Jammu and Kashmir",
  shimla: "Himachal Pradesh",
  panaji: "Goa",
  puducherry: "Puducherry",
  pondicherry: "Puducherry",
};

/**
 * One place name, read as a state if it can be.
 *
 * Deliberately strict. A value that is neither a state nor a city this map
 * knows comes back null rather than being passed through, because a bill that
 * compares "Kutch" against "Kutch" and calls that a matching state has only
 * got the right answer by luck. Null is honest, and isIntraState knows what
 * to do with it.
 */
const asState = (value) => {
  const key = stateKey(value);
  if (!key) return null;
  return STATE_CANON[key] || STATE_BY_CITY[key] || null;
};

/**
 * The state, and how confident we are in it.
 *
 * Callers that only want the name can use `stateOf`. This one exists so a
 * screen can say WHY it thinks a wholesaler is in Gujarat, which matters when
 * they disagrees with it.
 *
 * @param {object} source
 * @param {string} [source.state] what they declared, warehouse_state or similar
 * @param {string} [source.gstin] their GST number
 * @param {string} [source.city]  their city, the last resort
 * @returns {{ state: string|null, from: "declared"|"gstin"|"city"|null }}
 */
const resolveState = ({ state, gstin, city } = {}) => {
  const declared = asState(state);
  if (declared) return { state: declared, from: "declared" };

  const fromGstin = gstinState(gstin);
  if (fromGstin && fromGstin.name) {
    return { state: fromGstin.name, from: "gstin" };
  }

  const mapped = asState(city);
  if (mapped) return { state: mapped, from: "city" };

  return { state: null, from: null };
};

/** Just the name, or null. */
const stateOf = (source) => resolveState(source).state;

/**
 * Are these two in the same state?
 *
 * Returns true when either side is unknown, and that is a decision rather than
 * an oversight. An unknown state is almost always a customer the wholesaler
 * entered by name and phone alone, which is their local trade, and a local sale
 * is CGST plus SGST. Guessing inter-state instead would put IGST on the bill
 * of the man who walks into the shop.
 *
 * The previous version reached the same answer by pretending both sides were
 * Delhi, which is the right result by the wrong route: it also told a Surat
 * wholesaler with no city set that they were in Delhi, and anything downstream
 * that read the location back believed it.
 */
const isIntraState = (supplier, buyer) => {
  const a = stateOf(supplier);
  const b = stateOf(buyer);
  if (!a || !b) return true;
  return stateKey(a) === stateKey(b);
};

/**
 * The two digit GST state code for a state name, or null.
 *
 * The invoice prints "Haryana (06)", because the code is what a return is
 * filed against and what an accountant reconciles on. Built by turning the
 * GSTIN table around rather than typing a second list, so the two can never
 * disagree.
 *
 * Where a name holds two codes, because a state was split or two union
 * territories merged, the LOWER code wins: 28 rather than 37 for Andhra
 * Pradesh, 25 rather than 26 for Daman and Diu. That is a coin toss on old
 * registrations and it is why the code shown is taken from the customer's own
 * GSTIN when they have one, in preference to this.
 */
const CODE_BY_STATE = (() => {
  const out = {};
  for (const [code, name] of Object.entries(STATE_NAMES)) {
    const n = Number(code);
    if (n < 1 || n > 38) continue;
    const key = stateKey(name);
    const padded = String(code).padStart(2, "0");
    if (!out[key] || padded < out[key]) out[key] = padded;
  }
  return out;
})();

const stateCode = (name) => CODE_BY_STATE[stateKey(name)] || null;

/**
 * The place of supply as it goes on the document: the state, its code, and
 * where the answer came from.
 *
 * The buyer's own GSTIN wins outright when they have one, because its first two
 * digits ARE their state code and no lookup can beat that.
 */
const placeOfSupply = (buyer = {}) => {
  const fromGstin = gstinState(buyer.gstin);
  if (fromGstin && fromGstin.name) {
    return { state: fromGstin.name, code: fromGstin.code, from: "gstin" };
  }
  const resolved = resolveState(buyer);
  return {
    state: resolved.state,
    code: resolved.state ? stateCode(resolved.state) : null,
    from: resolved.from,
  };
};

module.exports = {
  resolveState,
  stateOf,
  asState,
  isIntraState,
  stateCode,
  placeOfSupply,
  STATE_BY_CITY,
};

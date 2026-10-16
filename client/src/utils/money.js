/**
 * Showing an amount and a date, in one place, the way the platform says.
 *
 * There were eighteen copies of a local `money()` helper across the screens and
 * they did not agree. Most rounded to whole rupees, the sale form kept two
 * decimals, the invoice kept two without grouping, which is why the same figure
 * read 12,000 on one screen and 12000.00 on the next. Asked about on 11 Sept.
 *
 * This is where they collapsed to, and it now reads the platform's own
 * settings rather than hard coding a convention, so an admin changing decimals
 * or grouping in the administration area changes the whole product.
 *
 * ---------------------------------------------------------------------------
 * WHY A MODULE LEVEL VALUE AND NOT A HOOK
 * ---------------------------------------------------------------------------
 * `money()` is called from render bodies, from `useMemo`, from sort
 * comparators and from plain helper functions that are not components. A hook
 * cannot be called from most of those. So the settings are pushed in once,
 * when useMasters loads them, and every caller stays an ordinary function.
 *
 * The cost is that the first render after a cold load formats with the shipped
 * defaults. That is deliberately harmless: the defaults ARE the convention the
 * product shipped with, so the worst case is a figure that is briefly correct
 * in the old way rather than briefly wrong.
 */

/**
 * What the product formatted with before the settings table existed. Not a
 * placeholder: a database without the migration must behave exactly as it did,
 * so these are the real shipped values and the server agrees, see
 * masterService.SHIPPED_SETTINGS.
 */
const SHIPPED = {
  amountDecimals: 0,
  documentDecimals: 2,
  digitGrouping: "indian",
  currencySymbol: "₹",
  currencyName: "Rupees",
  currencySubunitName: "Paise",
  taxRateDecimals: 2,
  defaultHsnMinDigits: 4,
  dateFormat: "dd-mmm-yyyy",
};

let active = { ...SHIPPED };

/** Called by useMasters once the platform settings arrive. */
export const applyMoneySettings = (settings) => {
  if (!settings) return;
  // Merged over the shipped values rather than replacing them, so a server
  // that answers with half an object cannot leave a field undefined and turn
  // every amount on every screen into "undefined".
  active = { ...SHIPPED, ...settings };
};

export const moneySettings = () => active;

/**
 * Indian digit grouping means 12,00,000 rather than 1,200,000. A trader reads
 * lakhs and crores by where the commas fall, so western grouping makes them
 * count digits. en-IN does the first, en-US the second.
 */
const locale = () => (active.digitGrouping === "western" ? "en-US" : "en-IN");

/**
 * A plain amount, no symbol.
 *
 * Whole rupees by default, because that is what almost every screen wants and
 * what a trader says out loud. Pass `document: true` where the figure has to
 * foot exactly, such as an invoice line or a tax amount: those carry the
 * platform's document decimals instead.
 */
export const money = (value, { document = false, decimals } = {}) => {
  const places =
    decimals ?? (document ? active.documentDecimals : active.amountDecimals);
  return Number(value || 0).toLocaleString(locale(), {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
};

/**
 * The same figure at DOCUMENT precision, for an invoice line, a tax amount, a
 * statement, anything that has to foot exactly.
 *
 * Exported under its own name rather than as an option so a screen can import
 * it as `money` and every call site in that file reads unchanged. That is what
 * let eighteen local copies be deleted without touching a thousand calls.
 */
export const amount = (value, options = {}) =>
  money(value, { ...options, document: true });

/**
 * Decimals only when there are any: 105 stays 105, 105.5 stays 105.5.
 *
 * For a rate beside an item name, where a trailing .00 on every row is noise
 * but a real half rupee must not be rounded away.
 */
export const trimmed = (value) =>
  Number(value || 0).toLocaleString(locale(), {
    minimumFractionDigits: 0,
    maximumFractionDigits: active.documentDecimals,
  });

/** The same, with the currency symbol in front. */
export const rupees = (value, options) =>
  `${active.currencySymbol}${money(value, options)}`;

/**
 * A tax rate. Kept apart from money decimals the way the settings keep them
 * apart, and for a real reason: 0.25% is a genuine GST slab, so a rate needs
 * two decimals even where an amount needs none. Trailing zeroes are dropped,
 * because "GST 5%" reads better than "GST 5.00%".
 */
export const taxRate = (value) => {
  const n = Number(value || 0);
  const fixed = n.toFixed(active.taxRateDecimals);
  return String(Number(fixed));
};

/**
 * Same paise arithmetic as the server, so a total worked out on screen and the
 * total that gets saved cannot drift apart on an odd rate. Floating point
 * rupees lose a paisa per line and a wholesaler notices a total a rupee off.
 *
 * Not affected by any setting. How a number is DISPLAYED is a convention; how
 * it is ADDED UP is arithmetic.
 */
export const toPaise = (value) => Math.round(Number(value || 0) * 100);

export const fromPaise = (value) => Number((Number(value || 0) / 100).toFixed(2));

/**
 * A date, in the order the platform says.
 *
 * Named formats rather than a pattern language, so an admin cannot type one
 * that throws while a screen is rendering.
 */
export const dateLabel = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  if (active.dateFormat === "yyyy-mm-dd") {
    return date.toLocaleDateString("en-CA");
  }
  if (active.dateFormat === "dd/mm/yyyy") {
    return date.toLocaleDateString("en-GB");
  }
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

/** The short form, for a dense list where the year is obvious from context. */
export const shortDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  if (active.dateFormat === "yyyy-mm-dd") {
    return date.toLocaleDateString("en-CA").slice(5);
  }
  if (active.dateFormat === "dd/mm/yyyy") {
    return date.toLocaleDateString("en-GB").slice(0, 5);
  }
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

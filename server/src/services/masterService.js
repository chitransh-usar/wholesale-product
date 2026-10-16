const pool = require("../config/db");
const { INDIAN_STATES } = require("../utils/gstin");
const { stateCode } = require("./placeOfSupply");

/**
 * The platform's masters: states, units, tax slabs, HSN codes.
 *
 * A master is a thing that EXISTS, as against a transaction, which is a thing
 * that HAPPENS. These four belong to the platform rather than to any one
 * wholesaler, and until `wholesale3_platform_masters.sql` was written each of
 * them was a constant in the code, so correcting one meant a deploy.
 *
 * EVERY READ FALLS BACK TO THE CONSTANT. Migrations in this repository are run
 * by hand, so the code is routinely deployed before its SQL. A screen that
 * cannot list units because a table is missing is a worse outcome than a list
 * that is briefly out of date, and the constants are what the product has been
 * running on all along.
 *
 * WHAT STILL READS THE CONSTANT EVEN AFTER THE MIGRATION, and why:
 *
 *   placeOfSupply and utils/gstin resolve a state name to its GST code, and
 *   they do it SYNCHRONOUSLY, at module load, on the path that decides CGST
 *   plus SGST against IGST. Making that path asynchronous so it could read a
 *   table is a separate change with its own risk, and it is not worth carrying
 *   it on the back of this one. So the state master feeds the dropdowns and
 *   the admin console today; adding a state there does NOT yet change how tax
 *   is computed for it. That is a real limitation and it is written down here
 *   rather than discovered later.
 */

/** Rows change rarely and are read constantly, so they are cached. */
const TTL_MS = 5 * 60 * 1000;

/**
 * A TTL as well as an explicit reset, not one or the other.
 *
 * The reset is for this process: an admin saving a unit clears it and sees their
 * change. The TTL is for every OTHER process, which has no way of being told.
 * Without it, a platform running two instances would serve a stale list from
 * one of them until it restarted.
 */
const cache = new Map();
const cachedAt = new Map();

const resetMasters = () => {
  cache.clear();
  cachedAt.clear();
};

/** Is the migration in? Probed once, like every other schema check here. */
let ready = null;
const mastersExist = async (db = pool) => {
  if (ready !== null) return ready;
  try {
    const probe = await db.query(
      "SELECT to_regclass('public.master_states') IS NOT NULL AS yes",
    );
    ready = Boolean(probe.rows[0]?.yes);
  } catch {
    ready = false;
  }
  return ready;
};
const resetMastersSchema = () => { ready = null; uqcReady = null; termsReady = null; };

/**
 * Is the UQC list in? Its own probe, because master_uqc arrives in a later
 * migration than the other masters. Without this the units query would name a
 * column that is not there yet, fail, and fall back to the built in list,
 * which would lose every unit an admin had added.
 */
let uqcReady = null;
const uqcExists = async (db = pool) => {
  if (uqcReady !== null) return uqcReady;
  try {
    const probe = await db.query(
      "SELECT to_regclass('public.master_uqc') IS NOT NULL AS yes",
    );
    uqcReady = Boolean(probe.rows[0]?.yes);
  } catch {
    uqcReady = false;
  }
  return uqcReady;
};

/**
 * One read, cached, falling back to `whenMissing` if the table is not there or
 * the query fails.
 *
 * A failure falls back rather than throwing on purpose. These lists fill
 * dropdowns on screens that have real work to do; none of them is worth taking
 * a screen down over.
 */
const read = async (key, sql, shape, whenMissing) => {
  const at = cachedAt.get(key);
  if (at && Date.now() - at < TTL_MS) return cache.get(key);

  if (!(await mastersExist())) return whenMissing();

  try {
    const rows = await pool.query(sql);
    const value = rows.rows.map(shape);
    // An empty table is not an answer. It means somebody emptied it or the
    // seed did not run, and serving nothing would empty every dropdown in the
    // product.
    if (value.length === 0) return whenMissing();
    cache.set(key, value);
    cachedAt.set(key, Date.now());
    return value;
  } catch (err) {
    console.error(`Could not read the ${key} master, using the built in list:`, err.message);
    return whenMissing();
  }
};

// ---------------------------------------------------------------------------
// The built in lists. These are what the product ran on before the masters
// existed and they stay as the floor under it.
// ---------------------------------------------------------------------------

const BUILT_IN_UNITS = [
  { code: "pcs", name: "Pieces", allowsDecimals: false },
  { code: "dozen", name: "Dozen", allowsDecimals: false },
  { code: "case", name: "Case", allowsDecimals: false },
  { code: "mtr", name: "Metre", allowsDecimals: true },
  { code: "kg", name: "Kilogram", allowsDecimals: true },
  { code: "box", name: "Box", allowsDecimals: false },
  { code: "bundle", name: "Bundle", allowsDecimals: false },
];

const BUILT_IN_RATES = [0, 0.25, 3, 5, 12, 18, 28].map((rate) => ({
  rate,
  label: rate === 0 ? "Nil" : `GST ${rate}%`,
}));

// null, not false. The constant never recorded which of these are union
// territories, and answering "no" to a question it cannot answer is the kind
// of plausible wrong value this codebase has had to delete before.
const builtInStates = () =>
  INDIAN_STATES.map((name) => ({ code: stateCode(name), name, isUnionTerritory: null }))
    .filter((row) => row.code)
    .sort((a, b) => a.code.localeCompare(b.code));

exports.states = () =>
  read(
    "states",
    `SELECT code, name, is_union_territory FROM master_states
      WHERE active ORDER BY code`,
    (r) => ({ code: r.code, name: r.name, isUnionTerritory: r.is_union_territory }),
    builtInStates,
  );

exports.units = async () => {
  // NULL AS uqc rather than the column itself until the migration is in, so an
  // unmigrated database still lists its units instead of falling back.
  const hasUqc = await uqcExists();
  return read(
    hasUqc ? "unitsWithUqc" : "units",
    `SELECT code, name, allows_decimals, ${hasUqc ? "uqc" : "NULL AS uqc"}
       FROM master_units
      WHERE active ORDER BY sort_order, name`,
    (r) => ({
      code: r.code,
      name: r.name,
      allowsDecimals: r.allows_decimals,
      // Null means nobody has decided yet. It is not the same as OTH, which is
      // a declaration that the unit has no standard code.
      uqc: r.uqc || null,
    }),
    () => BUILT_IN_UNITS,
  );
};

/**
 * Is the tax terms table in? Its own probe, like the UQC one, because it
 * arrives in a later migration than the other masters.
 */
let termsReady = null;
const taxTermsExist = async (db = pool) => {
  if (termsReady !== null) return termsReady;
  try {
    const probe = await db.query(
      "SELECT to_regclass('public.master_tax_terms') IS NOT NULL AS yes",
    );
    termsReady = Boolean(probe.rows[0]?.yes);
  } catch {
    termsReady = false;
  }
  return termsReady;
};

exports.taxTermsExist = taxTermsExist;

/**
 * The named tax combinations a line can be billed under.
 *
 * CGST and SGST are NOT stored. They are half the IGST rate each for a sale
 * inside one state, which is what gstService has always done, and two stored
 * halves are two things that can disagree with the whole. They are derived
 * here so a screen can show the combination without working it out again.
 *
 * Empty until the migration is run, which a screen reads as "this platform has
 * no terms" rather than as an error.
 */
exports.taxTerms = async () => {
  if (!(await taxTermsExist())) return [];
  return read(
    "taxTerms",
    `SELECT code, label, igst_percent, cess_percent FROM master_tax_terms
      WHERE active ORDER BY sort_order, igst_percent`,
    (r) => {
      const igst = Number(r.igst_percent);
      const cgst = Number((igst / 2).toFixed(2));
      return {
        code: r.code,
        label: r.label,
        igstPercent: igst,
        // The remainder, so the two halves always add back to the whole.
        cgstPercent: cgst,
        sgstPercent: Number((igst - cgst).toFixed(2)),
        cessPercent: Number(r.cess_percent),
      };
    },
    () => [],
  );
};

exports.uqcExists = uqcExists;

/**
 * The GST Unique Quantity Codes, for the dropdown on the units screen.
 *
 * A fixed statutory list, not something an admin adds to, so there is no write
 * path for it. Empty until the migration is run, and an empty list means the
 * screen shows the unit's UQC as a plain value rather than offering choices.
 */
exports.uqcCodes = async () => {
  if (!(await uqcExists())) return [];
  return read(
    "uqc",
    "SELECT code, description FROM master_uqc WHERE active ORDER BY code",
    (r) => ({ code: r.code, description: r.description }),
    () => [],
  );
};

exports.taxRates = () =>
  read(
    "taxRates",
    "SELECT rate, label FROM master_tax_rates WHERE active ORDER BY rate",
    (r) => ({ rate: Number(r.rate), label: r.label }),
    () => BUILT_IN_RATES,
  );

/**
 * The curated HSN list.
 *
 * Codes and descriptions, never a rate. Rates change and the same heading
 * carries different rates by price slab, so anything mapping one to the other
 * is inventing a number that ends up on a tax document.
 */
exports.hsn = () =>
  read(
    "hsn",
    "SELECT code, description FROM master_hsn WHERE active ORDER BY code",
    (r) => ({ code: r.code, label: r.description }),
    () => require("./hsnService").TEXTILE_HSN,
  );

/**
 * The platform's formatting conventions.
 *
 * SHIPPED_SETTINGS is the floor, and it is not a placeholder: it is exactly
 * what the product formatted with before this table existed, so a database
 * without the migration behaves as it always has rather than losing its rupee
 * symbol. Same reasoning as the four lists above.
 *
 * Read through the same cache, so a screen asking for settings and a screen
 * asking for units cost one round trip each per five minutes, not one per
 * render.
 */
const SHIPPED_SETTINGS = {
  amountDecimals: 0,
  documentDecimals: 2,
  digitGrouping: "indian",
  currencySymbol: "\u20B9",
  currencyName: "Rupees",
  currencySubunitName: "Paise",
  taxRateDecimals: 2,
  defaultHsnMinDigits: 4,
  dateFormat: "dd-mmm-yyyy",
};

/**
 * Probed separately from the four lists. The settings migration is its own
 * file and can be run without the other, or the other way round, and a
 * wholesaler in that state must still get working dropdowns and working
 * formatting rather than an error from whichever half is missing.
 */
let settingsReady = null;
const settingsExist = async (db = pool) => {
  if (settingsReady !== null) return settingsReady;
  try {
    const probe = await db.query(
      "SELECT to_regclass('public.master_settings') IS NOT NULL AS yes",
    );
    settingsReady = Boolean(probe.rows[0]?.yes);
  } catch {
    settingsReady = false;
  }
  return settingsReady;
};

exports.settings = async () => {
  const at = cachedAt.get("settings");
  if (at && Date.now() - at < TTL_MS) return cache.get("settings");

  if (!(await settingsExist())) return { ...SHIPPED_SETTINGS, fromMasters: false };

  try {
    const { rows } = await pool.query("SELECT * FROM master_settings WHERE id = 1");
    const row = rows[0];
    // The table exists but the single row is gone, which only happens if
    // somebody deleted it. The shipped values are a better answer than nulls
    // reaching a toLocaleString call on every screen.
    if (!row) return { ...SHIPPED_SETTINGS, fromMasters: false };

    const value = {
      amountDecimals: Number(row.amount_decimals),
      documentDecimals: Number(row.document_decimals),
      digitGrouping: row.digit_grouping,
      currencySymbol: row.currency_symbol,
      currencyName: row.currency_name,
      currencySubunitName: row.currency_subunit_name,
      taxRateDecimals: Number(row.tax_rate_decimals),
      defaultHsnMinDigits: Number(row.default_hsn_min_digits),
      dateFormat: row.date_format,
      fromMasters: true,
    };
    cache.set("settings", value);
    cachedAt.set("settings", Date.now());
    return value;
  } catch (err) {
    console.warn("Could not read the administration settings:", err.message);
    return { ...SHIPPED_SETTINGS, fromMasters: false };
  }
};

/**
 * Writes the settings. Every field is optional, so a screen can send only what
 * changed, and anything absent keeps its current value.
 *
 * Validation is here rather than only in the CHECK constraints so a bad value
 * comes back as a sentence rather than as a database error string. The
 * constraints stay as the backstop: this is not the only way in.
 */
const RANGES = {
  amountDecimals: { column: "amount_decimals", min: 0, max: 4 },
  documentDecimals: { column: "document_decimals", min: 0, max: 4 },
  taxRateDecimals: { column: "tax_rate_decimals", min: 0, max: 4 },
};
const CHOICES = {
  digitGrouping: { column: "digit_grouping", of: ["indian", "western"] },
  dateFormat: { column: "date_format", of: ["dd-mmm-yyyy", "dd/mm/yyyy", "yyyy-mm-dd"] },
  defaultHsnMinDigits: { column: "default_hsn_min_digits", of: [4, 6, 8], number: true },
};
const TEXT = {
  currencySymbol: { column: "currency_symbol", max: 8 },
  currencyName: { column: "currency_name", max: 40 },
  currencySubunitName: { column: "currency_subunit_name", max: 40 },
};

exports.saveSettings = async (patch = {}, userId = null) => {
  if (!(await settingsExist())) {
    return { error: "The administration settings table is not in this database yet." };
  }

  const sets = [];
  const values = [];

  for (const [key, spec] of Object.entries(RANGES)) {
    if (patch[key] === undefined) continue;
    const n = Number(patch[key]);
    if (!Number.isInteger(n) || n < spec.min || n > spec.max) {
      return { error: `${key} must be a whole number between ${spec.min} and ${spec.max}.` };
    }
    values.push(n);
    sets.push(`${spec.column} = $${values.length}`);
  }

  for (const [key, spec] of Object.entries(CHOICES)) {
    if (patch[key] === undefined) continue;
    const given = spec.number ? Number(patch[key]) : String(patch[key]);
    if (!spec.of.includes(given)) {
      return { error: `${key} must be one of ${spec.of.join(", ")}.` };
    }
    values.push(given);
    sets.push(`${spec.column} = $${values.length}`);
  }

  for (const [key, spec] of Object.entries(TEXT)) {
    if (patch[key] === undefined) continue;
    const text = String(patch[key]).trim();
    // Blank is refused rather than stored. An empty currency symbol renders
    // every amount on every screen as a bare number.
    if (!text || text.length > spec.max) {
      return { error: `${key} must be between 1 and ${spec.max} characters.` };
    }
    values.push(text);
    sets.push(`${spec.column} = $${values.length}`);
  }

  if (sets.length === 0) return { error: "Nothing to change." };

  values.push(userId);
  sets.push(`updated_by = $${values.length}`);

  await pool.query(
    `UPDATE master_settings SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
    values,
  );

  // This process sees the change at once. Every other one waits out the TTL,
  // which is the same bargain the four lists already make.
  cache.delete("settings");
  cachedAt.delete("settings");
  return { settings: await exports.settings() };
};

exports.settingsExist = settingsExist;
exports.resetSettingsSchema = () => { settingsReady = null; };
exports.SHIPPED_SETTINGS = SHIPPED_SETTINGS;
exports.mastersExist = mastersExist;
exports.resetMasters = resetMasters;
exports.resetMastersSchema = resetMastersSchema;
exports.BUILT_IN_UNITS = BUILT_IN_UNITS;
exports.BUILT_IN_RATES = BUILT_IN_RATES;

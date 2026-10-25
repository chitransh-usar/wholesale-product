/**
 * Where a wholesaler's goods come from, and how a buyer filters by it.
 *
 * Two columns hold a city. `warehouse_city` is where the stock actually sits
 * and is the one that matters to a buyer working out how far their order has to
 * travel; `city` is the older, plainer field a seller filled in when they signed
 * up. The warehouse wins when it is set, because that is the more specific
 * answer, and the older field is the fallback so a seller who never opened the
 * warehouse screen is still findable.
 *
 * Cities are free text. Sellers type "surat", "Surat" and "SURAT ", and no
 * amount of wishing makes those one row. Matching is therefore done on a
 * normalised form: trimmed, inner runs of whitespace collapsed, lowercased.
 *
 * What this deliberately does NOT do is decide that "Delhi", "New Delhi" and
 * "Delhi NCR" are the same place. They may well be, but guessing would put a
 * seller in a city they did not choose, and a buyer filtering to Delhi would be
 * shown stock the system only assumes is nearby. The picker offers exactly the
 * cities sellers have actually typed, so whatever a buyer picks has stock
 * behind it.
 */

// The city a listing ships from, in its original spelling.
// Some databases are older and do not have warehouse_city yet, so build the
// expression at runtime based on the schema rather than assuming every
// migration has been applied.
const citySqlFor = ({ hasWarehouseCity = true, hasLegacyCity = true } = {}) => {
  if (!hasWarehouseCity && !hasLegacyCity) return "NULL";
  if (hasWarehouseCity) {
    return `COALESCE(
      NULLIF(btrim(wp.warehouse_city), ''),
      NULLIF(btrim(wp.city), '')
    )`;
  }
  return `NULLIF(btrim(wp.city), '')`;
};

const cityKeySqlFor = (citySql) => `lower(regexp_replace(btrim(${citySql}), '\\s+', ' ', 'g'))`;

const CITY_SQL = citySqlFor({ hasWarehouseCity: true, hasLegacyCity: true });

// The same, folded so two spellings of one city compare equal.
const CITY_KEY_SQL = cityKeySqlFor(CITY_SQL);

const resolveCitySql = async (dbPool) => {
  const result = await dbPool.query(`
    SELECT
      to_regclass('public.wholesaler_profiles') IS NOT NULL AS profile_exists,
      ARRAY(
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'wholesaler_profiles'
          AND column_name IN ('warehouse_city', 'city')
      ) AS profile_columns
  `);
  const profile = result.rows[0];
  if (!profile?.profile_exists) {
    const error = new Error("Required PostgreSQL relation is missing.");
    error.code = "42P01";
    error.schema = "public";
    error.table = "wholesaler_profiles";
    throw error;
  }

  const columns = new Set(profile.profile_columns || []);
  const hasWarehouseCity = columns.has('warehouse_city');
  const hasLegacyCity = columns.has('city');
  const citySql = citySqlFor({ hasWarehouseCity, hasLegacyCity });

  return {
    citySql,
    cityKeySql: cityKeySqlFor(citySql),
    hasWarehouseCity,
    hasLegacyCity,
  };
};

/**
 * The JS half of CITY_KEY_SQL. These two must agree: a buyer's chosen city
 * arrives as text and is compared against the database's folded column, so a
 * difference here silently returns nothing.
 */
const cityKey = (value) => {
  if (value === undefined || value === null) return "";
  return String(value).trim().replace(/\s+/g, " ").toLowerCase();
};

/**
 * Reads the city filter off a request.
 *
 * An absent city, an empty one, or the explicit "all" means no filter at all,
 * which is the right default: a buyer who has not chosen should see the whole
 * country rather than one city picked for them.
 */
const cityFilterFrom = (query = {}) => {
  const key = cityKey(query.city);
  if (!key || key === "all" || key === "all india") return null;
  return key;
};

module.exports = {
  CITY_SQL,
  CITY_KEY_SQL,
  citySqlFor,
  cityKeySqlFor,
  resolveCitySql,
  cityKey,
  cityFilterFrom,
};

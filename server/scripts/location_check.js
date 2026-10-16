/**
 * Does the location picker actually narrow the shop?
 *
 * It used to be decoration: a hardcoded list of ten big cities, a piece of
 * local state, and nothing downstream of it. A buyer who picked Surat saw the
 * same catalogue they saw before, which is worse than having no picker, because
 * they believes they are looking at Surat.
 *
 * The parts that have to hold:
 *   - filtering removes listings, not products, so a filtered card cannot
 *     quote a price or a seller count from another city
 *   - the two spellings a seller might type ("surat", "Surat ") are one city
 *   - the warehouse address wins over the signup city, and the signup city is
 *     the fallback rather than nothing
 *   - the city menu offers only places that actually have stock
 *   - no filter still means the whole country
 *
 *     node scripts/location_check.js <database>
 */
const Module = require("module");
const { Pool } = require("pg");

const DB = process.argv[2] || "qa_location";
const dbPath = require.resolve("../src/config/db");
const testPool = new Pool({ connectionString: `postgres://postgres@127.0.0.1:5433/${DB}` });
const stub = new Module(dbPath, null);
stub.exports = testPool; stub.loaded = true;
require.cache[dbPath] = stub;

const products = require("../src/controllers/productController");
const { cityKey, cityFilterFrom } = require("../src/services/sellerLocation");

const mk = () => { const r = { statusCode: 200, body: null };
  r.status = c => (r.statusCode = c, r); r.json = b => (r.body = b, r); return r; };
const call = async (fn, req) => { const r = mk(); await fn(req, r); return r; };
let fails = 0;
const check = (cond, label, v) => { if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"} ${String(label).padEnd(52)} ${JSON.stringify(v)}`); };
const q = (sql, args) => testPool.query(sql, args);

const stamp = Date.now();
let seq = 0;

const seller = async (firm, profile) => {
  const id = (await q(
    `INSERT INTO users (first_name,last_name,email,role,phone,password_hash)
     VALUES ($1,'Seller',$2,'seller',$3,'x') RETURNING id`,
    [firm, `loc${stamp}${seq}@x.local`, `90000002${String(seq++).padStart(2, "0")}`],
  )).rows[0].id;
  if (profile) {
    await q(
      `INSERT INTO wholesaler_profiles (user_id, company_name, city, warehouse_city)
       VALUES ($1,$2,$3,$4)`,
      [id, firm, profile.city ?? null, profile.warehouseCity ?? null],
    );
  }
  return id;
};

(async () => {
  console.log(`\n=== location filter, ${DB} ===`);

  // --- the folding rule, before any database is involved -------------------
  check(cityKey("  Surat ") === "surat", "spaces and case fold away", { k: cityKey("  Surat ") });
  check(cityKey("Delhi   NCR") === "delhi ncr", "inner runs of space collapse", { k: cityKey("Delhi   NCR") });
  check(cityKey(null) === "", "a missing city folds to nothing", {});
  check(cityFilterFrom({}) === null, "no city means no filter", {});
  check(cityFilterFrom({ city: "" }) === null, "an empty city means no filter", {});
  check(cityFilterFrom({ city: "All" }) === null, "'All' means no filter", {});
  check(cityFilterFrom({ city: " SURAT" }) === "surat", "a real city folds to its key", {});

  // --- four sellers, one product, three cities -----------------------------
  // suratA and suratB spell their city differently on purpose.
  const suratA = await seller(`Surat Silk ${stamp}`, { city: "Surat" });
  const suratB = await seller(`Surat Cotton ${stamp}`, { city: "  surat " });
  // Signed up from Mumbai, ships from Surat. The warehouse is the truth.
  const movedIn = await seller(`Moved In ${stamp}`, { city: "Mumbai", warehouseCity: "Surat" });
  const ludhiana = await seller(`Ludhiana Mills ${stamp}`, { city: "Ludhiana" });
  // No profile row at all. They must not vanish, and must not be a city.
  const bare = await seller(`No Profile ${stamp}`, null);

  const prodName = `Grey shirting ${stamp}`;
  const prod = (await q(
    `INSERT INTO products (name, category) VALUES ($1,'Fabric') RETURNING id`, [prodName],
  )).rows[0].id;

  const prices = { [suratA]: 100, [suratB]: 110, [movedIn]: 120, [ludhiana]: 80, [bare]: 90 };
  for (const supplier of [suratA, suratB, movedIn, ludhiana, bare]) {
    await q(
      `INSERT INTO supplier_inventory (supplier_id, product_id, price, moq, stock, status, visibility, shipping_days)
       VALUES ($1,$2,$3,5,0,'Active','public',4)`, [supplier, prod, prices[supplier]],
    );
  }

  const findRow = (body) => (body || []).find((r) => r.name === prodName);

  // --- unfiltered ----------------------------------------------------------
  const all = await call(products.getPublicCatalog, { query: {} });
  const allRow = findRow(all.body);
  check(all.statusCode === 200, "catalogue loads with no filter", { s: all.statusCode });
  check(Number(allRow?.total_suppliers) === 5,
    "all five sellers show when nothing is picked", { n: allRow?.total_suppliers });
  check(Number(allRow?.starting_price) === 80,
    "the cheapest price is the cheapest anywhere", { p: allRow?.starting_price });

  // --- filtered to Surat ---------------------------------------------------
  const surat = await call(products.getPublicCatalog, { query: { city: "Surat" } });
  const suratRow = findRow(surat.body);
  check(Number(suratRow?.total_suppliers) === 3,
    "Surat shows three: two spellings and one warehouse", { n: suratRow?.total_suppliers });

  const suratIds = (suratRow?.suppliers || []).map((s) => String(s.supplierId));
  check(suratIds.includes(String(suratB)),
    "the seller who typed '  surat ' is included", { suratIds });
  check(suratIds.includes(String(movedIn)),
    "the warehouse beats the signup city", { suratIds });
  check(!suratIds.includes(String(ludhiana)),
    "Ludhiana is not shown to a Surat buyer", { suratIds });
  check(!suratIds.includes(String(bare)),
    "a seller with no city is not silently counted as Surat", { suratIds });

  check(Number(suratRow?.starting_price) === 100,
    "the price shown is the cheapest in Surat, not in India", { p: suratRow?.starting_price });
  check((suratRow?.suppliers || []).every((s) => cityKey(s.city) === "surat"),
    "every seller on the card really is in Surat",
    { cities: (suratRow?.suppliers || []).map((s) => s.city) });

  // A different spelling of the same city has to reach the same sellers.
  const shouted = await call(products.getPublicCatalog, { query: { city: "  SURAT " } });
  check(Number(findRow(shouted.body)?.total_suppliers) === 3,
    "'  SURAT ' finds the same three", { n: findRow(shouted.body)?.total_suppliers });

  // --- a city with nobody in it -------------------------------------------
  const empty = await call(products.getPublicCatalog, { query: { city: "Kanpur" } });
  check(empty.statusCode === 200, "an empty city is not an error", { s: empty.statusCode });
  check(!findRow(empty.body), "and it returns no products", { n: (empty.body || []).length });

  // --- the menu ------------------------------------------------------------
  const cities = await call(products.getCatalogCities, { query: {} });
  check(cities.statusCode === 200, "the city menu loads", { s: cities.statusCode });
  const byKey = Object.fromEntries((cities.body || []).map((c) => [c.key, c]));
  check(!!byKey.surat, "Surat is offered", { keys: Object.keys(byKey) });
  check(byKey.surat?.sellers === 3, "Surat counts three sellers", { n: byKey.surat?.sellers });
  check(byKey.surat?.city === "Surat",
    "the menu shows the commonest spelling, not the folded one", { c: byKey.surat?.city });
  check(!!byKey.ludhiana, "Ludhiana is offered", {});
  check(byKey.ludhiana?.sellers === 1, "Ludhiana counts one", { n: byKey.ludhiana?.sellers });
  check(!byKey[""] && !byKey.null,
    "the seller with no city does not become a blank entry", { keys: Object.keys(byKey) });
  // Every city on the menu must return something, or the menu is lying.
  const offered = (cities.body || []).map((c) => c.key);
  let allProductive = true;
  for (const key of offered) {
    const res = await call(products.getPublicCatalog, { query: { city: key } });
    if (!Array.isArray(res.body) || res.body.length === 0) allProductive = false;
  }
  check(allProductive, "every city offered has stock behind it", { n: offered.length });

  // --- a private listing must not leak through the filter ------------------
  const hidden = await seller(`Hidden Surat ${stamp}`, { city: "Surat" });
  await q(
    `INSERT INTO supplier_inventory (supplier_id, product_id, price, moq, stock, status, visibility, shipping_days)
     VALUES ($1,$2,5,5,0,'Active','private',4)`, [hidden, prod],
  );
  const afterHidden = await call(products.getPublicCatalog, { query: { city: "Surat" } });
  const hiddenIds = (findRow(afterHidden.body)?.suppliers || []).map((s) => String(s.supplierId));
  check(!hiddenIds.includes(String(hidden)),
    "a private listing stays private when a city is picked", { hiddenIds });
  check(Number(findRow(afterHidden.body)?.starting_price) === 100,
    "and its price does not become the headline", { p: findRow(afterHidden.body)?.starting_price });
  const citiesAfter = await call(products.getCatalogCities, { query: {} });
  const suratAfter = (citiesAfter.body || []).find((c) => c.key === "surat");
  check(suratAfter?.sellers === 3,
    "nor does it inflate the city menu's count", { n: suratAfter?.sellers });

  // --- the product page agrees with the filter about where a seller is -----
  const one = await call(products.getProductById, { params: { id: prod } });
  const movedRow = (one.body?.suppliers || []).find((s) => String(s.supplierId) === String(movedIn));
  check(cityKey(movedRow?.city) === "surat",
    "the product page places them where the filter does", { c: movedRow?.city });

  console.log(fails ? `\n${fails} FAILED\n` : "\nall good\n");
  await testPool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("THREW", e); process.exit(1); });

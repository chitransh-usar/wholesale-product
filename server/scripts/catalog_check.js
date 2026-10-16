/**
 * Can a wholesaler who has not filled in their business details sell anything?
 *
 * The catalogue used to inner join wholesaler_profiles, so a seller who had
 * signed up but not completed their profile had every listing vanish from
 * search, from the product page and from the shop page. No error and no empty
 * state: the products simply were not there, and they had no way to find out
 * why. A new seller's first hour is exactly when that row is least likely to
 * exist.
 *
 *     node scripts/catalog_check.js <database>
 */
const Module = require("module");
const { Pool } = require("pg");

const DB = process.argv[2] || "ledger2";
const dbPath = require.resolve("../src/config/db");
const testPool = new Pool({ connectionString: `postgres://postgres@127.0.0.1:5433/${DB}` });
const stub = new Module(dbPath, null);
stub.exports = testPool; stub.loaded = true;
require.cache[dbPath] = stub;

const products = require("../src/controllers/productController");

const mk = () => { const r = { statusCode: 200, body: null };
  r.status = c => (r.statusCode = c, r); r.json = b => (r.body = b, r); return r; };
const call = async (fn, req) => { const r = mk(); await fn(req, r); return r; };
let fails = 0;
const check = (cond, label, v) => { if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"} ${String(label).padEnd(46)} ${JSON.stringify(v)}`); };
const q = (sql, args) => testPool.query(sql, args);

const stamp = Date.now();
let seq = 0;

(async () => {
  console.log(`\n=== catalogue, ${DB} ===`);

  // Two sellers listing the same product. One has filled in their business
  // details, the other signed up an hour ago and has not.
  const named = (await q(
    `INSERT INTO users (first_name,last_name,email,role,phone,password_hash)
     VALUES ('Ram','Textiles',$1,'seller','9000000101','x') RETURNING id`,
    [`named${stamp}${seq++}@x.local`],
  )).rows[0].id;
  await q(`INSERT INTO wholesaler_profiles (user_id, company_name, city, is_verified)
           VALUES ($1,'Ram Textiles','Surat',true)`, [named]);

  const bare = (await q(
    `INSERT INTO users (first_name,last_name,email,role,phone,password_hash)
     VALUES ('Suresh','Patel',$1,'seller','9000000102','x') RETURNING id`,
    [`bare${stamp}${seq++}@x.local`],
  )).rows[0].id;

  const prodName = `Khadi cotton ${stamp}`;
  const prod = (await q(
    `INSERT INTO products (name, category) VALUES ($1,'Fabric') RETURNING id`, [prodName],
  )).rows[0].id;
  for (const supplier of [named, bare]) {
    await q(
      `INSERT INTO supplier_inventory (supplier_id, product_id, price, moq, stock, status, visibility, shipping_days)
       VALUES ($1,$2,120,5,0,'Active','public',4)`, [supplier, prod],
    );
  }

  const findRow = (body) => (body || []).find((r) => r.name === prodName);

  const cat = await call(products.getPublicCatalog, { query: {} });
  const row = findRow(cat.body);
  check(cat.statusCode === 200, "catalogue loads", { s: cat.statusCode });
  check(!!row, "the product appears in the catalogue", {});
  check(Number(row?.total_suppliers) === 2,
    "both sellers are listed, profile or not", { n: row?.total_suppliers });

  const names = (row?.suppliers || []).map((s) => s.companyName).sort();
  check(names.includes("Ram Textiles"), "the named firm shows its firm name", { names });
  check(names.includes("Suresh Patel"),
    "the seller with no profile shows their own name", { names });
  check(!names.some((n) => n === null || n === undefined || n === ""),
    "nobody is listed with a blank name", { names });

  const one = await call(products.getProductById, { params: { id: prod } });
  check(one.statusCode === 200, "product page loads", { s: one.statusCode });
  check((one.body?.suppliers || []).length === 2,
    "product page shows both sellers", { n: (one.body?.suppliers || []).length });
  const bareRow = (one.body?.suppliers || []).find((s) => String(s.supplierId) === String(bare));
  check(bareRow?.verified === false,
    "a seller with no profile is not shown as verified", { v: bareRow?.verified });
  check(bareRow?.contactPhone === "9000000102",
    "their own phone stands in for the missing business phone", { p: bareRow?.contactPhone });

  const contact = await call(products.contactSupplier, {
    params: { id: prod },
    query: { supplierId: bare },
    body: {},
    user: { id: named, role: "buyer" },
  });
  check(contact.statusCode !== 404,
    "a buyer can reach a seller who has no profile", { s: contact.statusCode });

  console.log(fails ? `\n${fails} FAILED\n` : "\nall good\n");
  await testPool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("THREW", e); process.exit(1); });

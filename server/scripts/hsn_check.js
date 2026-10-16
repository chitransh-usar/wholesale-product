/**
 * HSN codes: the shape, and the suggestions.
 *
 * An HSN code says what the goods ARE on a tax bill, and it is what the
 * customer claims their input credit against. Three things are checked here,
 * and they are deliberately the only three the product does:
 *
 *   the shape       4, 6 or 8 digits, refused otherwise
 *   their own history the codes this wholesaler has already put on their goods
 *   a short list    common textile headings, offered and labelled as such
 *
 * The last group is a starting point, not an authority, and the checks below
 * assert that it is labelled that way. Nothing here maps a code to a tax rate
 * and there is a check that nothing does, because rates change and the same
 * heading carries different rates by price slab.
 *
 *     node scripts/hsn_check.js <database>
 */
const Module = require("module");
const { Pool } = require("pg");

const DB = process.argv[2] || "qa_hsn";
const dbPath = require.resolve("../src/config/db");
const testPool = new Pool({ connectionString: `postgres://postgres@127.0.0.1:5433/${DB}` });
const stub = new Module(dbPath, null);
stub.exports = testPool;
stub.loaded = true;
require.cache[dbPath] = stub;

const hsn = require("../src/services/hsnService");
const hsnController = require("../src/controllers/hsnController");
const products = require("../src/controllers/productController");
const parties = require("../src/controllers/partyController");
const sales = require("../src/controllers/saleController");

const mk = () => {
  const r = { statusCode: 200, body: null };
  r.status = (c) => ((r.statusCode = c), r);
  r.json = (b) => ((r.body = b), r);
  return r;
};
const call = async (fn, req) => {
  const r = mk();
  await fn(req, r);
  return r;
};

let fails = 0;
const check = (cond, label, detail) => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"} ${String(label).padEnd(52)} ${JSON.stringify(detail ?? {})}`);
};

const uniq = () => String(Date.now()) + Math.floor(Math.random() * 1000);

(async () => {
  console.log(`\n=== HSN codes against ${DB} ===\n`);

  // ---------------------------------------------------------------
  console.log("The shape of a code");
  // ---------------------------------------------------------------
  check(hsn.checkHsn("5208").ok, "four digits is a code");
  check(hsn.checkHsn("520812").ok, "six digits is a code");
  check(hsn.checkHsn("52081210").ok, "eight digits is a code");
  check(!hsn.checkHsn("520").ok, "three is not", { why: hsn.checkHsn("520").reason });
  check(!hsn.checkHsn("52081").ok, "five is not");
  check(!hsn.checkHsn("520812101").ok, "nine is not");
  check(!hsn.checkHsn("52O8").ok, "a letter is not a digit", {
    note: "a capital O typed for a zero",
  });
  check(hsn.checkHsn("").ok && hsn.checkHsn("").hsn === null, "blank is fine and stays blank", {
    why: "most of what a small wholesaler sells was never classified",
  });
  check(hsn.checkHsn(null).ok, "so is nothing at all");
  check(hsn.checkHsn(" 5208 ").hsn === "5208", "spaces are trimmed off");
  check(hsn.checkHsn("5208.12").hsn === "520812", "dots are how people write it");

  // ---------------------------------------------------------------
  console.log("\nThe curated list");
  // ---------------------------------------------------------------
  check(hsn.TEXTILE_HSN.length > 20, "a short list, not an encyclopaedia", {
    rows: hsn.TEXTILE_HSN.length,
  });
  check(
    hsn.TEXTILE_HSN.every((row) => hsn.checkHsn(row.code).ok),
    "every code on it is a well formed code",
  );
  check(
    hsn.TEXTILE_HSN.every((row) => row.code.length === 4),
    "all four digits, because that is the level they can pick by reading it",
  );
  check(
    new Set(hsn.TEXTILE_HSN.map((r) => r.code)).size === hsn.TEXTILE_HSN.length,
    "no code listed twice",
  );
  check(
    hsn.TEXTILE_HSN.every((row) => !("rate" in row) && !("gst" in row)),
    "and not one of them carries a tax rate",
    { why: "a rate presented as authoritative puts a wrong tax on a bill" },
  );

  // ---------------------------------------------------------------
  console.log("\nSuggestions for a wholesaler with no history");
  // ---------------------------------------------------------------
  const u = await testPool.query(
    `INSERT INTO users (first_name,last_name,email,phone,password_hash,role)
     VALUES ('Ram','Textiles',$1,$2,'x','seller') RETURNING id`,
    [`ram+${uniq()}@hsn.local`, `9${uniq().slice(-9)}`],
  );
  const sellerId = u.rows[0].id;
  await testPool.query(
    `INSERT INTO wholesaler_profiles (user_id, company_name, warehouse_state)
     VALUES ($1, 'Ram Textiles', 'Gujarat')`,
    [sellerId],
  );
  const asOwner = { user: { id: sellerId }, business: { id: sellerId, owner: true } };

  const fresh = await hsn.suggest(testPool, sellerId, "");
  check(fresh.length > 0, "they still gets something to start from", { got: fresh.length });
  check(
    fresh.every((row) => row.from === "common"),
    "and it is all marked common, none of it their",
  );

  const byWord = await hsn.suggest(testPool, sellerId, "shawl");
  check(
    byWord.some((row) => row.code === "6214"),
    "typing a word finds the heading",
    { got: byWord.map((r) => r.code) },
  );
  const byDigits = await hsn.suggest(testPool, sellerId, "62");
  check(
    byDigits.length > 0 && byDigits.every((row) => row.code.startsWith("62")),
    "typing digits narrows to that chapter",
    { got: byDigits.map((r) => r.code) },
  );

  // ---------------------------------------------------------------
  console.log("\nOnce they have used some");
  // ---------------------------------------------------------------
  const listed = await call(products.addProduct, {
    ...asOwner,
    body: {
      name: `Cotton shirting ${uniq()}`,
      category: "Fabric",
      price: 142,
      moq: 1,
      stock: 100,
      shippingDays: 2,
      unit: "mtr",
      hsnCode: "5208",
      gstPercent: 5,
    },
  });
  check(listed.statusCode === 201, "they lists a product with an HSN", {
    s: listed.statusCode,
    m: listed.body?.message,
  });

  const badListing = await call(products.addProduct, {
    ...asOwner,
    body: {
      name: `Mistyped ${uniq()}`,
      category: "Fabric",
      price: 100,
      moq: 1,
      stock: 1,
      shippingDays: 1,
      hsnCode: "52081",
    },
  });
  check(badListing.statusCode === 400, "a five digit code is refused on a listing", {
    s: badListing.statusCode,
    m: badListing.body?.message,
  });

  const party = await call(parties.createParty, {
    ...asOwner,
    body: { name: "Kishan Cloth House", city: "Surat", phone: `98${uniq().slice(-8)}` },
  });
  const sale = await call(sales.createSale, {
    ...asOwner,
    body: {
      partyId: party.body.id,
      status: "confirmed",
      lines: [
        { itemName: "Dupatta", quantity: 12, unit: "pcs", rate: 90, hsnCode: "6214" },
        { itemName: "Dupatta lot two", quantity: 6, unit: "pcs", rate: 90, hsnCode: "6214" },
      ],
    },
  });
  check(sale.statusCode === 201, "and records a sale carrying another", {
    s: sale.statusCode,
    m: sale.body?.message,
  });

  const badSale = await call(sales.createSale, {
    ...asOwner,
    body: {
      partyId: party.body.id,
      status: "confirmed",
      lines: [{ itemName: "Slipped key", quantity: 1, rate: 10, hsnCode: "520" }],
    },
  });
  check(badSale.statusCode === 400, "a bad code on a sale line is refused too", {
    s: badSale.statusCode,
    m: badSale.body?.message,
  });
  check(
    String(badSale.body?.message || "").includes("Slipped key"),
    "and the message names the line it is on",
    { m: badSale.body?.message },
  );

  const mine = await hsn.suggest(testPool, sellerId, "");
  check(mine[0]?.from === "yours", "now their own codes come first", {
    top: mine.slice(0, 3).map((r) => `${r.code}:${r.from}`),
  });
  check(
    mine[0]?.code === "6214",
    "commonest first, so the one they used twice leads",
    { top: mine[0] },
  );
  check(mine[0]?.times === 2, "and it says how many times", { times: mine[0]?.times });
  check(
    mine.some((row) => row.code === "5208" && row.from === "yours"),
    "their listing's code is in there as their, not as common",
  );
  check(
    mine.some((row) => row.from === "common"),
    "with the curated list still behind them",
  );
  check(
    new Set(mine.map((r) => r.code)).size === mine.length,
    "and 6214 is not offered twice, once as their and once as common",
  );

  // ---------------------------------------------------------------
  console.log("\nThrough the endpoint");
  // ---------------------------------------------------------------
  const served = await call(hsnController.suggestHsn, { ...asOwner, query: { q: "62" } });
  check(served.statusCode === 200 && Array.isArray(served.body), "the endpoint answers", {
    n: served.body?.length,
  });

  const otherId = (
    await testPool.query(
      `INSERT INTO users (first_name,last_name,email,phone,password_hash,role)
       VALUES ('Other','Seller',$1,$2,'x','seller') RETURNING id`,
      [`other+${uniq()}@hsn.local`, `8${uniq().slice(-9)}`],
    )
  ).rows[0].id;
  const theirs = await hsn.suggest(testPool, otherId, "");
  check(
    theirs.every((row) => row.from === "common"),
    "another wholesaler sees none of their codes",
    { leak: theirs.filter((r) => r.from === "yours").map((r) => r.code) },
  );

  console.log(`\n${fails === 0 ? "all good" : `${fails} FAILED`}\n`);
  await testPool.end();
  process.exit(fails === 0 ? 0 : 1);
})().catch((err) => {
  console.error("THREW", err);
  process.exit(1);
});

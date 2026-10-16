/**
 * What was already owed before this product.
 *
 * Taken from Busy's Account master, which carries Op. Bal on every party. It is
 * the thing that stops a real wholesaler moving onto this: their customer book
 * opened at zero on day one, so the only number they cares about was wrong, and
 * their choices were entering a fake sale for the old balance or not using it.
 *
 * What has to hold:
 *   - it reaches the balance, the customer list, and the overview totals, all
 *     three, because a figure that is in one and not another is the exact
 *     disagreement khataBalance exists to prevent
 *   - a NEGATIVE opening is money the wholesaler is holding, and lands in the
 *     "owed by you" column rather than reducing what they are owed by others
 *   - a figure with no date is refused, because a statement cannot start from
 *     nowhere
 *   - it is per wholesaler, like everything else in the book
 *
 *     node scripts/opening_balance_check.js <database>
 */
const Module = require("module");
const { Pool } = require("pg");

const DB = process.argv[2] || "ob1";
const dbPath = require.resolve("../src/config/db");
const testPool = new Pool({ connectionString: `postgres://postgres@127.0.0.1:5433/${DB}` });
const stub = new Module(dbPath, null);
stub.exports = testPool;
stub.loaded = true;
require.cache[dbPath] = stub;

const parties = require("../src/controllers/partyController");
const sales = require("../src/controllers/saleController");
const overview = require("../src/controllers/overviewController");
const suppliers = require("../src/controllers/supplierController");
const khata = require("../src/services/khataBalance");
const partyService = require("../src/services/partyService");
const saleService = require("../src/services/orderSaleService");

const mk = () => {
  const r = { statusCode: 200, body: null };
  r.status = (c) => ((r.statusCode = c), r);
  r.json = (b) => ((r.body = b), r);
  return r;
};
const call = async (fn, req) => { const r = mk(); await fn(req, r); return r; };

let fails = 0;
const check = (cond, label, v) => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"} ${String(label).padEnd(58)} ${JSON.stringify(v ?? "")}`);
};
const money = (n) => Number(Number(n || 0).toFixed(2));
const uniq = () => String(Date.now()) + Math.floor(Math.random() * 1000);

(async () => {
  console.log(`\n=== opening balances, against ${DB} ===\n`);
  partyService.resetPartyLink();
  saleService.resetSaleLink();
  khata.resetOpeningBalance();

  const mkSeller = async (tag) => {
    const id = (await testPool.query(
      `INSERT INTO users (first_name,last_name,email,phone,password_hash,role)
       VALUES ('Ram','T',$1,$2,'x','seller') RETURNING id`,
      [`${tag}${uniq()}@ob.local`, `9${uniq().slice(-9)}`])).rows[0].id;
    await testPool.query(
      `INSERT INTO wholesaler_profiles (user_id, company_name, warehouse_state, city)
       VALUES ($1,'Ram Textiles','Gujarat','Surat')`, [id]);
    return {
      user: { id, role: "seller" },
      business: { id, isOwner: true, staffId: null, name: null, permissions: [] },
    };
  };

  const asSeller = await mkSeller("ram");
  const asOther = await mkSeller("other");

  check(await khata.hasOpeningBalance(testPool),
    "this database carries the opening balance column", {});

  // ---------------------------------------------------------------
  console.log("-- entering one --");

  const noDate = await call(parties.createParty, {
    ...asSeller, body: { name: "Kishan Cloth House", openingBalance: 200000 },
  });
  check(noDate.statusCode === 400,
    "a figure with no date is refused", { got: noDate.statusCode, msg: noDate.body?.message });

  const notANumber = await call(parties.createParty, {
    ...asSeller, body: { name: "Bad", openingBalance: "two lakh", openingBalanceOn: "2026-04-01" },
  });
  check(notANumber.statusCode === 400, "so is a figure that is not a number", { got: notANumber.statusCode });

  const badDate = await call(parties.createParty, {
    ...asSeller, body: { name: "Bad2", openingBalance: 100, openingBalanceOn: "the first of April" },
  });
  check(badDate.statusCode === 400, "and a date that is not a date", { got: badDate.statusCode });

  const tooBig = await call(parties.createParty, {
    ...asSeller, body: { name: "Bad3", openingBalance: 99999999999, openingBalanceOn: "2026-04-01" },
  });
  check(tooBig.statusCode === 400,
    "and one too large for the column, with a sentence not a database error",
    { got: tooBig.statusCode, msg: tooBig.body?.message });

  const owing = await call(parties.createParty, {
    ...asSeller,
    body: { name: "Kishan Cloth House", openingBalance: 200000, openingBalanceOn: "2026-04-01" },
  });
  check(owing.statusCode === 201, "a customer who already owed 2 lakh is added", { got: owing.statusCode });
  const kishan = owing.body.id;

  // Negative: the wholesaler is holding THEIR money.
  const credit = await call(parties.createParty, {
    ...asSeller,
    body: { name: "Sanskriti", openingBalance: -50000, openingBalanceOn: "2026-04-01" },
  });
  check(credit.statusCode === 201, "and one whose money they are holding", { got: credit.statusCode });
  const sanskriti = credit.body.id;

  // No opening at all is the ordinary case and stays zero.
  const plain = await call(parties.createParty, { ...asSeller, body: { name: "New Shop" } });
  check(plain.statusCode === 201 && money(plain.body.opening_balance) === 0,
    "a new customer opens at zero, as before", { got: plain.body?.opening_balance });

  // ---------------------------------------------------------------
  console.log("\n-- it reaches the balance --");

  const one = await call(parties.getPartyById, { ...asSeller, params: { id: kishan } });
  check(money(one.body?.party?.outstanding) === 200000,
    "the customer page shows the 2 lakh", { got: one.body?.party?.outstanding });

  const listed = await call(parties.listParties, { ...asSeller, query: {} });
  const row = (listed.body || []).find((r) => r.id === kishan);
  check(money(row?.outstanding) === 200000,
    "and so does the customer list, from the same rule", { got: row?.outstanding });

  // A sale on top of it adds, it does not replace.
  const sold = await call(sales.createSale, {
    ...asSeller,
    body: {
      partyId: kishan,
      lines: [{ itemName: "Cotton", quantity: 10, rate: 1000, gstPercent: 0 }],
    },
  });
  check(sold.statusCode === 201, "a sale is recorded against them", { got: sold.statusCode });

  const after = await call(parties.getPartyById, { ...asSeller, params: { id: kishan } });
  check(money(after.body?.party?.outstanding) === 210000,
    "and the old balance is added to, not replaced", { got: after.body?.party?.outstanding });

  // Paying it off clears the whole thing, opening included.
  await call(parties.recordPayment, {
    ...asSeller, params: { id: kishan }, body: { amount: 210000, method: "cash" },
  });
  const settled = await call(parties.getPartyById, { ...asSeller, params: { id: kishan } });
  check(money(settled.body?.party?.outstanding) === 0,
    "paying the lot settles the opening balance too", { got: settled.body?.party?.outstanding });

  // ---------------------------------------------------------------
  console.log("\n-- and the overview agrees with the list --");

  const stats = await call(parties.getPartyStats, { ...asSeller, query: {} });
  check(money(stats.body?.outstanding) === 0,
    "nothing is owed to them once Kishan has paid", { got: stats.body?.outstanding });
  check(money(stats.body?.owedBack) === 50000,
    "and Sanskriti's 50,000 is money they owe THEIR, reported separately",
    { got: stats.body?.owedBack });

  const home = await call(overview.getOverview, { ...asSeller, query: {} });
  check(money(home.body?.money?.outstanding) === money(stats.body?.outstanding),
    "the overview and the customer stats report the same figure",
    { overview: home.body?.money?.outstanding, stats: stats.body?.outstanding });

  // The netting trap: a credit must not hide somebody else's debt.
  await call(parties.createParty, {
    ...asSeller, body: { name: "Ramesh", openingBalance: 80000, openingBalanceOn: "2026-04-01" },
  });
  const both = await call(parties.getPartyStats, { ...asSeller, query: {} });
  check(money(both.body?.outstanding) === 80000 && money(both.body?.owedBack) === 50000,
    "one customer's credit does not cancel another's debt",
    { outstanding: both.body?.outstanding, owedBack: both.body?.owedBack });

  // ---------------------------------------------------------------
  console.log("\n-- editing, and scope --");

  const changed = await call(parties.updateParty, {
    ...asSeller, params: { id: sanskriti },
    body: { openingBalance: -60000, openingBalanceOn: "2026-04-01" },
  });
  check(changed.statusCode === 200, "an opening balance can be corrected", { got: changed.statusCode });
  const reread = await call(parties.getPartyById, { ...asSeller, params: { id: sanskriti } });
  check(money(reread.body?.party?.outstanding) === -60000,
    "and the balance follows it", { got: reread.body?.party?.outstanding });

  const notMine = await call(parties.updateParty, {
    ...asOther, params: { id: kishan }, body: { openingBalance: 1, openingBalanceOn: "2026-04-01" },
  });
  check(notMine.statusCode === 404,
    "another wholesaler cannot set it on somebody else's customer", { got: notMine.statusCode });

  const theirStats = await call(parties.getPartyStats, { ...asOther, query: {} });
  check(money(theirStats.body?.outstanding) === 0 && money(theirStats.body?.owedBack) === 0,
    "and none of it shows in their book", theirStats.body);

  // ---------------------------------------------------------------
  console.log("\n-- the supplier side, the same way round --");

  const mill = await call(suppliers.createSupplier, {
    ...asSeller,
    body: { name: "Arvind Mills", phone: `88${uniq().slice(-8)}`,
            openingBalance: 120000, openingBalanceOn: "2026-04-01" },
  });
  check(mill.statusCode === 201, "a supplier they already owed is added", { got: mill.statusCode, msg: mill.body?.message });

  const millRead = await call(suppliers.getSupplierById, { ...asSeller, params: { id: mill.body.id } });
  check(money(millRead.body?.supplier?.balance) === 120000,
    "and the balance says they owe the mill 1,20,000", { got: millRead.body?.supplier?.balance });

  const payables = await call(suppliers.getSupplierStats, { ...asSeller, query: {} });
  check(money(payables.body?.owedByYou) === 120000,
    "which reaches the purchase totals", { got: payables.body?.owedByYou });

  console.log(fails ? `\n${fails} FAILED\n` : "\nall good\n");
  await testPool.end();
  process.exit(fails ? 1 : 0);
})().catch((err) => { console.error("THREW", err); process.exit(1); });

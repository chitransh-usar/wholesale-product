/**
 * The customer's own state, and the tax that follows from it.
 *
 * placeOfSupply asks three things in order: the state somebody declared, the
 * state their GST number carries, then their city. For a khata customer the first
 * of those could not be answered at all, because parties had no state column
 * and every caller passed { gstin, city }. So the strongest source was
 * missing for half of every bill.
 *
 * Who that was wrong for: a customer in another state with no GST
 * registration, in a town that is not one of the ninety in STATE_BY_CITY. They
 * resolved to null, null is read as the same state, and their bill charged CGST
 * plus SGST when it owed IGST. There was no way to correct it, because
 * nothing anywhere asked which state they were in.
 *
 * What has to hold:
 *   - a declared state reaches the bill and puts IGST on it
 *   - it beats the city map, which is the whole point of the order
 *   - a state nobody recognises is refused, not stored as typed, because a
 *     misspelling would resolve to null later and quietly bill as local
 *   - leaving it empty still bills as local, exactly as before
 *   - before the migration, typing one is refused loudly, and NOT typing one
 *     leaves every other edit working
 *
 *     node scripts/party_state_check.js <migrated-db> <unmigrated-db>
 */
const Module = require("module");
const { Pool } = require("pg");

const DB = process.argv[2] || "st2";
const OLD_DB = process.argv[3] || "st1";
const dbPath = require.resolve("../src/config/db");
const testPool = new Pool({ connectionString: `postgres://postgres@127.0.0.1:5433/${DB}` });
const stub = new Module(dbPath, null);
stub.exports = testPool;
stub.loaded = true;
require.cache[dbPath] = stub;

const parties = require("../src/controllers/partyController");
const sales = require("../src/controllers/saleController");
const invoiceRepository = require("../src/repositories/invoiceRepository");

const mk = () => {
  const r = { statusCode: 200, body: null };
  r.status = (c) => ((r.statusCode = c), r);
  r.json = (b) => ((r.body = b), r);
  return r;
};
const call = async (fn, req) => { const r = mk(); await fn(req, r); return r; };

let fails = 0;
const check = (cond, label, detail) => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"} ${String(label).padEnd(56)} ${JSON.stringify(detail ?? {})}`);
};

const GUJARAT_GSTIN = "24AAACC1206D1ZM";
const MAHARASHTRA_GSTIN = "27AAPFU0939F1ZV";
const uniq = () => String(Date.now()) + Math.floor(Math.random() * 1000);

const seedSeller = async (pool) => {
  const id = (await pool.query(
    `INSERT INTO users (first_name,last_name,email,phone,password_hash,role)
     VALUES ('Ram','T',$1,$2,'x','seller') RETURNING id`,
    [`ram${uniq()}@st.local`, `9${uniq().slice(-9)}`])).rows[0].id;
  await pool.query(
    `INSERT INTO wholesaler_profiles (user_id, company_name, warehouse_state, city, gstin)
     VALUES ($1,'Ram Textiles','Gujarat','Surat',$2)`, [id, GUJARAT_GSTIN]);
  return {
    user: { id, role: "seller" },
    business: { id, isOwner: true, staffId: null, name: null, permissions: [] },
  };
};

(async () => {
  console.log(`\n=== customer state, against ${DB} ===\n`);
  const asSeller = await seedSeller(testPool);

  check((await invoiceRepository.schemaExtras()).has_party_state,
    "this database carries the state column", {});

  // ---------------------------------------------------------------
  console.log("-- what may be stored --");

  const good = await call(parties.createParty, {
    ...asSeller,
    body: { name: "Bansal Traders", city: "Raipur", state: "Chhattisgarh",
            phone: `98${uniq().slice(-8)}` },
  });
  check(good.statusCode === 201 && good.body.state === "Chhattisgarh",
    "a state is stored", { got: good.body?.state, code: good.statusCode });

  const scruffy = await call(parties.createParty, {
    ...asSeller,
    body: { name: "Lower Case", state: "  tamil nadu ", phone: `97${uniq().slice(-8)}` },
  });
  check(scruffy.statusCode === 201 && scruffy.body.state === "Tamil Nadu",
    "written any way, read back one way", { got: scruffy.body?.state });

  const asCity = await call(parties.createParty, {
    ...asSeller,
    body: { name: "By City", state: "Indore", phone: `96${uniq().slice(-8)}` },
  });
  check(asCity.statusCode === 201 && asCity.body.state === "Madhya Pradesh",
    "a city is accepted and resolved to its state", { got: asCity.body?.state });

  const nonsense = await call(parties.createParty, {
    ...asSeller,
    body: { name: "Nowhere", state: "Gotham", phone: `95${uniq().slice(-8)}` },
  });
  check(nonsense.statusCode === 400,
    "a state nobody recognises is refused, not stored as typed",
    { got: nonsense.statusCode, msg: nonsense.body?.message });

  const empty = await call(parties.createParty, {
    ...asSeller,
    body: { name: "Not Told", state: "", phone: `94${uniq().slice(-8)}` },
  });
  check(empty.statusCode === 201 && !empty.body.state,
    "empty means not told, and stays empty", { got: empty.body?.state });

  // ---------------------------------------------------------------
  console.log("\n-- and the tax that follows --");

  const saleFor = async (partyId) => {
    const s = await call(sales.createSale, {
      ...asSeller,
      body: {
        partyId, status: "confirmed",
        lines: [{ itemName: "Cotton shirting", quantity: 10, unit: "mtr", rate: 100, gstPercent: 5 }],
        amountPaid: 1050, paymentMethod: "cash",
      },
    });
    const bill = await call(sales.createInvoiceForSale, { ...asSeller, params: { id: s.body.id } });
    return bill.body;
  };

  // THE CASE THIS WAS BUILT FOR. Raipur is not in STATE_BY_CITY and this
  // customer has no GSTIN, so before the state column they resolved to null and
  // was billed CGST plus SGST by a Gujarat seller. They owe IGST.
  const awayBill = await saleFor(good.body.id);
  check(Number(awayBill.igst) > 0 && Number(awayBill.cgst) === 0,
    "an out of state customer with no GST number is billed IGST",
    { cgst: awayBill.cgst, sgst: awayBill.sgst, igst: awayBill.igst });

  const untoldBill = await saleFor(empty.body.id);
  check(Number(untoldBill.cgst) > 0 && Number(untoldBill.igst) === 0,
    "a customer who was not asked is still billed as local",
    { cgst: untoldBill.cgst, igst: untoldBill.igst });

  check(Number(awayBill.grand_total) === Number(untoldBill.grand_total),
    "and both owe the same, because 5 per cent is 5 per cent either way",
    { away: awayBill.grand_total, local: untoldBill.grand_total });

  // Same state as the seller, declared. Proves the column is read rather
  // than merely written: Gujarat against Gujarat must NOT become IGST.
  const sameState = await call(parties.createParty, {
    ...asSeller,
    body: { name: "Local Declared", state: "Gujarat", phone: `93${uniq().slice(-8)}` },
  });
  const sameBill = await saleFor(sameState.body.id);
  check(Number(sameBill.cgst) > 0 && Number(sameBill.igst) === 0,
    "a customer who declared the seller's own state is billed local",
    { cgst: sameBill.cgst, igst: sameBill.igst });

  // The declared state beats the city map. Ludhiana maps to Punjab, so
  // without the column this would be IGST; they say they are in Gujarat.
  const contradicts = await call(parties.createParty, {
    ...asSeller,
    body: { name: "Moved Shop", city: "Ludhiana", state: "Gujarat",
            phone: `92${uniq().slice(-8)}` },
  });
  const movedBill = await saleFor(contradicts.body.id);
  check(Number(movedBill.cgst) > 0 && Number(movedBill.igst) === 0,
    "the declared state beats the city it disagrees with",
    { cgst: movedBill.cgst, igst: movedBill.igst });

  // A GSTIN on its own still decides, as it always did.
  const byGstin = await call(parties.createParty, {
    ...asSeller,
    body: { name: "Registered Away", gstin: MAHARASHTRA_GSTIN,
            phone: `91${uniq().slice(-8)}` },
  });
  const gstinBill = await saleFor(byGstin.body.id);
  check(Number(gstinBill.igst) > 0 && Number(gstinBill.cgst) === 0,
    "a GST number with no declared state still decides, as before",
    { cgst: gstinBill.cgst, igst: gstinBill.igst });

  // ---------------------------------------------------------------
  console.log("\n-- editing --");

  const edited = await call(parties.updateParty, {
    ...asSeller, params: { id: empty.body.id },
    body: { state: "Kerala" },
  });
  check(edited.statusCode === 200,
    "a state can be filled in later", { got: edited.statusCode });
  const editedBill = await saleFor(empty.body.id);
  check(Number(editedBill.igst) > 0,
    "and the next bill follows it", { igst: editedBill.igst });

  const wiped = await call(parties.updateParty, {
    ...asSeller, params: { id: empty.body.id }, body: { state: "" },
  });
  const reread = await call(parties.getPartyById, { ...asSeller, params: { id: empty.body.id } });
  check(wiped.statusCode === 200 && !reread.body?.party?.state,
    "and it can be cleared back to not told", { got: reread.body?.party?.state });

  await testPool.end();

  // ---------------------------------------------------------------
  // A database where the migration has NOT been run. Loaded in a child
  // process because the schema probe and the pool are both cached per
  // process, and this has to be the real first look at a different database.
  // ---------------------------------------------------------------
  console.log("\n-- before the migration is run --");
  const { execFileSync } = require("child_process");
  try {
    const out = execFileSync(process.execPath,
      [require.resolve("./party_state_premigration.js"), OLD_DB],
      { encoding: "utf8" });
    process.stdout.write(out.replace(/^/gm, ""));
    if (/FAIL/.test(out)) fails += (out.match(/FAIL/g) || []).length;
  } catch (err) {
    console.log("  FAIL the unmigrated check threw", err.message);
    fails++;
  }

  console.log(fails ? `\n${fails} FAILED\n` : "\nall good\n");
  process.exit(fails ? 1 : 0);
})().catch((err) => { console.error("THREW", err); process.exit(1); });

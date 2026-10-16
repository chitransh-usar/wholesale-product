/**
 * Which state is each side in, and does the right tax come out?
 *
 * This is the one field on the whole product that a person could be fined
 * over. Same state as the customer means the bill charges CGST plus SGST;
 * a different state means IGST. Charge the wrong one and the customer cannot
 * claim their input credit and the wholesaler has filed a wrong return.
 *
 * It used to be decided by comparing two city names with a fallback of
 * "Delhi" on both sides, so a Surat wholesaler with a half filled profile was
 * billed as though they sat in Delhi, and nothing anywhere asked them for their
 * state. Every check below is about that.
 *
 *     node scripts/place_check.js <database>
 */
const Module = require("module");
const { Pool } = require("pg");

const DB = process.argv[2] || "qa_place";
const dbPath = require.resolve("../src/config/db");
const testPool = new Pool({ connectionString: `postgres://postgres@127.0.0.1:5433/${DB}` });
const stub = new Module(dbPath, null);
stub.exports = testPool;
stub.loaded = true;
require.cache[dbPath] = stub;

const place = require("../src/services/placeOfSupply");
const gstService = require("../src/services/gstService");
const auth = require("../src/controllers/authController");
const profile = require("../src/controllers/profileController");
const parties = require("../src/controllers/partyController");
const sales = require("../src/controllers/saleController");
const { INDIAN_STATES } = require("../src/utils/gstin");

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

// Two real GSTINs by arithmetic, one Gujarat (24) and one Maharashtra (27).
// Well formed, belonging to nobody, which is all this needs: the first two
// digits are the state and that is the only part being read.
const GUJARAT_GSTIN = "24AAACC1206D1ZM";
const MAHARASHTRA_GSTIN = "27AAPFU0939F1ZV";

const uniq = () => String(Date.now()) + Math.floor(Math.random() * 1000);

(async () => {
  console.log(`\n=== place of supply against ${DB} ===\n`);

  // ---------------------------------------------------------------
  console.log("The list a person picks from");
  // ---------------------------------------------------------------
  check(INDIAN_STATES.length === 37, "37 states and union territories", {
    got: INDIAN_STATES.length,
  });
  check(!INDIAN_STATES.includes("Centre"), "no UN bodies in the dropdown");
  check(!INDIAN_STATES.includes("Other Territory"), "no offshore area either");
  check(
    INDIAN_STATES.filter((n) => n === "Andhra Pradesh").length === 1,
    "a split state is listed once, not twice",
  );
  check(INDIAN_STATES[0] < INDIAN_STATES[1], "sorted, so it can be read");

  // ---------------------------------------------------------------
  console.log("\nResolving one side");
  // ---------------------------------------------------------------
  check(
    place.resolveState({ state: "Gujarat" }).from === "declared",
    "what they declared wins",
  );
  check(
    place.resolveState({ gstin: GUJARAT_GSTIN }).state === "Gujarat",
    "a GST number gives the state with no address at all",
  );
  check(
    place.resolveState({ city: "Surat" }).state === "Gujarat",
    "a city is the last resort, and still works",
  );
  check(
    place.resolveState({ state: "Karnataka", gstin: GUJARAT_GSTIN }).state === "Karnataka",
    "a declared state beats the GST number",
    { note: "they may despatch from another state" },
  );
  check(
    place.resolveState({ gstin: GUJARAT_GSTIN, city: "Mumbai" }).state === "Gujarat",
    "a GST number beats a city",
  );
  check(place.resolveState({}).state === null, "nothing given is null, not Delhi");
  check(
    place.resolveState({ city: "Nowhereville" }).state === null,
    "an unknown city is null, not itself",
  );
  check(
    place.resolveState({ state: "tamil nadu" }).state === "Tamil Nadu",
    "case and spacing folded to one spelling",
  );
  check(
    place.resolveState({ state: "  TAMIL   NADU " }).state === "Tamil Nadu",
    "extra spaces too",
  );

  // ---------------------------------------------------------------
  console.log("\nSame state or not");
  // ---------------------------------------------------------------
  check(
    place.isIntraState({ city: "Mumbai" }, { city: "Pune" }),
    "Mumbai to Pune is one state",
    { was: "IGST, because the two city names differ" },
  );
  check(
    !place.isIntraState({ city: "Surat" }, { city: "Mumbai" }),
    "Surat to Mumbai is two states",
  );
  check(
    !place.isIntraState({ gstin: GUJARAT_GSTIN }, { gstin: MAHARASHTRA_GSTIN }),
    "two GST numbers settle it on their own",
  );
  check(
    place.isIntraState({ gstin: GUJARAT_GSTIN }, { city: "Rajkot" }),
    "their number against their city",
  );
  check(
    place.isIntraState({}, { city: "Mumbai" }),
    "unknown reads as same state, so a local sale is CGST plus SGST",
  );

  // ---------------------------------------------------------------
  console.log("\nThe tax that comes out");
  // ---------------------------------------------------------------
  const line = [{ quantity: 10, unitPrice: 100, gstPercent: 5 }];
  const inter = gstService.calculateGST({
    items: line,
    supplierLocation: { gstin: GUJARAT_GSTIN },
    buyerLocation: { city: "Mumbai" },
  });
  check(
    inter.igst === 50 && inter.cgst === 0 && inter.sgst === 0,
    "different states put the whole 50 on IGST",
    { cgst: inter.cgst, sgst: inter.sgst, igst: inter.igst },
  );
  check(
    inter.supplierState === "Gujarat" && inter.buyerState === "Maharashtra",
    "and the result says which states it used",
    { from: inter.placeOfSupplyFrom },
  );

  const intra = gstService.calculateGST({
    items: line,
    supplierLocation: "Surat",
    buyerLocation: "Rajkot",
  });
  check(
    intra.cgst === 25 && intra.sgst === 25 && intra.igst === 0,
    "same state splits it 25 and 25",
    { cgst: intra.cgst, sgst: intra.sgst },
  );

  const unknown = gstService.calculateGST({ items: line });
  check(
    unknown.cgst === 25 && unknown.igst === 0,
    "told nothing, it charges the local tax",
  );
  check(
    unknown.supplierState === null,
    "but does not claim to know where anybody is",
    { was: "Delhi, asserted on both sides" },
  );

  // ---------------------------------------------------------------
  console.log("\nSigning up as a wholesaler");
  // ---------------------------------------------------------------
  const email = `ram+${uniq()}@place.local`;
  const signup = await call(auth.register, {
    body: {
      firstName: "Ram",
      lastName: "Textiles",
      email,
      phone: `9${uniq().slice(-9)}`,
      password: "hunter2hunter2",
      role: "seller",
      state: "Gujarat",
    },
  });
  check(signup.statusCode === 201, "a seller can sign up", { s: signup.statusCode });

  const made = await testPool.query(
    `SELECT wp.warehouse_state, wp.city, u.id
       FROM wholesaler_profiles wp JOIN users u ON u.id = wp.user_id
      WHERE u.email = $1`,
    [email],
  );
  const sellerId = made.rows[0]?.id;
  check(
    made.rows[0]?.warehouse_state === "Gujarat",
    "their state is stored from the signup form",
    { got: made.rows[0]?.warehouse_state },
  );
  check(
    made.rows[0]?.city === null,
    "and their city is blank rather than Delhi",
    { got: made.rows[0]?.city, was: "Delhi, from a column default nobody chose" },
  );

  const typo = await call(auth.register, {
    body: {
      firstName: "Mis",
      lastName: "Typed",
      email: `mis+${uniq()}@place.local`,
      phone: `9${uniq().slice(-9)}`,
      password: "hunter2hunter2",
      role: "seller",
      state: "Gujrat",
    },
  });
  const typoRow = await testPool.query(
    "SELECT warehouse_state FROM wholesaler_profiles ORDER BY created_at DESC LIMIT 1",
  );
  check(
    typo.statusCode === 201 && typoRow.rows[0].warehouse_state === null,
    "a misspelt state is stored as blank, not as itself",
    { got: typoRow.rows[0].warehouse_state },
  );

  // ---------------------------------------------------------------
  console.log("\nChanging it later, in settings");
  // ---------------------------------------------------------------
  const asOwner = { user: { id: sellerId }, business: { id: sellerId, owner: true } };

  const bad = await call(profile.updateProfile, {
    ...asOwner,
    body: { warehouseState: "Gujrat" },
  });
  check(bad.statusCode === 400, "a state that is not a state is refused", {
    s: bad.statusCode,
    m: bad.body?.message,
  });

  const lower = await call(profile.updateProfile, {
    ...asOwner,
    body: { warehouseState: "maharashtra" },
  });
  check(
    lower.statusCode === 200 && lower.body.profile.warehouse_state === "Maharashtra",
    "a good one is stored in the one spelling everything compares",
    { got: lower.body?.profile?.warehouse_state },
  );

  const cleared = await call(profile.updateProfile, {
    ...asOwner,
    body: { warehouseState: "" },
  });
  check(
    cleared.statusCode === 200 && !cleared.body.profile.warehouse_state,
    "and they can clear it again",
  );

  // ---------------------------------------------------------------
  console.log("\nA whole bill, end to end");
  // ---------------------------------------------------------------
  await testPool.query(
    `UPDATE wholesaler_profiles
        SET warehouse_state = 'Gujarat', gstin = $2, company_name = 'Ram Textiles'
      WHERE user_id = $1`,
    [sellerId, GUJARAT_GSTIN],
  );

  const local = await call(parties.createParty, {
    ...asOwner,
    body: { name: "Kishan Cloth House", city: "Surat", phone: `98${uniq().slice(-8)}` },
  });
  const away = await call(parties.createParty, {
    ...asOwner,
    body: {
      name: "Bansal Traders",
      city: "Mumbai",
      gstin: MAHARASHTRA_GSTIN,
      phone: `97${uniq().slice(-8)}`,
    },
  });
  check(
    local.statusCode === 201 && away.statusCode === 201,
    "two customers, one nearby and one out of state",
  );

  // Paid in full at the point of sale. This suite is about which tax comes
  // out, not about when a bill may be raised, and since 10 Sept an unpaid
  // sale gets a delivery challan rather than an invoice. Settling it keeps
  // the subject of the test the subject of the test.
  const saleFor = async (partyId) => {
    const s = await call(sales.createSale, {
      ...asOwner,
      body: {
        partyId,
        status: "confirmed",
        lines: [{ itemName: "Cotton shirting", quantity: 10, unit: "mtr", rate: 100, gstPercent: 5 }],
        amountPaid: 1050,
        paymentMethod: "cash",
      },
    });
    const bill = await call(sales.createInvoiceForSale, { ...asOwner, params: { id: s.body.id } });
    return bill.body;
  };

  const localBill = await saleFor(local.body.id);
  check(
    Number(localBill.cgst) > 0 && Number(localBill.igst) === 0,
    "the Surat customer's bill charges CGST and SGST",
    { cgst: localBill.cgst, sgst: localBill.sgst, igst: localBill.igst },
  );

  const awayBill = await saleFor(away.body.id);
  check(
    Number(awayBill.igst) > 0 && Number(awayBill.cgst) === 0,
    "the Mumbai customer's bill charges IGST",
    { cgst: awayBill.cgst, igst: awayBill.igst },
  );
  check(
    Number(awayBill.grand_total) === Number(localBill.grand_total),
    "and both owe the same, because it is the same 5 per cent either way",
    { local: localBill.grand_total, away: awayBill.grand_total },
  );

  // The case that matters most in practice: a customer entered with nothing
  // but a name and a phone number, which is most of a wholesaler's book.
  const bare = await call(parties.createParty, {
    ...asOwner,
    body: { name: "Walk in", phone: `96${uniq().slice(-8)}` },
  });
  const bareBill = await saleFor(bare.body.id);
  check(
    Number(bareBill.cgst) > 0 && Number(bareBill.igst) === 0,
    "a customer with no city and no GST number is billed as local",
    { cgst: bareBill.cgst, igst: bareBill.igst },
  );

  console.log(`\n${fails === 0 ? "all good" : `${fails} FAILED`}\n`);
  await testPool.end();
  process.exit(fails === 0 ? 0 : 1);
})().catch((err) => {
  console.error("THREW", err);
  process.exit(1);
});

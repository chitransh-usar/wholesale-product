/**
 * Is the GST number check actually wired into the screens that save one?
 *
 * gstin_check.js proves the arithmetic. This proves the arithmetic is
 * reached: a validator nobody calls is decoration.
 *
 *     node scripts/gstin_wiring_check.js <database>
 */
const Module = require("module");
const { Pool } = require("pg");

const DB = process.argv[2] || "qa_gstin";
const dbPath = require.resolve("../src/config/db");
const testPool = new Pool({ connectionString: `postgres://postgres@127.0.0.1:5433/${DB}` });
const stub = new Module(dbPath, null);
stub.exports = testPool;
stub.loaded = true;
require.cache[dbPath] = stub;

const parties = require("../src/controllers/partyController");
const profile = require("../src/controllers/profileController");
const products = require("../src/controllers/productController");

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
  console.log(`  ${cond ? "PASS" : "FAIL"} ${String(label).padEnd(52)} ${JSON.stringify(v ?? "")}`);
};
const q = (sql, args) => testPool.query(sql, args);

const stamp = Date.now();
let seq = 0;
const mkUser = async (role, phone) =>
  (await q(
    `INSERT INTO users (first_name,last_name,email,role,phone,password_hash)
     VALUES ('Ram','T',$1,$2,$3,'x') RETURNING id`,
    [`${role}${stamp}${seq++}@x.local`, role, phone],
  )).rows[0].id;

const GOOD = "24AAACC1206D1ZM";
const BAD = "24AAACC1206D1ZZ"; // one character off, so the check digit fails

(async () => {
  console.log(`\n=== GST number wiring, ${DB} ===`);
  const wid = await mkUser("seller", "9000000001");
  const user = { id: wid, role: "seller" };

  // ---- the customer book ------------------------------------------------
  const bad = await call(parties.createParty, {
    user, body: { name: "Kishan Cloth House", gstin: BAD },
  });
  check(bad.statusCode === 400, "a mistyped customer GST number is refused", { s: bad.statusCode });
  check(/mistyped|check it/i.test(bad.body?.message || ""), "and it says what to do", bad.body?.message);

  const good = await call(parties.createParty, {
    user, body: { name: "Kishan Cloth House", gstin: " 24aacc " + "" },
  });
  check(good.statusCode === 400, "a half typed one is refused too", { s: good.statusCode });

  const ok = await call(parties.createParty, {
    user, body: { name: "Kishan Cloth House", phone: "9820011223", gstin: `  ${GOOD.toLowerCase()}  ` },
  });
  check(ok.statusCode === 201, "a real one is accepted", { s: ok.statusCode });
  check(ok.body?.gstin === GOOD, "and stored tidied up", ok.body?.gstin);

  const blank = await call(parties.createParty, {
    user, body: { name: "Roadside stall", phone: "9820011999" },
  });
  check(blank.statusCode === 201, "a customer with no GST number is still fine", { s: blank.statusCode });

  const edited = await call(parties.updateParty, {
    user, params: { id: ok.body.id }, body: { gstin: BAD },
  });
  check(edited.statusCode === 400, "editing to a mistyped one is refused", { s: edited.statusCode });
  const unchanged = (await q("SELECT gstin FROM parties WHERE id=$1", [ok.body.id])).rows[0].gstin;
  check(unchanged === GOOD, "and the good one is left alone", unchanged);

  const cleared = await call(parties.updateParty, {
    user, params: { id: ok.body.id }, body: { gstin: "" },
  });
  check(cleared.statusCode === 200, "clearing it is allowed", { s: cleared.statusCode });
  check(
    (await q("SELECT gstin FROM parties WHERE id=$1", [ok.body.id])).rows[0].gstin === null,
    "and it really is cleared", {},
  );

  // ---- their own profile --------------------------------------------------
  await q(
    `INSERT INTO wholesaler_profiles (user_id, company_name, city) VALUES ($1,'Ram Textiles','Surat')`,
    [wid],
  );
  const badProfile = await call(profile.updateProfile, { user, body: { gstin: BAD } });
  check(badProfile.statusCode === 400, "their own mistyped GST number is refused", { s: badProfile.statusCode });

  const goodProfile = await call(profile.updateProfile, { user, body: { gstin: GOOD.toLowerCase() } });
  check(goodProfile.statusCode === 200, "their real one is accepted", { s: goodProfile.statusCode });
  check(
    (await q("SELECT gstin FROM wholesaler_profiles WHERE user_id=$1", [wid])).rows[0].gstin === GOOD,
    "and stored tidied up", {},
  );

  // ---- what a buyer is told ---------------------------------------------
  const seen = await call(products.getWholesalerById, { params: { id: wid }, query: {} });
  check(seen.body?.gstVerified === true, "a buyer sees them as GST registered", seen.body?.gstVerified);

  // The badge must not appear for junk written before the check existed.
  await q("UPDATE wholesaler_profiles SET gstin = 'NOT A NUMBER' WHERE user_id = $1", [wid]);
  const junk = await call(products.getWholesalerById, { params: { id: wid }, query: {} });
  check(junk.body?.gstVerified === false, "junk written earlier earns no badge", junk.body?.gstVerified);

  console.log(fails === 0 ? "\nall good\n" : `\n${fails} failure(s)\n`);
  process.exitCode = fails === 0 ? 0 : 1;
  await testPool.end();
})();

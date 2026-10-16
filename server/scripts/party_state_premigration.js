/**
 * The same code against a database where wholesale3_party_state.sql has not
 * been run. Split into its own process because the schema probe caches its
 * answer for the life of the process, so this has to be a first look.
 *
 * The point is the difference between the two refusals:
 *   - typing a state must fail loudly, because a wholesaler told it saved
 *     when it was not gets the wrong tax on the next bill and no sign of why
 *   - NOT typing one must change nothing, because the edit form sends every
 *     field including the empty ones, and refusing those would make every
 *     customer uneditable to protect a value that is not there
 *
 *     node scripts/party_state_premigration.js <unmigrated-db>
 */
const Module = require("module");
const { Pool } = require("pg");

const DB = process.argv[2] || "st1";
const dbPath = require.resolve("../src/config/db");
const testPool = new Pool({ connectionString: `postgres://postgres@127.0.0.1:5433/${DB}` });
const stub = new Module(dbPath, null);
stub.exports = testPool;
stub.loaded = true;
require.cache[dbPath] = stub;

const parties = require("../src/controllers/partyController");
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
const uniq = () => String(Date.now()) + Math.floor(Math.random() * 1000);

(async () => {
  const id = (await testPool.query(
    `INSERT INTO users (first_name,last_name,email,phone,password_hash,role)
     VALUES ('Old','T',$1,$2,'x','seller') RETURNING id`,
    [`old${uniq()}@st.local`, `9${uniq().slice(-9)}`])).rows[0].id;
  await testPool.query(
    `INSERT INTO wholesaler_profiles (user_id, company_name, warehouse_state, city)
     VALUES ($1,'Old Textiles','Gujarat','Surat')`, [id]);
  const asSeller = {
    user: { id, role: "seller" },
    business: { id, isOwner: true, staffId: null, name: null, permissions: [] },
  };

  check(!(await invoiceRepository.schemaExtras()).has_party_state,
    "this database does NOT carry the state column", {});

  const typed = await call(parties.createParty, {
    ...asSeller,
    body: { name: "Wants A State", state: "Kerala", phone: `88${uniq().slice(-8)}` },
  });
  check(typed.statusCode === 503 && typed.body?.code === "PARTY_STATE_NOT_SET_UP",
    "typing a state is refused loudly, not dropped",
    { got: typed.statusCode, code: typed.body?.code });

  const plain = await call(parties.createParty, {
    ...asSeller,
    body: { name: "Ordinary", city: "Surat", phone: `87${uniq().slice(-8)}` },
  });
  check(plain.statusCode === 201,
    "a customer with no state is added exactly as before", { got: plain.statusCode });

  // The regression this guards: the edit form sends every field, empty ones
  // included. An empty state must not make the customer uneditable.
  const editedEmpty = await call(parties.updateParty, {
    ...asSeller, params: { id: plain.body.id },
    body: { name: "Ordinary", city: "Rajkot", state: "", phone: plain.body.phone },
  });
  check(editedEmpty.statusCode === 200 && editedEmpty.body?.city === "Rajkot",
    "and editing them with an empty state still works",
    { got: editedEmpty.statusCode, city: editedEmpty.body?.city });

  const editedTyped = await call(parties.updateParty, {
    ...asSeller, params: { id: plain.body.id }, body: { state: "Kerala" },
  });
  check(editedTyped.statusCode === 503,
    "while editing them WITH one is refused", { got: editedTyped.statusCode });

  await testPool.end();
  process.exit(fails ? 1 : 0);
})().catch((err) => { console.error("THREW", err); process.exit(1); });

/**
 * Does a marketplace order land in the wholesaler's customer book?
 *
 * Drives the real createOrder against a real database, the pattern from
 * CLAUDE.md. The cases that matter are the ones where the same person can end
 * up in the book twice.
 *
 *   node scripts/phase2_check.js phase2      customer book present
 *   node scripts/phase2_check.js realish     book missing, must still work
 */
const Module = require("module");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const DB = process.argv[2] || "phase2";
const dbPath = require.resolve("../src/config/db");
const testPool = new Pool({ connectionString: `postgres://postgres@127.0.0.1:5433/${DB}` });
const stub = new Module(dbPath, null);
stub.exports = testPool; stub.loaded = true;
require.cache[dbPath] = stub;

const orders = require("../src/controllers/orderController");
const partyService = require("../src/services/partyService");

const mk = () => { const r = { statusCode: 200, body: null };
  r.status = c => (r.statusCode = c, r); r.json = b => (r.body = b, r); return r; };
const call = async (fn, req) => { const r = mk(); await fn(req, r); return r; };
let fails = 0;
const check = (cond, label, v) => { if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"} ${String(label).padEnd(40)} ${JSON.stringify(v)}`); };

const q = (sql, args) => testPool.query(sql, args);
const stamp = Date.now();
// password_hash is NOT NULL on the real users table. Not a real hash: this
// account is never logged into, only ordered as.
const mkUser = async (role, phone) => (await q(
  `INSERT INTO users (first_name,last_name,email,role,phone,password_hash)
   VALUES ($1,'T',$2,$3,$4,'x') RETURNING id`,
  [role === "seller" ? "Ram" : "Kishan", `${role}+${stamp}+${Math.random()}@x.local`, role, phone],
)).rows[0].id;

(async () => {
  console.log(`\n=== phase 2, ${DB} ===`);
  // Bring the hand built stub up to the shape the marketplace code needs.
  await testPool.query(
    fs.readFileSync(path.join(__dirname, "fixtures", "marketplace_stub.sql"), "utf8"),
  );
  partyService.resetPartyLink();
  const hasBook = await (async () => {
    const c = await testPool.connect();
    try { return await partyService.hasPartyLink(c); } finally { c.release(); }
  })();
  console.log(`  customer book present: ${hasBook}`);

  const wid = await mkUser("seller", "9000000001");
  const prod = (await q(
    `INSERT INTO products (name, category) VALUES ('Cotton shirting','Fabric') RETURNING id`,
  )).rows[0].id;
  const inv = (await q(
    `INSERT INTO supplier_inventory (supplier_id, product_id, price, moq, stock, status, visibility, shipping_days)
     VALUES ($1,$2,142,10,0,'Active','public',5) RETURNING id`, [wid, prod],
  )).rows[0].id;

  const place = (buyerId, address) => call(orders.createOrder, {
    user: { id: buyerId },
    body: { products: [{ productId: prod, inventoryId: inv, quantity: 10 }], deliveryAddress: address },
  });

  const partyOf = async (orderId) => hasBook
    ? (await q(`SELECT p.* FROM orders o JOIN parties p ON p.id = o.party_id WHERE o.id = $1`, [orderId])).rows[0]
    : null;
  const bookSize = async () => hasBook
    ? (await q(`SELECT count(*)::int n FROM parties WHERE wholesaler_id = $1`, [wid])).rows[0].n
    : 0;

  // 1. A stranger orders. They should appear in the book.
  const buyer = await mkUser("buyer", "9820011223");
  const o1 = await place(buyer, { name: "Kishan Cloth House", phone: "98200 11223", city: "Surat", street: "Ring Road" });
  check(o1.statusCode === 201, "stranger can order", { s: o1.statusCode, m: o1.body?.message });
  if (hasBook) {
    const p1 = await partyOf(o1.body.orderId);
    check(!!p1, "order is linked to a customer", { name: p1?.name });
    check(p1?.name === "Kishan Cloth House", "named off the delivery address", { name: p1?.name });
    check(String(p1?.user_id) === String(buyer), "linked to their account", {});
    check(await bookSize() === 1, "book has one entry", { n: await bookSize() });
  } else {
    check(o1.body?.orderId, "order saved without a customer book", {});
  }

  // 2. They orders again. Must not appear twice.
  const o2 = await place(buyer, { name: "Kishan Cloth House", phone: "9820011223", city: "Surat" });
  check(o2.statusCode === 201, "second order placed", { s: o2.statusCode });
  if (hasBook) {
    const p2 = await partyOf(o2.body.orderId);
    check(String(p2?.id) === String((await partyOf(o1.body.orderId)).id), "same customer, not a duplicate", {});
    check(await bookSize() === 1, "book still has one entry", { n: await bookSize() });
  }

  if (!hasBook) { await testPool.end(); process.exit(fails ? 1 : 0); }

  // 3. The wholesaler wrote someone into their diary months ago, by phone only.
  // That man now signs up and orders. Same row, and the account gets linked.
  const diary = (await q(
    `INSERT INTO parties (wholesaler_id, name, phone, notes) VALUES ($1,'Mahesh bhai','+91 98111 22334','Slow payer, chase them') RETURNING *`,
    [wid],
  )).rows[0];
  const mahesh = await mkUser("buyer", "9811122334");
  const o3 = await place(mahesh, { name: "Mahesh Traders", phone: "098111-22334", city: "Rajkot" });
  const p3 = await partyOf(o3.body.orderId);
  check(String(p3?.id) === String(diary.id), "diary entry matched by phone, however typed", { was: diary.phone, now: "098111-22334" });
  check(String(p3?.user_id) === String(mahesh), "account linked to the diary entry", {});
  check(p3?.name === "Mahesh bhai", "wholesaler's own name for them is kept", { name: p3?.name });
  check(p3?.notes === "Slow payer, chase them", "their private note survives the order", { notes: p3?.notes });
  check(await bookSize() === 2, "no duplicate created", { n: await bookSize() });

  // 4. Two different buyers must not collapse into one customer. users.phone
  // is NOT NULL on the real schema, so a buyer with no phone at all cannot
  // occur; what can occur is two buyers who leave the delivery phone blank,
  // and they have to fall back to their own numbers and stay apart.
  const other1 = await mkUser("buyer", "9700000001");
  const other2 = await mkUser("buyer", "9700000002");
  const o4 = await place(other1, { name: "Blank Phone One", city: "Surat" });
  const o5 = await place(other2, { name: "Blank Phone Two", city: "Surat" });
  check(o4.statusCode === 201 && o5.statusCode === 201, "buyers with no delivery phone can order", {});
  const p4 = await partyOf(o4.body.orderId);
  const p5 = await partyOf(o5.body.orderId);
  check(p4 && p5 && String(p4.id) !== String(p5.id), "two such buyers stay separate", {});
  check(p4?.phone === "9700000001", "falls back to the account's phone", { phone: p4?.phone });
  check(await bookSize() === 4, "book has four entries", { n: await bookSize() });

  // 5. A second wholesaler's book must not see the first one's customers.
  const wid2 = await mkUser("seller", "9000000002");
  const prod2 = (await q(`INSERT INTO products (name, category) VALUES ('Silk','Fabric') RETURNING id`)).rows[0].id;
  const inv2 = (await q(
    `INSERT INTO supplier_inventory (supplier_id, product_id, price, moq, stock, status, visibility, shipping_days)
     VALUES ($1,$2,300,1,0,'Active','public',3) RETURNING id`, [wid2, prod2],
  )).rows[0].id;
  const o6 = await call(orders.createOrder, {
    user: { id: buyer },
    body: { products: [{ productId: prod2, inventoryId: inv2, quantity: 1 }], deliveryAddress: { name: "Kishan Cloth House", phone: "9820011223", city: "Surat" } },
  });
  const p6 = await partyOf(o6.body.orderId);
  check(String(p6?.wholesaler_id) === String(wid2), "same buyer is a separate customer of a second wholesaler", {});
  check(await bookSize() === 4, "first wholesaler's book unchanged", { n: await bookSize() });

  console.log(fails ? `\n${fails} FAILED\n` : "\nall good\n");
  await testPool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

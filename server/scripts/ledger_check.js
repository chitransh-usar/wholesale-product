/**
 * One ledger: does the customer page tell the truth about marketplace money?
 *
 * The question a wholesaler asks their customer book is "how much does this man
 * owe me". Before the ledger was joined up it could only answer for business
 * they typed in by hand, so a retailer who paid half a large order through the
 * shop still showed their full old balance.
 *
 * The dangerous failure is not an error. It is a number that looks plausible
 * and is wrong, so every check here asserts an exact figure worked out by
 * hand in the comment above it.
 *
 *   node scripts/ledger_check.js ledger     migrated
 *   node scripts/ledger_check.js live       before the migration
 */
const Module = require("module");
const { Pool } = require("pg");

const DB = process.argv[2] || "ledger";
const dbPath = require.resolve("../src/config/db");
const testPool = new Pool({ connectionString: `postgres://postgres@127.0.0.1:5433/${DB}` });
const stub = new Module(dbPath, null);
stub.exports = testPool; stub.loaded = true;
require.cache[dbPath] = stub;

const orders = require("../src/controllers/orderController");
const parties = require("../src/controllers/partyController");
const partyService = require("../src/services/partyService");

const mk = () => { const r = { statusCode: 200, body: null };
  r.status = c => (r.statusCode = c, r); r.json = b => (r.body = b, r); return r; };
const call = async (fn, req) => { const r = mk(); await fn(req, r); return r; };
let fails = 0;
const check = (cond, label, v) => { if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"} ${String(label).padEnd(44)} ${JSON.stringify(v)}`); };
const q = (sql, args) => testPool.query(sql, args);

const stamp = Date.now();
let seq = 0;
const mkUser = async (role, phone) => (await q(
  `INSERT INTO users (first_name,last_name,email,role,phone,password_hash)
   VALUES ($1,'T',$2,$3,$4,'x') RETURNING id`,
  [role === "seller" ? "Ram" : "Kishan", `${role}${stamp}${seq++}@x.local`, role, phone],
)).rows[0].id;

(async () => {
  console.log(`\n=== one ledger, ${DB} ===`);
  partyService.resetPartyLink();
  const client = await testPool.connect();
  const ready = await partyService.hasLedgerLink(client);
  client.release();
  console.log(`  ledger columns present: ${ready}`);

  const wid = await mkUser("seller", "9000000001");
  await q(`INSERT INTO wholesaler_profiles (user_id, company_name, upi_id, contact_phone, city)
           VALUES ($1,'Ram Textiles','ram@upi','9000000001','Surat')`, [wid]);
  const prod = (await q(`INSERT INTO products (name, category) VALUES ('Cotton shirting','Fabric') RETURNING id`)).rows[0].id;
  const inv = (await q(
    `INSERT INTO supplier_inventory (supplier_id, product_id, price, moq, stock, status, visibility, shipping_days)
     VALUES ($1,$2,100,10,0,'Active','public',5) RETURNING id`, [wid, prod],
  )).rows[0].id;

  const buyer = await mkUser("buyer", "9820011223");
  const user = { id: wid, role: "seller" };

  const balanceOf = async (partyId) => {
    const r = await call(parties.getPartyById, { user, params: { id: partyId } });
    return Number(r.body?.party?.outstanding);
  };

  // An order of 10 x 100 = 1000, on the half now half later plan.
  const placed = await call(orders.createOrder, {
    user: { id: buyer },
    body: {
      products: [{ productId: prod, inventoryId: inv, quantity: 10 }],
      deliveryAddress: { name: "Kishan Cloth House", phone: "9820011223", city: "Surat" },
      paymentPlan: "installment_50_50",
    },
  });
  check(placed.statusCode === 201, "order placed", { s: placed.statusCode, m: placed.body?.message });
  const orderId = placed.body.orderId;

  if (!ready) {
    // Nothing should have exploded, and the khata simply does not know yet.
    const paid = await call(orders.updatePaymentStatus, {
      user: { id: buyer, role: "buyer" }, params: { orderId }, body: { paymentStatus: "partial" },
    });
    check(paid.statusCode === 200, "payment still works without the migration", { s: paid.statusCode });
    console.log(fails ? `\n${fails} FAILED\n` : "\nall good\n");
    await testPool.end();
    process.exit(fails ? 1 : 0);
  }

  const partyId = (await q("SELECT party_id FROM orders WHERE id = $1", [orderId])).rows[0].party_id;
  check(!!partyId, "order joined the customer book", {});

  // An order sitting at payment_pending is a request, not a debt. Nothing
  // billed, nothing paid, so the customer owes 0.
  check(await balanceOf(partyId) === 0, "an unpaid order is not yet a debt", { bal: await balanceOf(partyId) });

  // They pay the first half: 500 of 1000. Billed 1000, received 500, owes 500.
  // initiatePayment first, because that is what opens the session naming the
  // instalment amount. The checkout placeholder is for the whole order, so
  // skipping this step would settle the lot.
  const pay = async (status) => {
    await call(orders.initiatePayment, { user: { id: buyer, role: "buyer" }, params: { orderId }, body: {} });
    return call(orders.updatePaymentStatus, {
      user: { id: buyer, role: "buyer" }, params: { orderId },
      body: { paymentStatus: status, paymentMethod: "upi" },
    });
  };
  const first = await pay("partial");
  check(first.statusCode === 200, "first instalment accepted", { s: first.statusCode, m: first.body?.message });
  check(await balanceOf(partyId) === 500, "half paid shows 500 still due", { bal: await balanceOf(partyId) });

  const rows = await q("SELECT amount, method, order_id, payment_transaction_id FROM party_payments WHERE party_id = $1", [partyId]);
  check(rows.rows.length === 1, "one ledger row, not two", { n: rows.rows.length });
  check(Number(rows.rows[0].amount) === 500, "ledger row is the amount actually taken", { amt: rows.rows[0].amount });
  check(!!rows.rows[0].payment_transaction_id, "ledger row is tied to its payment", {});

  // The same payment arriving twice must not halve customer balance again.
  const replay = await partyService.recordOrderPayment(await testPool.connect().then(c => { replayClient = c; return c; }), {
    orderId, partyId, wholesalerId: wid, amount: 500,
    transactionId: rows.rows[0].payment_transaction_id,
  });
  replayClient.release();
  check(replay === false, "a replayed payment is refused", { wrote: replay });
  check(await balanceOf(partyId) === 500, "balance unchanged by the replay", { bal: await balanceOf(partyId) });

  // They pay the rest. Billed 1000, received 1000, owes nothing.
  const second = await pay("paid");
  check(second.statusCode === 200, "second instalment accepted", { s: second.statusCode, m: second.body?.message });
  check(await balanceOf(partyId) === 0, "fully paid shows nothing due", { bal: await balanceOf(partyId) });

  // A hand written sale on top of the marketplace order: both in one book.
  await q(`INSERT INTO sales (wholesaler_id, party_id, sale_number, sale_date, status, total, subtotal)
           VALUES ($1,$2,'S-1',CURRENT_DATE,'confirmed',250,250)`, [wid, partyId]);
  check(await balanceOf(partyId) === 250, "a hand written sale adds to the same balance", { bal: await balanceOf(partyId) });

  // A cancelled order must drop straight out of the billed side.
  const other = await call(orders.createOrder, {
    user: { id: buyer },
    body: { products: [{ productId: prod, inventoryId: inv, quantity: 10 }],
            deliveryAddress: { name: "Kishan Cloth House", phone: "9820011223", city: "Surat" } },
  });
  await q("UPDATE orders SET status = 'cancelled' WHERE id = $1", [other.body.orderId]);
  check(await balanceOf(partyId) === 250, "a cancelled order is not owed", { bal: await balanceOf(partyId) });

  // The statement a wholesaler sends on WhatsApp has to agree with the page.
  const st = await call(parties.getPartyStatement, { user, params: { id: partyId }, query: {} });
  check(st.statusCode === 200, "statement builds", { s: st.statusCode });
  check(Number(st.body?.closingBalance) === await balanceOf(partyId),
    "statement closing balance equals the customer page",
    { statement: st.body?.closingBalance, page: await balanceOf(partyId) });

  console.log(fails ? `\n${fails} FAILED\n` : "\nall good\n");
  await testPool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("THREW", e); process.exit(1); });

let replayClient;

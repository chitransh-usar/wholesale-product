/**
 * Extra Amazon and Flipkart accounts, each its own run of bill numbers.
 *
 * Driven through the real controllers against a real Postgres. The 22 Sept
 * version of this feature shipped with a suite run against an in-memory stand
 * in for the database, and the server it described would not start: the
 * routes file imported a middleware that does not exist. A stand in agrees
 * with whatever it was written to agree with.
 *
 * Two databases, because the half that matters most is the one where the
 * migration has NOT been run, which is how Neon sits until somebody runs it.
 * That half runs in a child process: the schema probes cache a true answer
 * for the life of the process, so one process cannot honestly ask both.
 *
 *     node scripts/marketplace_account_check.js <migrated db> <unmigrated db>
 *
 * Build the unmigrated one from every migration except
 * wholesale3_marketplace_linkages.sql.
 */
const Module = require("module");
const { Pool } = require("pg");
const { spawnSync } = require("child_process");

const MIGRATED = process.argv[2] || "qa_mkt";
const UNMIGRATED = process.argv[3] || "qa_mkt_pre";
const CHILD = process.argv[4] === "--unmigrated";
const DB = CHILD ? UNMIGRATED : MIGRATED;

const dbPath = require.resolve("../src/config/db");
const tp = new Pool({ connectionString: `postgres://postgres@127.0.0.1:5433/${DB}` });
const stub = new Module(dbPath, null);
stub.exports = tp;
stub.loaded = true;
require.cache[dbPath] = stub;

const saleController = require("../src/controllers/saleController");
const orderController = require("../src/controllers/orderController");
const masterController = require("../src/controllers/masterController");
const accounts = require("../src/controllers/marketplaceAccountController");
const invoiceController = require("../src/controllers/invoiceController");

let fails = 0;
const check = (pass, label, extra) => {
  if (!pass) fails++;
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${extra !== undefined ? `   ${JSON.stringify(extra)}` : ""}`);
};
const mk = () => {
  const r = { statusCode: 0, body: null };
  r.status = (c) => ((r.statusCode = c), r);
  r.json = (b) => ((r.body = b), r);
  return r;
};

const seller = async (label) => {
  const s = Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(2, 5);
  const d = String(Date.now()).slice(-6) + Math.floor(Math.random() * 10);
  const id = (await tp.query(
    `INSERT INTO users (first_name,last_name,email,password_hash,phone,role)
     VALUES ($1,'Seth',$2,'x',$3,'seller') RETURNING id`,
    [label, `${label}-${s}@example.com`, `7${d}`],
  )).rows[0].id;
  await tp.query(
    `INSERT INTO wholesaler_profiles (user_id,company_name,gstin,city,warehouse_state)
     VALUES ($1,$2,'27AAAPA1234A1Z5','Bhiwandi','Maharashtra')`,
    [id, `${label} Textiles ${s}`],
  );
  await tp.query(
    `INSERT INTO invoice_settings (user_id,prefix,number_suffix,number_pad_to)
     VALUES ($1,'OM/','/{FY}',0)`,
    [id],
  );
  const party = (await tp.query(
    `INSERT INTO parties (wholesaler_id,name,city,state) VALUES ($1,$2,'Surat','Gujarat') RETURNING id`,
    [id, `Ramesh ${s}`],
  )).rows[0].id;
  return { id, party, user: { id, role: "seller" } };
};

const call = async (fn, req) => {
  const r = mk();
  await fn(req, r);
  return r;
};

const sale = (w, channel) =>
  call(saleController.createSale, {
    user: w.user,
    body: {
      partyId: w.party, amountPaid: 0, paymentMethod: "cash", channel,
      lines: [{ itemName: "Cotton shirting", quantity: 2, rate: 100, hsnCode: "52081110", gstPercent: 5 }],
    },
  });
const bill = (w, saleId) =>
  call(saleController.createInvoiceForSale, { user: w.user, params: { id: saleId } });
const order = (w, channel) =>
  call(orderController.createManualOrder, {
    user: w.user,
    body: { partyId: w.party, channel, lines: [{ itemName: "Cloth", quantity: 4, rate: 50 }] },
  });
const add = (w, body) => call(accounts.addAccount, { user: w.user, body });
const masters = (w) => call(masterController.getMasters, { user: w.user, query: {} });

/** Where the migration has not been run: everything as it was on 21 Sept. */
const unmigrated = async () => {
  console.log("\nA. Before the migration, nothing that worked stops working");
  const w = await seller("pre");

  const o1 = await order(w);
  check(o1.statusCode === 201, "a phone order is taken", o1.body?.message);
  check(/^SO\/1\//.test(o1.body?.order_number || ""), "numbered on the one SO run", o1.body?.order_number);

  const s1 = await sale(w);
  check(s1.statusCode === 201, "a counter sale is recorded", s1.body?.message);
  const b1 = await bill(w, s1.body?.id);
  check(/^OM\/1\//.test(b1.body?.invoice_number || ""), "and billed on the wholesaler's own run", b1.body?.invoice_number);

  const s2 = await sale(w, "amazon");
  const b2 = await bill(w, s2.body?.id);
  check(/^AZ\/1\//.test(b2.body?.invoice_number || ""), "the built in Amazon book still works", b2.body?.invoice_number);

  const acc = await call(orderController.updateOrderStatus, {
    user: w.user, params: { orderId: o1.body?.id }, body: { status: "processing" },
  });
  check(acc.statusCode === 200 || acc.body?.success, "and the order moves on", acc.body?.message);

  const m = await masters(w);
  check(m.body?.salesChannels?.length === 4, "the forms are offered the four books", m.body?.salesChannels?.length);

  const listed = await call(accounts.listAccounts, { user: w.user });
  check(listed.body?.setUp === false, "the settings screen is told it is not switched on", listed.body?.setUp);
  const added = await add(w, { marketplace: "amazon", name: "Second store", invoicePrefix: "AZ2" });
  check(added.statusCode === 503, "adding an account says so, rather than a 500", added.statusCode);

  const fk = await order(w, "flipkart");
  check(fk.statusCode === 503, "filing an order under Flipkart is a loud 503", fk.body?.code);
};

const migrated = async () => {
  console.log("\n1. Adding accounts");
  const w = await seller("mkt");
  const other = await seller("other");

  const a2 = await add(w, { marketplace: "amazon", name: "Amazon, second store", invoicePrefix: "az2" });
  check(a2.statusCode === 201, "an extra Amazon account", a2.body?.message);
  check(a2.body?.account?.code === "amazon-2", "is amazon-2, since the built in book is the first", a2.body?.account?.code);
  check(a2.body?.account?.invoice_prefix === "AZ2/", "prefix cleaned to AZ2/", a2.body?.account?.invoice_prefix);
  const a3 = await add(w, { marketplace: "amazon", name: "Amazon, third store", invoicePrefix: "AM3/" });
  check(a3.body?.account?.code === "amazon-3", "the next is amazon-3", a3.body?.account?.code);
  const f2 = await add(w, { marketplace: "flipkart", name: "Flipkart, second", invoicePrefix: "FK2/" });
  check(f2.body?.account?.code === "flipkart-2", "Flipkart counts on its own", f2.body?.account?.code);

  for (const [prefix, why] of [
    ["AZ/", "the built in Amazon prefix"],
    ["SA/", "the shop's prefix"],
    ["OM/", "the wholesaler's own prefix"],
    ["AZ2/", "another account's prefix"],
    ["AZ2/X/", "one that starts with another account's"],
    ["ABCDEFGHIJ", "one too long"],
    ["A B", "one with a space"],
  ]) {
    const r = await add(w, { marketplace: "amazon", name: `Try ${prefix}`, invoicePrefix: prefix });
    check(r.statusCode === 400, `refused: ${why}`, r.body?.message);
  }
  const noMarket = await add(w, { marketplace: "meesho", name: "Meesho", invoicePrefix: "MS/" });
  check(noMarket.statusCode === 400, "refused: a marketplace we do not list", noMarket.body?.message);
  const sameName = await add(w, { marketplace: "amazon", name: "amazon, second store", invoicePrefix: "AZ9/" });
  check(sameName.statusCode === 400, "refused: a name already used", sameName.body?.message);

  const theirs = await add(other, { marketplace: "amazon", name: "Their store", invoicePrefix: "AZ2/" });
  check(theirs.statusCode === 201, "another wholesaler may use AZ2/ in their own book", theirs.body?.message);

  console.log("\n2. The forms are offered them");
  const m = await masters(w);
  const codes = (m.body?.salesChannels || []).map((c) => c.code);
  check(["counter", "shop", "flipkart", "amazon", "amazon-2", "amazon-3", "flipkart-2"].every((c) => codes.includes(c)),
    "the four books and the three accounts", codes);
  const mo = await masters(other);
  check(!(mo.body?.salesChannels || []).some((c) => c.code === "amazon-3"), "and nobody else's", mo.body?.salesChannels?.map((c) => c.code));

  console.log("\n3. Bills: one run per account. Sales: one run for everything");
  const sc = await sale(w);
  const sa2a = await sale(w, "amazon-2");
  const sa2b = await sale(w, "amazon-2");
  const sa3 = await sale(w, "amazon-3");
  const saz = await sale(w, "amazon");
  const saleNos = [sc, sa2a, sa2b, sa3, saz].map((r) => r.body?.sale_number);
  check(saleNos.every((n, i) => n === `S/${i + 1}/${saleNos[0].split("/")[2]}`),
    "sale numbers are one consecutive S/ run, whatever the book", saleNos);
  check(sa2a.body?.channel === "amazon-2", "the sale remembers its book", sa2a.body?.channel);

  const nos = {};
  for (const [k, r] of Object.entries({ sc, sa2a, sa2b, sa3, saz })) {
    const b = await bill(w, r.body?.id);
    nos[k] = b.body?.invoice_number;
  }
  const fy = (nos.sc || "").split("/").slice(2).join("/");
  check(nos.sc === `OM/1/${fy}`, "a counter sale bills on the wholesaler's own run", nos.sc);
  check(nos.sa2a === `AZ2/1/${fy}` && nos.sa2b === `AZ2/2/${fy}`, "the second store runs AZ2/1, AZ2/2", [nos.sa2a, nos.sa2b]);
  check(nos.sa3 === `AM3/1/${fy}`, "the third store starts its own at 1", nos.sa3);
  check(nos.saz === `AZ/1/${fy}`, "the built in Amazon book is untouched", nos.saz);
  check(new Set(Object.values(nos)).size === 5, "no number printed twice", nos);
  const inv = await tp.query("SELECT channel FROM invoices WHERE invoice_number = $1 AND supplier_id = $2", [nos.sa2a, w.id]);
  check(inv.rows[0]?.channel === "amazon-2", "the bill records which book it is in", inv.rows[0]?.channel);

  const unknown = await sale(w, "amazon-9");
  check(unknown.statusCode === 400, "an account that does not exist is refused, not filed at the counter", unknown.body?.message);
  const notMine = await sale(other, "amazon-3");
  check(notMine.statusCode === 400, "and so is somebody else's", notMine.body?.message);

  console.log("\n4. Orders: filed under a book, numbered on the one SO run");
  const o1 = await order(w);
  const o2 = await order(w, "amazon-3");
  const o3 = await order(w, "flipkart-2");
  const orderNos = [o1, o2, o3].map((r) => r.body?.order_number);
  check(orderNos.every((n, i) => n?.startsWith(`SO/${i + 1}/`)), "SO/1, SO/2, SO/3, never two SO/1s", orderNos);
  check(o2.body?.channel === "amazon-3", "the order remembers its book", o2.body?.channel);
  check(o1.body?.channel === "counter", "a phone order defaults to the counter", o1.body?.channel);

  for (const step of ["processing", "packed", "ready_for_pickup", "shipped"]) {
    await call(orderController.updateOrderStatus, { user: w.user, params: { orderId: o2.body?.id }, body: { status: step } });
  }
  const shipped = await tp.query(
    `SELECT s.channel, s.sale_number, i.invoice_number FROM sales s
       LEFT JOIN invoices i ON i.sale_id = s.id
      WHERE s.order_id = $1`, [o2.body?.id]);
  check(shipped.rows[0]?.channel === "amazon-3", "shipping it writes the sale in that book", shipped.rows[0]);
  check(shipped.rows[0]?.invoice_number === `AM3/2/${fy}`, "and bills it on that account's run", shipped.rows[0]?.invoice_number);
  check(shipped.rows[0]?.sale_number === `S/6/${fy}`, "while the sale carries on the one S/ run", shipped.rows[0]?.sale_number);

  console.log("\n5. Pausing, editing and removing");
  const waiting = await sale(w, "amazon-2");
  const unbilled = await sale(w, "amazon-2");
  const acc2 = a2.body.account;
  const pause = await call(accounts.updateAccount, { user: w.user, params: { id: acc2.id }, body: { isActive: false } });
  check(pause.body?.account?.is_active === false, "the second store is paused", pause.body?.account);
  const refused = await sale(w, "amazon-2");
  check(refused.statusCode === 400, "no new sale goes into a paused account", refused.body?.message);
  const late = await bill(w, waiting.body?.id);
  check(late.body?.invoice_number === `AZ2/3/${fy}`,
    "a sale filed before the pause still bills into its own run, not a second OM/1", late.body?.invoice_number);
  const edit = await call(saleController.updateSale, {
    user: w.user, params: { id: unbilled.body?.id },
    body: { partyId: w.party, channel: "amazon-2", lines: [{ itemName: "Cotton shirting", quantity: 2, rate: 100, hsnCode: "52081110", gstPercent: 5 }] },
  });
  check(edit.statusCode === 200,
    "editing a sale already in the paused account is not refused for naming it", edit.body?.message);
  const mp = await masters(w);
  check(mp.body?.salesChannels?.find((c) => c.code === "amazon-2")?.paused === true,
    "the forms are told it is paused, so they can leave it out for new sales", mp.body?.salesChannels?.find((c) => c.code === "amazon-2"));

  const rename = await call(accounts.updateAccount, { user: w.user, params: { id: acc2.id }, body: { name: "Amazon, Delhi" } });
  check(rename.body?.account?.linkage_name === "Amazon, Delhi", "renaming is always allowed", rename.body?.account?.linkage_name);
  const reprefix = await call(accounts.updateAccount, { user: w.user, params: { id: acc2.id }, body: { invoicePrefix: "AD/" } });
  check(reprefix.statusCode === 409, "the prefix is fixed once a bill has gone out on it", reprefix.body?.message);

  const fresh = await add(w, { marketplace: "flipkart", name: "Flipkart, third", invoicePrefix: "FK3/" });
  const move = await call(accounts.updateAccount, { user: w.user, params: { id: fresh.body.account.id }, body: { invoicePrefix: "FT/" } });
  check(move.body?.account?.invoice_prefix === "FT/", "but can change before any bill", move.body?.account?.invoice_prefix);
  const clash = await call(accounts.updateAccount, { user: w.user, params: { id: fresh.body.account.id }, body: { invoicePrefix: "AM3/" } });
  check(clash.statusCode === 400, "and not onto another account's prefix", clash.body?.message);

  const rmUsed = await call(accounts.removeAccount, { user: w.user, params: { id: acc2.id } });
  check(rmUsed.statusCode === 409, "an account with sales in it cannot be removed", rmUsed.body?.message);
  const rmFresh = await call(accounts.removeAccount, { user: w.user, params: { id: fresh.body.account.id } });
  check(rmFresh.body?.success === true, "an empty one can", rmFresh.body);
  const rmTheirs = await call(accounts.removeAccount, { user: other.user, params: { id: a3.body.account.id } });
  check(rmTheirs.statusCode === 404, "and nobody can remove somebody else's", rmTheirs.statusCode);
  const editTheirs = await call(accounts.updateAccount, { user: other.user, params: { id: a3.body.account.id }, body: { name: "Mine now" } });
  check(editTheirs.statusCode === 404, "or rename it", editTheirs.statusCode);

  console.log("\n6. The wholesaler's own prefix cannot move onto an account's");
  const settings = (prefix) => call(invoiceController.saveSettings.bind(invoiceController), {
    user: w.user, body: { prefix, dueDays: 15, defaultTaxRate: 5, numberSuffix: "/{FY}", numberPadTo: 0 },
  });
  const onto = await settings("AM3/");
  check(onto.statusCode === 400, "OM/ to AM3/ is refused", onto.body?.message);
  const same = await settings("OM/");
  check(same.statusCode !== 400, "saving the rest of the screen on the same prefix is fine", same.body?.message);

  console.log("\n7. The screen's list");
  const listed = await call(accounts.listAccounts, { user: w.user });
  check(listed.body?.setUp === true && listed.body?.accounts?.length === 3, "three accounts listed", listed.body?.accounts?.length);
  check(listed.body?.accounts?.find((a) => a.code === "amazon-3")?.sample === `AM3/1/${fy}`,
    "each with what bill 1 would read in the wholesaler's own format", listed.body?.accounts?.map((a) => a.sample));
  check(listed.body?.builtIn?.length === 2, "the built in Amazon and Flipkart books shown beside them", listed.body?.builtIn);
};

(async () => {
  if (CHILD) {
    await unmigrated();
  } else {
    await migrated();
    const child = spawnSync(process.execPath, [__filename, MIGRATED, UNMIGRATED, "--unmigrated"], {
      encoding: "utf8",
    });
    process.stdout.write(child.stdout);
    process.stderr.write(child.stderr.split("\n").filter((l) => /FAIL|THREW|Error/.test(l)).join("\n"));
    if (child.status !== 0) fails++;
  }
  await tp.end();
  if (!CHILD) console.log(fails ? `\n${fails} FAILED\n` : "\nall good\n");
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error("THREW", e.stack);
  process.exit(1);
});

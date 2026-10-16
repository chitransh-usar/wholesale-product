/**
 * Does an accepted order land in the sales book without doubling the debt?
 *
 * The bridge is where double counting hides. The order is already on the
 * billed side of the khata; the moment it also becomes a sale, the same goods
 * are on that side twice and the customer appears to owe double. It looks like
 * a plausible number, so every check below asserts an exact figure.
 *
 *     node scripts/order_sale_check.js <database>
 */
const Module = require("module");
const { Pool } = require("pg");

const DB = process.argv[2] || "bridge";
const dbPath = require.resolve("../src/config/db");
const testPool = new Pool({ connectionString: `postgres://postgres@127.0.0.1:5433/${DB}` });
const stub = new Module(dbPath, null);
stub.exports = testPool; stub.loaded = true;
require.cache[dbPath] = stub;

const orders = require("../src/controllers/orderController");
const parties = require("../src/controllers/partyController");
const partyService = require("../src/services/partyService");
const saleService = require("../src/services/orderSaleService");
const driverLinks = require("../src/controllers/driverLinkController");

const mk = () => { const r = { statusCode: 200, body: null };
  r.status = c => (r.statusCode = c, r); r.json = b => (r.body = b, r); return r; };
const call = async (fn, req) => { const r = mk(); await fn(req, r); return r; };
let fails = 0;
const check = (cond, label, v) => { if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"} ${String(label).padEnd(48)} ${JSON.stringify(v)}`); };
const q = (sql, args) => testPool.query(sql, args);

const stamp = Date.now();
let seq = 0;
const mkUser = async (role, phone) => (await q(
  `INSERT INTO users (first_name,last_name,email,role,phone,password_hash)
   VALUES ($1,'T',$2,$3,$4,'x') RETURNING id`,
  [role === "seller" ? "Ram" : "Kishan", `${role}${stamp}${seq++}@x.local`, role, phone],
)).rows[0].id;

(async () => {
  console.log(`\n=== order to sale, ${DB} ===`);
  partyService.resetPartyLink();
  saleService.resetSaleLink();

  const wid = await mkUser("seller", "9000000001");
  await q(`INSERT INTO wholesaler_profiles (user_id, company_name, upi_id, contact_phone, city)
           VALUES ($1,'Ram Textiles','ram@upi','9000000001','Surat')`, [wid]);
  const buyer = await mkUser("buyer", "9820011223");
  const seller = { id: wid, role: "seller" };

  // Two products, because an order holding several items is the case that
  // gets dropped when code reads orders.inventory_item_id instead of
  // order_items.
  const ids = [];
  for (const [name, price, unit, hsn] of [
    ["Cotton shirting", 142, "mtr", "5208"],
    ["Silk dupatta", 340, "pcs", "5007"],
  ]) {
    const p = (await q(`INSERT INTO products (name,category) VALUES ($1,'Fabric') RETURNING id`, [name])).rows[0].id;
    const i = (await q(
      `INSERT INTO supplier_inventory (supplier_id,product_id,price,moq,stock,status,visibility,shipping_days,unit,hsn_code,gst_percent)
       VALUES ($1,$2,$3,1,0,'Active','public',5,$4,$5,5) RETURNING id`,
      [wid, p, price, unit, hsn],
    )).rows[0].id;
    ids.push({ p, i, price });
  }

  const placed = await call(orders.createOrder, {
    user: { id: buyer },
    body: {
      products: [
        { productId: ids[0].p, inventoryId: ids[0].i, quantity: 10 },
        { productId: ids[1].p, inventoryId: ids[1].i, quantity: 2 },
      ],
      deliveryAddress: { name: "Kishan Cloth House", phone: "9820011223", city: "Surat" },
    },
  });
  check(placed.statusCode === 201, "order placed", { s: placed.statusCode, m: placed.body?.message });
  const orderId = placed.body.orderId;
  // 10 x 142 + 2 x 340 = 1420 + 680 = 2100
  const orderTotal = Number((await q("SELECT total_amount FROM orders WHERE id=$1", [orderId])).rows[0].total_amount);
  check(orderTotal === 2100, "order totals 2100", { total: orderTotal });

  const partyId = (await q("SELECT party_id FROM orders WHERE id=$1", [orderId])).rows[0].party_id;
  const balance = async () =>
    Number((await call(parties.getPartyById, { user: seller, params: { id: partyId } })).body?.party?.outstanding);

  // Pay it, so the order is real business the wholesaler can accept.
  await call(orders.initiatePayment, { user: { id: buyer, role: "buyer" }, params: { orderId }, body: {} });
  await call(orders.updatePaymentStatus, {
    user: { id: buyer, role: "buyer" }, params: { orderId }, body: { paymentStatus: "paid" },
  });
  check(await balance() === 0, "paid in full, nothing owed", { bal: await balance() });

  // A driver link must be refused before the goods are packed.
  const early = await call(driverLinks.createLink, {
    user: seller, params: { orderId }, body: { driverName: "Ramesh" },
  });
  check(early.statusCode === 409, "driver link refused before packing", { s: early.statusCode, m: early.body?.message });

  // Accept. This is the moment the sale should appear.
  const accepted = await call(orders.updateOrderStatus, {
    user: seller, params: { orderId }, body: { status: "supplier_accepted" },
  });
  check(accepted.statusCode === 200, "order accepted", { s: accepted.statusCode });

  const sales = await q("SELECT * FROM sales WHERE order_id = $1", [orderId]);
  check(sales.rows.length === 1, "one sale written, not two", { n: sales.rows.length });
  const sale = sales.rows[0] || {};
  check(Number(sale.total) === orderTotal,
    "the sale owes exactly what the order charged", { sale: sale.total, order: orderTotal });
  check(sale.source === "retailer", "marked as coming from the shop", { source: sale.source });
  check(sale.status === "confirmed", "confirmed, so it counts in the khata", { status: sale.status });
  // S/1/26-27 once wholesale3_series_financial_year.sql is run, S-0001 before
  // it. Both shapes are their own run and neither is the invoice run, which is
  // what this check is about.
  check(/^S[-/]\d+/.test(sale.sale_number || ""), "given the wholesaler's own sale number", { n: sale.sale_number });

  const lines = await q("SELECT * FROM sale_lines WHERE sale_id = $1 ORDER BY item_name", [sale.id]);
  check(lines.rows.length === 2, "both products carried over, not just the first",
    { n: lines.rows.length, names: lines.rows.map(l => l.item_name) });
  const lineSum = lines.rows.reduce((t, l) => t + Number(l.amount), 0);
  check(lineSum === orderTotal, "the lines add up to the order", { lines: lineSum, order: orderTotal });
  const cotton = lines.rows.find(l => l.item_name === "Cotton shirting");
  check(cotton && Number(cotton.rate) === 142 && cotton.unit === "mtr",
    "rate and unit carried over", { rate: cotton?.rate, unit: cotton?.unit });
  check(cotton && cotton.hsn_code === "5208", "HSN carried over for the bill", { hsn: cotton?.hsn_code });

  // THE ONE THAT MATTERS. The order is on the billed side and now so is its
  // sale. If both are counted the customer owes 4200 instead of nothing.
  check(await balance() === 0,
    "balance unchanged: the goods are counted once, not twice", { bal: await balance() });

  // Accepting again must not write a second sale.
  const again = await saleService.createSaleFromOrder(
    await testPool.connect().then(c => { reuse = c; return c; }), orderId);
  reuse.release();
  check(String(again?.id) === String(sale.id), "a second accept reuses the same sale", {});
  check(Number((await q("SELECT count(*) n FROM sales WHERE order_id=$1", [orderId])).rows[0].n) === 1,
    "still one sale", {});

  // The statement must agree with the page, and must not list the goods twice.
  const st = await call(parties.getPartyStatement, { user: seller, params: { id: partyId }, query: {} });
  check(Number(st.body?.closingBalance) === await balance(),
    "statement agrees with the customer page",
    { statement: st.body?.closingBalance, page: await balance() });
  const debits = (st.body?.rows || []).filter(r => Number(r.debit) > 0);
  check(debits.length === 1, "the goods appear once on the statement",
    { lines: debits.map(d => `${d.kind} ${d.ref} ${d.debit}`) });

  // A bill must never ask for more than the customer was charged. The shop
  // price is the whole price, so the tax comes out of it rather than going on
  // top; billing 2205 for a 2100 order asked a man who had paid in full for
  // another 105.
  const repo = require("../src/repositories/invoiceRepository");
  const saleInvoiceService = require("../src/services/saleInvoiceService");
  repo.resetSchemaExtras();
  const { invoice } = await saleInvoiceService.createInvoiceFromSale(sale.id, wid);
  check(Number(invoice.grand_total) === orderTotal,
    "the bill asks for exactly what they were charged",
    { bill: invoice.grand_total, order: orderTotal });
  check(
    Math.abs(
      Number(invoice.taxable_amount) + Number(invoice.total_tax) - orderTotal,
    ) < 0.01,
    "tax is taken out of the price, not added to it",
    { taxable: invoice.taxable_amount, gst: invoice.total_tax, total: invoice.grand_total },
  );
  check(Number(invoice.total_tax) > 0, "GST is still declared on the bill", { gst: invoice.total_tax });

  // Once packed, a driver link is allowed.
  for (const s of ["processing", "packed"]) {
    await call(orders.updateOrderStatus, { user: seller, params: { orderId }, body: { status: s } });
  }
  const ok = await call(driverLinks.createLink, {
    user: seller, params: { orderId }, body: { driverName: "Ramesh" },
  });
  check(ok.statusCode === 201, "driver link allowed once packed", { s: ok.statusCode });

  console.log(fails ? `\n${fails} FAILED\n` : "\nall good\n");
  await testPool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("THREW", e); process.exit(1); });

let reuse;

/**
 * Does the bill say the same thing the order said?
 *
 * A wholesaler saw one name on their Orders tab and a different name on their
 * Invoices tab, for the same goods and the same customer. Two separate faults
 * were behind it, and both are checked here.
 *
 * 1. The order screen reads `wholesaler_profiles.company_name` off the buyer's
 *    account. The invoice reads the party, and the party created at checkout
 *    was given the delivery address name and nothing else: no firm, no GST
 *    number. So the orders tab said "Kishan Cloth House" and the invoice said
 *    "Kishan Kumar". The missing GST number was the worse half, because a bill
 *    without it is a bill the customer cannot claim input credit against.
 *
 * 2. There were genuinely two invoices. Checkout raises one from the order in
 *    the background, and pressing "raise bill" on the sale raised another,
 *    because that path only looked for an invoice against the sale and the
 *    order's invoice carries no sale_id. One lot of goods, two numbers, two
 *    rows in the tab, under two different names.
 *
 * The rule this pins down: one lot of goods has one bill, addressed to the
 * firm when there is one, and nothing an order does may overwrite what the
 * wholesaler wrote in their own book.
 *
 *     node scripts/invoice_name_check.js <database>
 */
const Module = require("module");
const { Pool } = require("pg");

const DB = process.argv[2] || "qa_invname";
const dbPath = require.resolve("../src/config/db");
const testPool = new Pool({ connectionString: `postgres://postgres@127.0.0.1:5433/${DB}` });
const stub = new Module(dbPath, null);
stub.exports = testPool;
stub.loaded = true;
require.cache[dbPath] = stub;

const orders = require("../src/controllers/orderController");
const invoices = require("../src/controllers/invoiceController");
const sales = require("../src/controllers/saleController");
const invoiceService = require("../src/services/invoiceService");
const orderSale = require("../src/services/orderSaleService");
const partyService = require("../src/services/partyService");

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
  console.log(`  ${cond ? "PASS" : "FAIL"} ${String(label).padEnd(54)} ${JSON.stringify(detail ?? {})}`);
};

const uniq = () => String(Date.now()) + Math.floor(Math.random() * 1000);

const BUYER_GSTIN = "24BBBBB1111B1ZT";

const makeSeller = async () => {
  const id = (await testPool.query(
    `INSERT INTO users (first_name,last_name,email,phone,password_hash,role)
     VALUES ('Ram','Textiles',$1,$2,'x','seller') RETURNING id`,
    [`ram+${uniq()}@inv.local`, `90${uniq().slice(-8)}`])).rows[0].id;
  await testPool.query(
    `INSERT INTO wholesaler_profiles (user_id, company_name, warehouse_state, gstin)
     VALUES ($1,'Ram Textiles','Gujarat','24AAACC1206D1ZM')`, [id]);
  return id;
};

/** A retailer who also sells, so they have a firm name on their account. */
const makeBuyer = async (company) => {
  const id = (await testPool.query(
    `INSERT INTO users (first_name,last_name,email,phone,password_hash,role)
     VALUES ('Kishan','Kumar',$1,$2,'x',$3) RETURNING id`,
    [`kishan+${uniq()}@inv.local`, `98${uniq().slice(-8)}`, company ? "both" : "buyer"])).rows[0].id;
  if (company) {
    await testPool.query(
      `INSERT INTO wholesaler_profiles (user_id, company_name, city, gstin)
       VALUES ($1,$2,'Surat',$3)`, [id, company, BUYER_GSTIN]);
  }
  return id;
};

const makeListing = async (sellerId) => {
  const product = (await testPool.query(
    `INSERT INTO products (name, category) VALUES ($1,'Fabric') RETURNING id`,
    [`Cotton shirting ${uniq()}`])).rows[0].id;
  const listing = (await testPool.query(
    `INSERT INTO supplier_inventory
       (supplier_id, product_id, price, moq, stock, shipping_days, unit, hsn_code, gst_percent, visibility)
     VALUES ($1,$2,142,1,100,2,'mtr','5208',5,'public') RETURNING id`,
    [sellerId, product])).rows[0].id;
  return { product, listing };
};

const placeOrder = async (buyerId, product, listing, addressName) => {
  const placed = await call(orders.createOrder, {
    user: { id: buyerId, role: "both" },
    body: {
      products: [{ productId: product, inventoryId: listing, quantity: 10 }],
      deliveryAddress: {
        name: addressName, phone: `98${uniq().slice(-8)}`, street: "Ring Road",
        city: "Surat", state: "Gujarat", pincode: "395002",
      },
      paymentPlan: "full",
    },
  });
  return placed.body?.orderId;
};

/** Take an order to accepted, which is what writes the sale. */
const accept = async (orderId) => {
  await testPool.query(
    `UPDATE orders SET status='supplier_accepted', payment_status='paid',
            amount_paid=total_amount WHERE id=$1`, [orderId]);
  const c = await testPool.connect();
  const sale = await orderSale.createSaleFromOrder(c, orderId);
  c.release();
  return sale;
};

const invoicesFor = async (orderId) =>
  (await testPool.query(
    `SELECT i.invoice_number, i.recipient_name, i.recipient_gstin, i.order_id, i.sale_id
       FROM invoices i
       LEFT JOIN sales s ON s.id = i.sale_id
      WHERE i.order_id = $1 OR s.order_id = $1
      ORDER BY i.created_at`,
    [orderId])).rows;

(async () => {
  console.log(`\n=== the name on the bill, against ${DB} ===\n`);
  orderSale.resetSaleLink();
  partyService.resetPartyLink();

  // ---------------------------------------------------------------
  console.log("A shop order, billed from the sale");
  // ---------------------------------------------------------------
  const seller = await makeSeller();
  const asSeller = { user: { id: seller, role: "seller" }, business: { id: seller, owner: true } };
  const buyer = await makeBuyer("Kishan Cloth House");
  const stock = await makeListing(seller);

  const orderId = await placeOrder(buyer, stock.product, stock.listing, "Kishan Kumar");
  check(Boolean(orderId), "the order is placed", { orderId: Boolean(orderId) });

  const party = (await testPool.query(
    "SELECT * FROM parties WHERE wholesaler_id = $1", [seller])).rows[0];
  check(
    party.business_name === "Kishan Cloth House",
    "the customer's firm reaches their page in the book",
    { got: party.business_name, was: null },
  );
  check(
    party.gstin === BUYER_GSTIN,
    "and so does their GST number",
    { got: party.gstin, why: "without it their customer loses the input credit" },
  );
  check(
    party.name === "Kishan Kumar",
    "the person on the delivery address is still the contact",
    { got: party.name },
  );

  const sale = await accept(orderId);
  // Checkout raises its invoice in the background, so make sure it has
  // happened before billing the sale. Idempotent either way.
  await invoiceService.createInvoiceFromOrder(orderId).catch(() => {});
  const billed = await call(sales.createInvoiceForSale, { ...asSeller, params: { id: sale.id } });
  check(billed.statusCode === 200 || billed.statusCode === 201, "the sale can be billed", {
    s: billed.statusCode,
  });

  const rows = await invoicesFor(orderId);
  check(rows.length === 1, "one lot of goods, one invoice", {
    got: rows.length,
    numbers: rows.map((r) => r.invoice_number),
    was: 2,
  });
  check(
    rows[0]?.order_id && rows[0]?.sale_id,
    "reachable from the order and from the sale",
    { order: Boolean(rows[0]?.order_id), sale: Boolean(rows[0]?.sale_id) },
  );
  check(
    rows[0]?.recipient_name === "Kishan Cloth House",
    "addressed to the firm, which is who a tax invoice is for",
    { got: rows[0]?.recipient_name, was: "Kishan Kumar" },
  );
  check(
    rows[0]?.recipient_gstin === BUYER_GSTIN,
    "with their GST number frozen onto it",
    { got: rows[0]?.recipient_gstin, was: null },
  );

  // The two screens, read the way they are read.
  const orderList = await call(orders.getSupplierOrders, asSeller);
  const invoiceList = await call(invoices.getInvoices, { ...asSeller, query: {} });
  const shownOnOrder = orderList.body?.[0]?.buyer;
  const invRows = invoiceList.body?.invoices || invoiceList.body?.data || invoiceList.body;
  const shownOnInvoice = (Array.isArray(invRows) ? invRows : [])[0]?.buyer_name;
  check(
    shownOnOrder === shownOnInvoice,
    "the Orders tab and the Invoices tab agree",
    { orders: shownOnOrder, invoices: shownOnInvoice },
  );

  // ---------------------------------------------------------------
  console.log("\nThe other way round: the sale is billed first");
  // ---------------------------------------------------------------
  const buyer2 = await makeBuyer("Bansal Traders");
  const stock2 = await makeListing(seller);
  const order2 = await placeOrder(buyer2, stock2.product, stock2.listing, "Anil Bansal");
  const sale2 = await accept(order2);

  const first = await call(sales.createInvoiceForSale, { ...asSeller, params: { id: sale2.id } });
  check(first.statusCode === 200 || first.statusCode === 201, "billed from the sale first", {
    s: first.statusCode,
  });
  // Now the order's background invoice arrives late, which is the ordering
  // that used to produce the second document.
  await invoiceService.createInvoiceFromOrder(order2).catch(() => {});

  const rows2 = await invoicesFor(order2);
  check(rows2.length === 1, "still one invoice", {
    got: rows2.length,
    numbers: rows2.map((r) => r.invoice_number),
  });
  check(
    rows2[0]?.order_id && rows2[0]?.sale_id,
    "and the late caller linked itself to the one that exists",
    { order: Boolean(rows2[0]?.order_id), sale: Boolean(rows2[0]?.sale_id) },
  );
  check(
    rows2[0]?.recipient_name === "Bansal Traders",
    "addressed to the firm either way",
    { got: rows2[0]?.recipient_name },
  );

  // ---------------------------------------------------------------
  console.log("\nThe wholesaler's own book is never talked over");
  // ---------------------------------------------------------------
  const buyer3 = await makeBuyer("Shree Fabrics Pvt Ltd");
  const phone3 = `97${uniq().slice(-8)}`;
  // They already had this man in their diary, under their own name for them.
  const kept = (await testPool.query(
    `INSERT INTO parties (wholesaler_id, name, business_name, phone, notes)
     VALUES ($1,'Munna bhai','Shree Fabrics',$2,'Always wants 60 days')
     RETURNING *`, [seller, phone3])).rows[0];

  const stock3 = await makeListing(seller);
  await call(orders.createOrder, {
    user: { id: buyer3, role: "both" },
    body: {
      products: [{ productId: stock3.product, inventoryId: stock3.listing, quantity: 5 }],
      deliveryAddress: {
        name: "Someone Else", phone: phone3, street: "Ring Road",
        city: "Surat", state: "Gujarat", pincode: "395002",
      },
      paymentPlan: "full",
    },
  });

  const after = (await testPool.query("SELECT * FROM parties WHERE id = $1", [kept.id])).rows[0];
  const partyCount = (await testPool.query(
    `SELECT COUNT(*)::int AS n FROM parties
      WHERE wholesaler_id = $1 AND right(regexp_replace(phone,'\\D','','g'),10) = $2`,
    [seller, phone3.slice(-10)])).rows[0].n;
  check(partyCount === 1, "the order finds the man they already had", { got: partyCount });
  check(after.name === "Munna bhai", "their own name for them is untouched", { got: after.name });
  check(
    after.business_name === "Shree Fabrics",
    "and so is the firm they wrote themselves",
    { got: after.business_name, note: "the account says Shree Fabrics Pvt Ltd" },
  );
  check(after.notes === "Always wants 60 days", "and their private note survives", {
    got: after.notes,
  });
  check(
    after.gstin === BUYER_GSTIN,
    "but the blank GST number is filled in, because a blank helps nobody",
    { got: after.gstin },
  );
  check(String(after.user_id) === String(buyer3), "and the diary entry gains its account");

  // ---------------------------------------------------------------
  console.log("\nA customer with no firm keeps their own name");
  // ---------------------------------------------------------------
  const plain = await makeBuyer(null);
  const stock4 = await makeListing(seller);
  const order4 = await placeOrder(plain, stock4.product, stock4.listing, "Ravi Sharma");
  const sale4 = await accept(order4);
  await invoiceService.createInvoiceFromOrder(order4).catch(() => {});
  await call(sales.createInvoiceForSale, { ...asSeller, params: { id: sale4.id } });

  const rows4 = await invoicesFor(order4);
  check(
    rows4[0]?.recipient_name === "Ravi Sharma",
    "the person, because there is no firm to use",
    { got: rows4[0]?.recipient_name },
  );
  check(
    rows4[0]?.recipient_gstin === null,
    "and no GST number is invented for them",
    { got: rows4[0]?.recipient_gstin },
  );

  console.log(`\n${fails === 0 ? "all good" : `${fails} FAILED`}\n`);
  await testPool.end();
  process.exit(fails === 0 ? 0 : 1);
})().catch((err) => {
  console.error("THREW", err);
  process.exit(1);
});

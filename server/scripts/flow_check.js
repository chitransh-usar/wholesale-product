/**
 * One order, all the way through, and everybody's numbers agreeing at the end.
 *
 * Every other suite here takes one seam and leans on it. This one walks the
 * whole thing in order, the way it actually happens, and checks after every
 * step that the screens a wholesaler looks at still say the same thing as one
 * another:
 *
 *   a wholesaler lists stock            -> it is in the catalogue
 *   a retailer finds it and orders      -> stock is reserved, a customer
 *                                          appears in the khata, the order is
 *                                          on the seller's Orders tab
 *   they pay half                        -> the khata, the order and the
 *                                          Overview all say the same half
 *   the seller accepts                  -> a sale is written, and the debt is
 *                                          counted once, not twice
 *   goods go out on a challan           -> because the money is not all in
 *   packed, sent, delivered             -> the sale follows the order
 *   the rest of the money arrives       -> the bill raises itself, the
 *                                          challans point at it, the customer
 *                                          owes nothing
 *   they send it back                    -> the sale is cancelled, a credit
 *                                          note reverses the bill, and the
 *                                          khata comes back to where it began
 *
 * The point is the agreement, not the steps. A number that is right on the
 * customer page and wrong on the Overview is the failure this is looking for,
 * and that class of bug is exactly what has actually shipped here before.
 *
 *     node scripts/flow_check.js <database>
 */
const Module = require("module");
const { Pool } = require("pg");

const DB = process.argv[2] || "qa_flow";
const dbPath = require.resolve("../src/config/db");
const testPool = new Pool({ connectionString: `postgres://postgres@127.0.0.1:5433/${DB}` });
const stub = new Module(dbPath, null);
stub.exports = testPool;
stub.loaded = true;
require.cache[dbPath] = stub;

const products = require("../src/controllers/productController");
const orders = require("../src/controllers/orderController");
const sales = require("../src/controllers/saleController");
const parties = require("../src/controllers/partyController");
const invoices = require("../src/controllers/invoiceController");
const challans = require("../src/controllers/challanController");
const overview = require("../src/controllers/overviewController");
const dashboard = require("../src/controllers/dashboardController");
const challanService = require("../src/services/challanService");
const orderSale = require("../src/services/orderSaleService");
const partyService = require("../src/services/partyService");
const pdfService = require("../src/services/pdfService");
const invoiceRepository = require("../src/repositories/invoiceRepository");

const mk = () => {
  const r = { statusCode: 200, body: null, headers: {} };
  r.status = (c) => ((r.statusCode = c), r);
  r.json = (b) => ((r.body = b), r);
  r.setHeader = (k, v) => (r.headers[k] = v);
  return r;
};
const call = async (fn, req) => { const r = mk(); await fn(req, r); return r; };

let fails = 0;
const check = (cond, label, detail) => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"} ${String(label).padEnd(58)} ${JSON.stringify(detail ?? {})}`);
};

const uniq = () => String(Date.now()) + Math.floor(Math.random() * 1000);
const money = (n) => Number(Number(n || 0).toFixed(2));
const settle = () => new Promise((r) => setTimeout(r, 400));

(async () => {
  console.log(`\n=== one order, end to end, against ${DB} ===\n`);
  challanService.resetChallanTables();
  orderSale.resetSaleLink();
  partyService.resetPartyLink();

  // ---------------------------------------------------------------
  console.log("A wholesaler puts stock in the shop");
  // ---------------------------------------------------------------
  const seller = (await testPool.query(
    `INSERT INTO users (first_name,last_name,email,phone,password_hash,role)
     VALUES ('Ram','Textiles',$1,$2,'x','seller') RETURNING id`,
    [`ram+${uniq()}@flow.local`, `90${uniq().slice(-8)}`])).rows[0].id;
  await testPool.query(
    `INSERT INTO wholesaler_profiles
       (user_id, company_name, warehouse_state, warehouse_city, city, gstin, upi_id)
     VALUES ($1,'Ram Textiles','Gujarat','Surat','Surat','24AAACC1206D1ZM','ram@upi')`,
    [seller]);
  // `isOwner` is the key can() reads. With only `owner` set the Overview
  // withholds its money block, and every comparison against it passes on
  // undefined, which is a test that proves nothing.
  const asSeller = {
    user: { id: seller, role: "seller" },
    business: { id: seller, owner: true, isOwner: true },
  };

  const listed = await call(products.addProduct, {
    ...asSeller,
    body: {
      name: `Cotton shirting ${uniq()}`,
      category: "Fabric",
      description: "40s count, 58 inch",
      price: 142,
      moq: 10,
      stock: 100,
      unit: "mtr",
      shippingDays: 2,
      hsnCode: "5208",
      gstPercent: 5,
      visibility: "public",
    },
  });
  check(listed.statusCode === 201 || listed.statusCode === 200,
    "the listing is created", { s: listed.statusCode, m: listed.body?.message });

  const listing = (await testPool.query(
    `SELECT si.id, si.product_id, si.stock, p.name
       FROM supplier_inventory si JOIN products p ON p.id = si.product_id
      WHERE si.supplier_id = $1`, [seller])).rows[0];
  check(Boolean(listing), "and is on their shelf", { stock: listing?.stock });

  const shelf = await call(dashboard.getInventory, asSeller);
  check(
    (shelf.body?.inventory || shelf.body || []).length >= 1,
    "their Products tab shows it",
    { n: (shelf.body?.inventory || shelf.body || []).length },
  );

  // ---------------------------------------------------------------
  console.log("\nA retailer finds it in the catalogue");
  // ---------------------------------------------------------------
  const buyer = (await testPool.query(
    `INSERT INTO users (first_name,last_name,email,phone,password_hash,role)
     VALUES ('Kishan','Kumar',$1,$2,'x','buyer') RETURNING id`,
    [`kishan+${uniq()}@flow.local`, `97${uniq().slice(-8)}`])).rows[0].id;
  // Their trading details. An account can be "both", so the business name and
  // the GST number live on wholesaler_profiles even for someone who only
  // buys. Checkout reads them from there to fill in the khata, which is the
  // fix for the name mismatch a wholesaler reported: the Orders tab named them
  // one way and the Invoices tab another.
  await testPool.query(
    `INSERT INTO wholesaler_profiles (user_id, company_name, gstin, city)
     VALUES ($1,'Kishan Cloth House','27BBBBB1111B1ZX','Mumbai')`, [buyer]);
  const asBuyer = { user: { id: buyer, role: "buyer" } };

  const catalogue = await call(products.getPublicCatalog, { ...asBuyer, query: {} });
  const found = (catalogue.body?.products || catalogue.body || [])
    .find((p) => String(p.id).split("#")[0] === String(listing.product_id));
  check(Boolean(found), "the listing is in the public catalogue", {
    n: (catalogue.body?.products || catalogue.body || []).length,
  });

  // Private stock must not be reachable this way. One query that forgets the
  // filter leaks a wholesaler's off-catalogue pricing to everyone.
  // Its own product, because a wholesaler may list any one product once.
  const secretProduct = (await testPool.query(
    `INSERT INTO products (name, category) VALUES ($1,'Fabric') RETURNING id`,
    [`Mill seconds ${uniq()}`])).rows[0].id;
  const hidden = (await testPool.query(
    `INSERT INTO supplier_inventory
       (supplier_id, product_id, price, moq, stock, shipping_days, unit, visibility, status)
     VALUES ($1,$2,99,1,50,2,'mtr','private','Active') RETURNING id`,
    [seller, secretProduct])).rows[0].id;
  const again = await call(products.getPublicCatalog, { ...asBuyer, query: {} });
  const leaked =
    JSON.stringify(again.body || {}).includes(String(hidden)) ||
    JSON.stringify(again.body || {}).includes(String(secretProduct));
  check(!leaked, "and private stock is not", { why: "an unfiltered query leaks off-catalogue pricing" });

  // ---------------------------------------------------------------
  console.log("\nHe orders, paying half now");
  // ---------------------------------------------------------------
  const placed = await call(orders.createOrder, {
    ...asBuyer,
    body: {
      products: [{ productId: listing.product_id, inventoryId: listing.id, quantity: 10 }],
      deliveryAddress: {
        name: "Kishan Cloth House", street: "12 Ring Road", city: "Mumbai",
        state: "Maharashtra", pincode: "400002", phone: "9820011223",
      },
      paymentMethod: "upi",
      paymentPlan: "installment_50_50",
    },
  });
  check(placed.statusCode === 201, "the order is placed", {
    s: placed.statusCode, m: placed.body?.message,
  });
  const orderId = placed.body?.orderId;
  check(Boolean(orderId), "and has an id", { orderId });

  const orderRow = (await testPool.query(
    "SELECT * FROM orders WHERE id = $1", [orderId])).rows[0];
  check(money(orderRow.total_amount) === 1420, "for 1420", { total: orderRow.total_amount });

  const afterStock = (await testPool.query(
    "SELECT stock FROM supplier_inventory WHERE id = $1", [listing.id])).rows[0].stock;
  check(Number(afterStock) === 90, "ten metres are reserved off the shelf", {
    was: 100, now: afterStock,
  });

  check(Boolean(orderRow.party_id), "and the retailer is now a customer in the khata", {
    party: orderRow.party_id,
  });
  const partyRow = (await testPool.query(
    "SELECT * FROM parties WHERE id = $1", [orderRow.party_id])).rows[0];
  // The name mismatch that shipped: the khata got the delivery-address name
  // while the invoice got the account name, so two screens named one man
  // differently.
  check(
    partyRow.business_name === "Kishan Cloth House",
    "carrying their business name, not just the name on the parcel",
    { got: partyRow.business_name },
  );
  check(partyRow.gstin === "27BBBBB1111B1ZX",
    "and their GST number, which decides the tax on their bill",
    { got: partyRow.gstin });

  const sellerOrders = await call(orders.getSupplierOrders, asSeller);
  const onTab = (sellerOrders.body || []).find((o) => String(o.id) === String(orderId));
  check(Boolean(onTab), "it is on the seller's Orders tab");
  check(onTab?.buyer === "Kishan Cloth House", "named the way the khata names them", {
    got: onTab?.buyer,
  });

  // Half the money, through the real two step payment. The browser never
  // names an amount: the server opens a session and settles it.
  const session = await call(orders.initiatePayment, {
    ...asBuyer, params: { orderId }, body: { installment: 1 },
  });
  check(session.statusCode === 200, "a payment session opens", {
    s: session.statusCode, m: session.body?.message,
  });
  const settled1 = await call(orders.updatePaymentStatus, {
    ...asBuyer,
    params: { orderId },
    body: { paymentStatus: "paid", transactionId: session.body?.transactionId || `T${uniq()}` },
  });
  check(settled1.statusCode === 200, "and they declares they have paid the first half", {
    s: settled1.statusCode, m: settled1.body?.message,
  });
  await settle();

  const paidNow = money((await testPool.query(
    "SELECT amount_paid FROM orders WHERE id = $1", [orderId])).rows[0].amount_paid);
  check(paidNow === 710, "710 of 1420 has come in", { paid: paidNow });

  // ---------------------------------------------------------------
  console.log("\nEverybody's numbers agree, with the order half paid");
  // ---------------------------------------------------------------
  const khata = await call(parties.getPartyById, {
    ...asSeller, params: { id: orderRow.party_id },
  });
  const over1 = await call(overview.getOverview, asSeller);
  const owed = money(khata.body?.party?.outstanding ?? khata.body?.outstanding);
  check(owed === 710, "the customer page says they owe 710", { owed });
  check(
    money(over1.body?.money?.outstanding) === owed,
    "and the Overview says the same, not a different plausible number",
    { overview: over1.body?.money?.outstanding, khata: owed },
  );

  const statement = await call(parties.getPartyStatement, {
    ...asSeller, params: { id: orderRow.party_id }, query: {},
  });
  check(
    money(statement.body?.closingBalance) === owed,
    "and the statement closes on the same figure",
    { statement: statement.body?.closingBalance },
  );

  /**
   * The three figures on the Customers page header add up.
   *
   * They did not. Billed counted sales alone while "still to collect" counted
   * shop orders too, so an order not yet accepted read "Total billed 0" beside
   * "Still to collect 710": nothing billed, 710 to go and get. This is checked
   * here, before the seller accepts, because that is the state it went wrong
   * in.
   */
  const header = await call(parties.getPartyStats, asSeller);
  check(
    money(header.body?.totalBilled) === 1420,
    "the Customers header counts the shop order as billed",
    { billed: header.body?.totalBilled },
  );
  check(
    money(header.body?.totalBilled) - money(header.body?.totalReceived) ===
      money(header.body?.outstanding),
    "and its three figures make one sum, not two",
    {
      billed: header.body?.totalBilled,
      received: header.body?.totalReceived,
      outstanding: header.body?.outstanding,
    },
  );

  // ---------------------------------------------------------------
  console.log("\nThe seller accepts, and the debt is still counted once");
  // ---------------------------------------------------------------
  // Declaring the payment already moved it to payment_completed, so accepting
  // is the only step left for them.
  const beforeAccept = (await testPool.query(
    "SELECT status FROM orders WHERE id = $1", [orderId])).rows[0].status;
  check(beforeAccept === "payment_completed",
    "paying moved the order along on its own", { got: beforeAccept });
  const accepted = await call(orders.updateOrderStatus, {
    ...asSeller, params: { orderId }, body: { status: "supplier_accepted" },
  });
  check(accepted.statusCode === 200, "the seller accepts it", {
    s: accepted.statusCode, m: accepted.body?.message,
  });
  const sale = (await testPool.query(
    "SELECT * FROM sales WHERE order_id = $1", [orderId])).rows[0];
  check(Boolean(sale), "accepting wrote a sale into their book", { sale: sale?.sale_number });
  check(money(sale.total) === 1420, "for the same 1420 the customer agreed", {
    total: sale?.total,
  });

  /**
   * And their sales book agrees with the order about the money.
   *
   * A wholesaler reported the opposite: an order reading "all paid" whose
   * sale read "the whole amount still due". The money from a shop order
   * lands on orders.amount_paid, and nothing tags a party_payments row to
   * the sale, so any screen that added up party_payments alone answered
   * zero.
   */
  const saleList = await call(sales.listSales, { ...asSeller, query: {} });
  const saleRow = (saleList.body || []).find((r) => String(r.id) === String(sale.id));
  check(
    money(saleRow?.received) === 710,
    "the Sales list says 710 has come in against it, not nothing",
    { got: saleRow?.received, order: 710 },
  );
  const saleDetail = await call(sales.getSaleById, { ...asSeller, params: { id: sale.id } });
  check(
    money(saleDetail.body?.settlement?.received) === 710,
    "and so does the sale page, from the same figure the order shows",
    { got: saleDetail.body?.settlement?.received },
  );
  check(
    (saleDetail.body?.payments || []).length === 0,
    "even though no payment row is tagged to the sale",
    { n: (saleDetail.body?.payments || []).length,
      why: "the money came in through the shop, against the order" },
  );

  const khata2 = await call(parties.getPartyById, {
    ...asSeller, params: { id: orderRow.party_id },
  });
  check(
    money(khata2.body?.party?.outstanding ?? khata2.body?.outstanding) === 710,
    "and they still owes 710, not 1420 twice over",
    { owed: khata2.body?.party?.outstanding ?? khata2.body?.outstanding },
  );

  // ---------------------------------------------------------------
  console.log("\nGoods go out on a challan, whatever the money has done");
  // ---------------------------------------------------------------
  // Reversed 17 Sept. This used to expect code UNPAID: an unpaid sale was
  // refused its bill. Section 31(1) ties the invoice to removal of the goods,
  // not to payment, so the refusal understated outward supply in GSTR-1.
  const noBillYet = await call(sales.createInvoiceForSale, { ...asSeller, params: { id: sale.id } });
  check(noBillYet.statusCode === 200 || noBillYet.statusCode === 201,
    "the bill is raised even though money is still owed", {
    code: noBillYet.body?.code, outstanding: noBillYet.body?.outstanding,
  });

  const dc = await call(challans.createForOrder, {
    ...asSeller, params: { id: orderId }, body: {},
  });
  check(dc.statusCode === 201, "a delivery challan is made from the order screen", {
    s: dc.statusCode, number: dc.body?.challan_number,
  });
  check(
    money(dc.body?.total_value) === 1420 && money(dc.body?.amount_paid) === 710,
    "carrying the value of the goods and what has come in",
    { value: dc.body?.total_value, paid: dc.body?.amount_paid },
  );
  // No tax AMOUNT, which is the rule. gst_percent and cess_percent arrived on
  // 17 Sept carrying the rate the line WILL be billed at, so the sale form
  // does not have to be retyped off the challan. Nothing sums them and the
  // document still charges nothing.
  const dcTax = await testPool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'delivery_challan_items'
        AND column_name IN ('tax_amount', 'cess_amount', 'gst_amount')`);
  check(dcTax.rows.length === 0, "and nothing on it can charge tax", {
    columns: dcTax.rows.length,
  });

  const listRow = (await call(orders.getSupplierOrders, asSeller)).body
    .find((o) => String(o.id) === String(orderId));
  check(Number(listRow?.challan_count) === 1, "the orders list shows one challan against it", {
    got: listRow?.challan_count,
  });

  // ---------------------------------------------------------------
  console.log("\nPacked, sent, delivered: the sale follows the order");
  // ---------------------------------------------------------------
  for (const step of ["processing", "packed", "ready_for_pickup", "shipped",
                      "in_transit", "out_for_delivery", "delivered"]) {
    const moved = await call(orders.updateOrderStatus, {
      ...asSeller, params: { orderId }, body: { status: step },
    });
    if (moved.statusCode >= 400) {
      check(false, `could not move the order to ${step}`, { m: moved.body?.message });
    }
  }
  const delivered = (await testPool.query(
    `SELECT o.status AS order_status, o.actual_delivery_date, s.status AS sale_status
       FROM orders o LEFT JOIN sales s ON s.order_id = o.id WHERE o.id = $1`,
    [orderId])).rows[0];
  check(delivered.order_status === "delivered", "the order is delivered");
  check(delivered.sale_status === "delivered", "and so is the sale in their own book", {
    got: delivered.sale_status,
  });
  check(delivered.actual_delivery_date !== null,
    "with a date stamped, so the return window has something to count from");

  // ---------------------------------------------------------------
  console.log("\nThe rest of the money arrives, and the bill raises itself");
  // ---------------------------------------------------------------
  const session2 = await call(orders.initiatePayment, {
    ...asBuyer, params: { orderId }, body: { installment: 2 },
  });
  await call(orders.updatePaymentStatus, {
    ...asBuyer,
    params: { orderId },
    body: { paymentStatus: "paid", transactionId: session2.body?.transactionId || `T${uniq()}` },
  });
  await settle();

  const bill = (await testPool.query(
    `SELECT * FROM invoices WHERE order_id = $1 OR sale_id = $2`,
    [orderId, sale.id])).rows;
  check(bill.length === 1, "there is exactly one bill for these goods", {
    n: bill.length, number: bill[0]?.invoice_number,
    raisedBy: bill[0]?.order_id ? "the order" : "the sale",
  });
  check(money(bill[0]?.grand_total) === 1420,
    "for what they actually agreed to pay, not a recomputed figure",
    { total: bill[0]?.grand_total });
  check(bill[0]?.payment_status === "Paid", "stamped Paid", { got: bill[0]?.payment_status });

  // Maharashtra buying from Gujarat is interstate, so IGST and nothing else.
  check(
    money(bill[0]?.igst) > 0 && money(bill[0]?.cgst) === 0 && money(bill[0]?.sgst) === 0,
    "and charged IGST, because they are in another state",
    { igst: bill[0]?.igst, cgst: bill[0]?.cgst, sgst: bill[0]?.sgst },
  );
  check(bill[0]?.place_of_supply === "Maharashtra",
    "with the place of supply stored on the document",
    { got: bill[0]?.place_of_supply });

  const stampedChallans = await testPool.query(
    "SELECT invoice_id FROM delivery_challans WHERE sale_id = $1", [sale.id]);
  check(
    stampedChallans.rows.length === 1 && stampedChallans.rows.every((r) => r.invoice_id),
    "the challan points at the bill that superseded it",
    { stamped: stampedChallans.rows.filter((r) => r.invoice_id).length },
  );

  const listAfter = await call(sales.listSales, { ...asSeller, query: {} });
  const rowAfter = (listAfter.body || []).find((r) => String(r.id) === String(sale.id));
  check(
    money(rowAfter?.received) === 1420,
    "the Sales list now shows it fully paid, like the order does",
    { got: rowAfter?.received },
  );

  const khata3 = await call(parties.getPartyById, {
    ...asSeller, params: { id: orderRow.party_id },
  });
  check(
    money(khata3.body?.party?.outstanding ?? khata3.body?.outstanding) === 0,
    "and the customer owes nothing",
    { owed: khata3.body?.party?.outstanding ?? khata3.body?.outstanding },
  );

  const over2 = await call(overview.getOverview, asSeller);
  check(money(over2.body?.money?.outstanding) === 0,
    "the Overview agrees", { overview: over2.body?.money?.outstanding });

  const invoiceTab = await call(invoices.getInvoices.bind(invoices), { ...asSeller, query: {} });
  const shown = (invoiceTab.body?.invoices || []).find(
    (i) => String(i.id) === String(bill[0].id));
  check(Boolean(shown), "the bill is on their Invoices tab");
  check(
    (shown?.recipient_name || shown?.buyer_name) === "Kishan Cloth House",
    "named the same as the order and the khata name them",
    { invoice: shown?.recipient_name || shown?.buyer_name, order: onTab?.buyer },
  );

  const full = await invoiceRepository.findInvoiceById(bill[0].id);
  const pdf = await pdfService.generateInvoicePDF(full);
  check(pdf.length > 1000, "and it renders as a PDF", { bytes: pdf.length });

  // ---------------------------------------------------------------
  console.log("\nHe sends it back, and everything unwinds");
  // ---------------------------------------------------------------
  const asked = await call(orders.requestReturn, {
    ...asBuyer, params: { orderId }, body: { reason: "shade does not match" },
  });
  check(asked.statusCode === 200, "the buyer asks to return it", {
    s: asked.statusCode, m: asked.body?.message,
  });
  for (const step of ["return_approved", "return_completed"]) {
    const moved = await call(orders.updateOrderStatus, {
      ...asSeller, params: { orderId }, body: { status: step },
    });
    if (moved.statusCode >= 400) {
      check(false, `could not move the order to ${step}`, { m: moved.body?.message });
    }
  }

  const unwound = (await testPool.query(
    "SELECT status FROM sales WHERE id = $1", [sale.id])).rows[0];
  check(unwound.status === "cancelled", "the sale is written off", { got: unwound.status });

  const credit = (await testPool.query(
    "SELECT * FROM credit_notes WHERE invoice_id = $1", [bill[0].id])).rows[0];
  check(Boolean(credit), "and a credit note reverses the bill", {
    number: credit?.note_number,
  });
  check(money(credit?.grand_total) === 1420, "for the whole of it", {
    total: credit?.grand_total,
  });

  const stillThere = (await testPool.query(
    "SELECT invoice_number FROM invoices WHERE id = $1", [bill[0].id])).rows[0];
  check(Boolean(stillThere), "the original bill is not deleted", {
    why: "a document that has gone out cannot be unissued",
    number: stillThere?.invoice_number,
  });

  const refund = await call(orders.refundOrder, {
    ...asSeller, params: { orderId }, body: { amount: 1420, method: "upi", note: "returned" },
  });
  check(refund.statusCode === 200, "the money goes back", {
    s: refund.statusCode, m: refund.body?.message,
  });
  await settle();

  const khata4 = await call(parties.getPartyById, {
    ...asSeller, params: { id: orderRow.party_id },
  });
  const finalOwed = money(khata4.body?.party?.outstanding ?? khata4.body?.outstanding);
  check(finalOwed === 0, "and the khata is back to zero, not owing them money", {
    owed: finalOwed,
  });

  const over3 = await call(overview.getOverview, asSeller);
  check(money(over3.body?.money?.outstanding) === finalOwed,
    "the Overview still agrees with the customer page at the end",
    { overview: over3.body?.money?.outstanding, khata: finalOwed });

  console.log(`\n${fails === 0 ? "all good" : `${fails} FAILED`}\n`);
  await testPool.end();
  process.exit(fails === 0 ? 0 : 1);
})().catch((err) => {
  console.error("THREW", err);
  process.exit(1);
});

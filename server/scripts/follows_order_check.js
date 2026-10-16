/**
 * A sale written from a shop order follows that order.
 *
 * Accepting an order writes the same goods into the wholesaler's sales book,
 * so one lot of goods is now two rows in two tables. The question this suite
 * asks is which of them is in charge, and the answer has to be one of them.
 *
 * It used to be neither. The order had a 22 state lifecycle that stamps a
 * delivery date and opens the return window; the sale had its own plain
 * "Mark delivered" button that knew nothing about any of it. Whichever the
 * wholesaler pressed, the other one stayed where it was:
 *
 *   pressed on the order   the sale sat at "confirmed" for ever, so their own
 *                          book said they still owed the man their goods
 *   pressed on the sale    the order sat at "shipped" with no delivery date,
 *                          so the seven day return window had nothing to
 *                          count from
 *
 * The order lifecycle is now the authority and the sale mirrors it.
 *
 *     node scripts/follows_order_check.js <database>
 */
const Module = require("module");
const { Pool } = require("pg");

const DB = process.argv[2] || "qa_follows";
const dbPath = require.resolve("../src/config/db");
const testPool = new Pool({ connectionString: `postgres://postgres@127.0.0.1:5433/${DB}` });
const stub = new Module(dbPath, null);
stub.exports = testPool;
stub.loaded = true;
require.cache[dbPath] = stub;

const sales = require("../src/controllers/saleController");
const parties = require("../src/controllers/partyController");
const orderStatus = require("../src/services/orderStatusService");
const orderSale = require("../src/services/orderSaleService");
const partyService = require("../src/services/partyService");
const orderRoute = require("../src/controllers/orderController");

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

const makeUser = async (role, tag) => {
  const r = await testPool.query(
    `INSERT INTO users (first_name,last_name,email,phone,password_hash,role)
     VALUES ($1,'T',$2,$3,'x',$4) RETURNING id`,
    [tag, `${tag}+${uniq()}@follows.local`, `9${uniq().slice(-9)}`, role],
  );
  return r.rows[0].id;
};

/** An order in the state a wholesaler has just accepted it, plus its sale. */
const acceptedOrder = async (sellerId, buyerId, partyId) => {
  const listing = await testPool.query(
    `INSERT INTO products (name, category) VALUES ($1,'Fabric') RETURNING id`,
    [`Cotton shirting ${uniq()}`],
  );
  const inv = await testPool.query(
    `INSERT INTO supplier_inventory
       (supplier_id, product_id, price, moq, stock, shipping_days, unit, hsn_code, gst_percent)
     VALUES ($1,$2,142,1,100,2,'mtr','5208',5) RETURNING id`,
    [sellerId, listing.rows[0].id],
  );
  const order = await testPool.query(
    `INSERT INTO orders (buyer_id, supplier_id, party_id, inventory_item_id, quantity,
                         total_amount, subtotal, status, payment_status, order_number)
     VALUES ($1,$2,$3,$4,10,1420,1420,'supplier_accepted','paid',$5) RETURNING id`,
    [buyerId, sellerId, partyId, inv.rows[0].id, `ORD${uniq().slice(-10)}`],
  );
  const orderId = order.rows[0].id;
  await testPool.query(
    `INSERT INTO order_items (order_id, inventory_item_id, product_name, quantity, unit_price, total_price, moq)
     VALUES ($1,$2,'Cotton shirting',10,142,1420,1)`,
    [orderId, inv.rows[0].id],
  );

  const client = await testPool.connect();
  const sale = await orderSale.createSaleFromOrder(client, orderId);
  client.release();
  return { orderId, sale };
};

(async () => {
  console.log(`\n=== a sale follows its order, against ${DB} ===\n`);

  orderSale.resetSaleLink();
  const sellerId = await makeUser("seller", "ram");
  const buyerId = await makeUser("buyer", "kishan");
  await testPool.query(
    `INSERT INTO wholesaler_profiles (user_id, company_name, warehouse_state)
     VALUES ($1,'Ram Textiles','Gujarat')`,
    [sellerId],
  );
  const asOwner = { user: { id: sellerId }, business: { id: sellerId, owner: true } };

  partyService.resetPartyLink();
  const client0 = await testPool.connect();
  const party = await partyService.findOrCreateParty(client0, {
    wholesalerId: sellerId,
    userId: buyerId,
    name: "Kishan Cloth House",
    city: "Surat",
    phone: `98${uniq().slice(-8)}`,
  });
  client0.release();
  const partyId = party.id;

  // ---------------------------------------------------------------
  console.log("An accepted order writes a sale");
  // ---------------------------------------------------------------
  const { orderId, sale } = await acceptedOrder(sellerId, buyerId, partyId);
  check(Boolean(sale), "the sale exists", { sale: sale?.sale_number });
  check(sale?.status === "confirmed", "and starts confirmed", { got: sale?.status });
  check(String(sale?.order_id) === String(orderId), "linked to the order it came from");

  // ---------------------------------------------------------------
  console.log("\nThe sale has no switches of its own");
  // ---------------------------------------------------------------
  const byHand = await call(sales.updateSaleStatus, {
    ...asOwner,
    params: { id: sale.id },
    body: { status: "delivered" },
  });
  check(byHand.statusCode === 409, "marking it delivered by hand is refused", {
    s: byHand.statusCode,
    m: byHand.body?.message,
  });
  check(byHand.body?.code === "FOLLOWS_ORDER", "with a code the screen can act on");
  check(
    String(byHand.body?.orderId) === String(orderId),
    "and the order to go and press instead",
  );

  const cancelByHand = await call(sales.updateSaleStatus, {
    ...asOwner,
    params: { id: sale.id },
    body: { status: "cancelled" },
  });
  check(cancelByHand.statusCode === 409, "so is cancelling it from here", {
    s: cancelByHand.statusCode,
  });

  const editByHand = await call(sales.updateSale, {
    ...asOwner,
    params: { id: sale.id },
    body: { lines: [{ itemName: "Cotton shirting", quantity: 99, rate: 1 }] },
  });
  check(editByHand.statusCode === 409, "and so is retyping its amounts", {
    s: editByHand.statusCode,
    m: editByHand.body?.message,
    why: "the total is what the customer agreed at checkout",
  });

  const stillRight = await testPool.query("SELECT status, total FROM sales WHERE id = $1", [sale.id]);
  check(
    stillRight.rows[0].status === "confirmed" && Number(stillRight.rows[0].total) === 1420,
    "none of that changed the sale",
    { status: stillRight.rows[0].status, total: stillRight.rows[0].total },
  );

  // ---------------------------------------------------------------
  console.log("\nThe order is the switch");
  // ---------------------------------------------------------------
  for (const next of ["processing", "packed", "ready_for_pickup", "shipped", "in_transit", "out_for_delivery"]) {
    await orderStatus.updateOrderStatus(orderId, next, sellerId, "supplier");
  }
  const beforeDelivery = await testPool.query("SELECT status FROM sales WHERE id = $1", [sale.id]);
  check(
    beforeDelivery.rows[0].status === "confirmed",
    "the sale stays confirmed while the goods are on the way",
    { got: beforeDelivery.rows[0].status },
  );

  await orderStatus.updateOrderStatus(orderId, "delivered", sellerId, "supplier");
  const afterDelivery = await testPool.query("SELECT status FROM sales WHERE id = $1", [sale.id]);
  check(
    afterDelivery.rows[0].status === "delivered",
    "delivering the order delivers the sale",
    { got: afterDelivery.rows[0].status, was: "confirmed for ever" },
  );

  const stamped = await testPool.query(
    "SELECT actual_delivery_date, status FROM orders WHERE id = $1",
    [orderId],
  );
  check(
    stamped.rows[0].actual_delivery_date !== null,
    "and the delivery date is stamped, so the return window can count",
    { on: stamped.rows[0].actual_delivery_date },
  );

  /**
   * The same thing again, through the route the screens actually use.
   *
   * Everything above drives orderStatusService. The "Mark delivered" button
   * does not: it PATCHes /orders/:id/status, which writes the status itself.
   * The mirror lived only in the service, so in the running product the sale
   * sat at "confirmed" for ever and this suite said it did not, because it
   * was asking the half that was right. Both paths now share one helper and
   * both are checked here.
   */
  const viaRoute = await acceptedOrder(sellerId, buyerId, partyId);
  for (const next of ["processing", "packed", "ready_for_pickup", "shipped",
                      "in_transit", "out_for_delivery", "delivered"]) {
    const moved = await call(orderRoute.updateOrderStatus, {
      user: { id: sellerId, role: "seller" },
      business: { id: sellerId, owner: true },
      params: { orderId: viaRoute.orderId },
      body: { status: next },
    });
    if (moved.statusCode >= 400) {
      check(false, `the route could not move the order to ${next}`, { m: moved.body?.message });
      break;
    }
  }
  const routeSale = await testPool.query(
    "SELECT status FROM sales WHERE id = $1", [viaRoute.sale.id]);
  check(
    routeSale.rows[0].status === "delivered",
    "the button the screens press delivers the sale too",
    { got: routeSale.rows[0].status, was: "confirmed, because the mirror was only in the service" },
  );

  /**
   * And the route cannot kill an order behind the cancel handler's back.
   *
   * `cancelled` was a legal target here, so a status write could put an order
   * in the ground while its sale stood, its stock stayed reserved and its
   * customer kept owing. The screens use POST /cancel; the route allowed it,
   * which was enough.
   */
  const notKillable = await acceptedOrder(sellerId, buyerId, partyId);
  const killAttempt = await call(orderRoute.updateOrderStatus, {
    user: { id: sellerId, role: "seller" },
    business: { id: sellerId, owner: true },
    params: { orderId: notKillable.orderId },
    body: { status: "cancelled" },
  });
  check(
    killAttempt.statusCode === 400 && killAttempt.body?.code === "USE_DEDICATED_ROUTE",
    "the status route refuses to cancel, and says where to go",
    { s: killAttempt.statusCode, code: killAttempt.body?.code },
  );
  const survived = await testPool.query(
    "SELECT status FROM sales WHERE id = $1", [notKillable.sale.id]);
  check(
    survived.rows[0].status === "confirmed",
    "so the sale behind it is left standing rather than orphaned",
    { got: survived.rows[0].status },
  );

  // ---------------------------------------------------------------
  console.log("\nA cancelled sale is not quietly revived");
  // ---------------------------------------------------------------
  const second = await acceptedOrder(sellerId, buyerId, partyId);
  await testPool.query("UPDATE sales SET status = 'cancelled' WHERE id = $1", [second.sale.id]);
  for (const next of ["processing", "packed", "ready_for_pickup", "shipped", "in_transit", "out_for_delivery", "delivered"]) {
    await orderStatus.updateOrderStatus(second.orderId, next, sellerId, "supplier");
  }
  const stayed = await testPool.query("SELECT status FROM sales WHERE id = $1", [second.sale.id]);
  check(
    stayed.rows[0].status === "cancelled",
    "a written off sale stays written off",
    { got: stayed.rows[0].status, why: "that is a person's decision to look at, not one to paper over" },
  );

  // ---------------------------------------------------------------
  console.log("\nA sale they typed themselves still has its own switches");
  // ---------------------------------------------------------------
  const own = await call(parties.createParty, {
    ...asOwner,
    body: { name: "Walk in customer", city: "Surat", phone: `97${uniq().slice(-8)}` },
  });
  const typed = await call(sales.createSale, {
    ...asOwner,
    body: {
      partyId: own.body.id,
      status: "confirmed",
      lines: [{ itemName: "Dupatta", quantity: 12, unit: "pcs", rate: 90 }],
    },
  });
  check(typed.statusCode === 201, "they records one by hand", { s: typed.statusCode });

  const moved = await call(sales.updateSaleStatus, {
    ...asOwner,
    params: { id: typed.body.id },
    body: { status: "delivered" },
  });
  check(moved.statusCode === 200, "and can mark it delivered", { s: moved.statusCode });
  check(moved.body?.status === "delivered", "which takes effect", { got: moved.body?.status });

  const edited = await call(sales.updateSale, {
    ...asOwner,
    params: { id: typed.body.id },
    body: { lines: [{ itemName: "Dupatta", quantity: 14, unit: "pcs", rate: 90 }] },
  });
  check(edited.statusCode === 200, "and edit it", { s: edited.statusCode, total: edited.body?.total });

  // ---------------------------------------------------------------
  console.log("\nThe sale page can tell which kind it is");
  // ---------------------------------------------------------------
  const shown = await call(sales.getSaleById, { ...asOwner, params: { id: sale.id } });
  check(shown.statusCode === 200, "the order backed sale loads", { s: shown.statusCode });
  check(Boolean(shown.body?.sale?.order_id), "carrying its order id, so the page can link to it");
  check(
    Boolean(shown.body?.sale?.order_number),
    "and the order number to show on the link",
    { got: shown.body?.sale?.order_number },
  );

  const shownTyped = await call(sales.getSaleById, { ...asOwner, params: { id: typed.body.id } });
  check(
    !shownTyped.body?.sale?.order_id,
    "a hand typed sale carries none, so it keeps its buttons",
  );

  console.log(`\n${fails === 0 ? "all good" : `${fails} FAILED`}\n`);
  await testPool.end();
  process.exit(fails === 0 ? 0 : 1);
})().catch((err) => {
  console.error("THREW", err);
  process.exit(1);
});

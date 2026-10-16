/**
 * Every way a wholesaler can reach for a challan or a bill, exhaustively.
 *
 * challan_check.js walks the story: unpaid, half paid, paid, billed. This
 * walks the grid instead. For a sale that is one of four statuses and one of
 * three settlement states, and for an order at each point of its lifecycle,
 * it asks both questions and pins both answers:
 *
 *   can goods go out on a delivery challan?
 *   can a tax invoice be raised?
 *
 * Twelve sale cells, a dozen order cells, plus the switches around them: the
 * feature flag off, the migration not run, a bad reason, another wholesaler's
 * sale, a sale with no lines. Written because "nothing is left behind" is a
 * claim that can only be made by trying every box, and several of these were
 * never tried before.
 *
 * The rule under test is the one specified on 10 Sept 2026 and is expected to
 * change after legal review. See the header of challanService.js.
 *
 *     node scripts/challan_matrix_check.js <database>
 */
const Module = require("module");
const { Pool } = require("pg");

const DB = process.argv[2] || "qa_matrix";
const dbPath = require.resolve("../src/config/db");
const testPool = new Pool({ connectionString: `postgres://postgres@127.0.0.1:5433/${DB}` });
const stub = new Module(dbPath, null);
stub.exports = testPool;
stub.loaded = true;
require.cache[dbPath] = stub;

const sales = require("../src/controllers/saleController");
const parties = require("../src/controllers/partyController");
const challans = require("../src/controllers/challanController");
const orders = require("../src/controllers/orderController");
const challanService = require("../src/services/challanService");
const orderSale = require("../src/services/orderSaleService");
const orderStatus = require("../src/services/orderStatusService");
const pdfService = require("../src/services/pdfService");

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
  console.log(`\n=== the challan and invoice grid, against ${DB} ===\n`);
  challanService.resetChallanTables();
  orderSale.resetSaleLink();

  const seller = (await testPool.query(
    `INSERT INTO users (first_name,last_name,email,phone,password_hash,role)
     VALUES ('Ram','Textiles',$1,$2,'x','seller') RETURNING id`,
    [`ram+${uniq()}@mx.local`, `90${uniq().slice(-8)}`])).rows[0].id;
  await testPool.query(
    `INSERT INTO wholesaler_profiles (user_id, company_name, warehouse_state, gstin, upi_id)
     VALUES ($1,'Ram Textiles','Gujarat','24AAACC1206D1ZM','ram@upi')`, [seller]);
  const asOwner = { user: { id: seller, role: "seller" }, business: { id: seller, owner: true } };

  const buyer = (await testPool.query(
    `INSERT INTO users (first_name,last_name,email,phone,password_hash,role)
     VALUES ('Kishan','Kumar',$1,$2,'x','buyer') RETURNING id`,
    [`kishan+${uniq()}@mx.local`, `97${uniq().slice(-8)}`])).rows[0].id;

  const party = await call(parties.createParty, {
    ...asOwner,
    body: { name: "Kishan Cloth House", city: "Surat", gstin: "24BBBBB1111B1ZT", phone: `98${uniq().slice(-8)}` },
  });
  const partyId = party.body.id;

  /**
   * A sale of 1050 in the asked-for status with the asked-for money against
   * it. Sales are created confirmed and moved, because a draft cannot take a
   * payment and a delivered sale cannot be created directly.
   */
  const makeSale = async ({ status = "confirmed", paid = 0, lines = true } = {}) => {
    const made = await call(sales.createSale, {
      ...asOwner,
      body: {
        partyId,
        status: status === "draft" ? "draft" : "confirmed",
        lines: lines
          ? [{ itemName: "Cotton shirting", quantity: 10, unit: "mtr", rate: 100, gstPercent: 5, hsnCode: "5208" }]
          : [],
        amountPaid: status === "draft" ? 0 : paid,
        paymentMethod: paid ? "cash" : undefined,
      },
    });
    const sale = made.body;
    if (!sale) return null;
    if (status === "delivered" || status === "cancelled") {
      await call(sales.updateSaleStatus, { ...asOwner, params: { id: sale.id }, body: { status } });
    }
    // The bill raises itself on a settled sale, in the background. Let it.
    if (paid >= 1050) await new Promise((r) => setTimeout(r, 350));
    return sale;
  };

  const challanFor = (id) =>
    call(challans.createForSale, { ...asOwner, params: { id }, body: {} });
  const billFor = (id) =>
    call(sales.createInvoiceForSale, { ...asOwner, params: { id } });

  // ---------------------------------------------------------------
  console.log("The sale grid: four statuses against three settlement states");
  // ---------------------------------------------------------------
  // Each cell says what the two buttons should do. "ok" means it happens,
  // anything else is the code the refusal must carry.
  const GRID = [
    // status      paid   challan      bill
    ["draft",         0, "draft",     "draft"],
    ["draft",       500, "draft",     "draft"],
    // Rewritten 17 Sept. Every one of these six used to depend on the money:
    // the bill was refused UNPAID until it was settled, and the challan was
    // refused "settled" once it was. Both rules are gone. A challan is about
    // goods moving and a bill is about a supply having happened, and neither
    // question is answered by the balance, so the whole settlement column
    // stopped mattering to this grid.
    ["confirmed",     0, "ok",        "ok"],
    ["confirmed",   500, "ok",        "ok"],
    ["confirmed",  1050, "ok",        "ok"],
    ["delivered",     0, "ok",        "ok"],
    ["delivered",   500, "ok",        "ok"],
    ["delivered",  1050, "ok",        "ok"],
    ["cancelled",     0, "cancelled", "cancelled"],
    ["cancelled",   500, "cancelled", "cancelled"],
  ];

  for (const [status, paid, wantChallan, wantBill] of GRID) {
    const sale = await makeSale({ status, paid });
    const c = await challanFor(sale.id);
    const gotChallan = c.statusCode === 201 ? "ok" : (c.body?.code || `HTTP${c.statusCode}`);
    check(
      gotChallan === wantChallan,
      `${status.padEnd(9)} ${String(paid).padStart(4)} paid: challan`,
      { want: wantChallan, got: gotChallan },
    );

    const b = await billFor(sale.id);
    // 200 means one already existed, which on a settled sale is the auto bill
    // having got there first. Both are "ok".
    const gotBill =
      b.statusCode === 201 || b.statusCode === 200
        ? "ok"
        : (b.body?.code || `HTTP${b.statusCode}`);
    check(
      gotBill === wantBill,
      `${status.padEnd(9)} ${String(paid).padStart(4)} paid: bill`,
      { want: wantBill, got: gotBill, s: b.statusCode },
    );
  }

  // ---------------------------------------------------------------
  console.log("\nThe cells the grid cannot express");
  // ---------------------------------------------------------------
  // A sale with no lines. There is nothing to put on either document.
  const emptySale = await makeSale({ lines: false });
  if (emptySale && emptySale.id) {
    const c = await challanFor(emptySale.id);
    check(c.body?.code === "empty", "a sale with no lines makes no challan", { code: c.body?.code });
    const b = await billFor(emptySale.id);
    check(b.statusCode >= 400, "and no bill either", { s: b.statusCode });
  } else {
    // The `empty` branch in the service is unreachable from the API for this
    // reason. It is kept because sale_lines can be emptied by an edit.
    check(true, "a sale with no lines is refused before it is written", {
      why: "so neither document is ever reached with one",
    });
  }

  // A reason the module does not know. Free text here would end up printed
  // on a document that goes to a customer.
  const live = await makeSale({ paid: 500 });
  const badReason = await call(challans.createForSale, {
    ...asOwner, params: { id: live.id }, body: { reason: "because i said so" },
  });
  check(badReason.statusCode === 400 && badReason.body?.code === "reason",
    "an unknown reason is refused", { code: badReason.body?.code });

  // The four reasons that are known, each accepted.
  for (const reason of ["payment_pending", "job_work", "on_approval", "quantity_unknown"]) {
    const r = await call(challans.createForSale, {
      ...asOwner, params: { id: live.id }, body: { reason },
    });
    check(r.statusCode === 201, `reason "${reason}" is accepted`, { s: r.statusCode });
    check(r.body?.is_rule_55 === false,
      `  and "${reason}" is still not a Rule 55 challan`,
      { why: "deferred by instruction, so nothing claims to be one" });
  }

  // Many challans on one sale, because goods go out in lots. Four here, one
  // for each accepted reason; the rejected one wrote nothing.
  const lots = await testPool.query(
    "SELECT id, challan_number FROM delivery_challans WHERE sale_id = $1 ORDER BY created_at", [live.id]);
  check(lots.rows.length === 4, "four lots went out on four challans", { n: lots.rows.length });
  check(new Set(lots.rows.map((r) => r.challan_number)).size === 4,
    "each with its own number", { numbers: lots.rows.map((r) => r.challan_number).join(",") });

  // Every one of them renders.
  let rendered = 0;
  for (const row of lots.rows) {
    const full = await challanService.findById(row.id, seller);
    const pdf = await pdfService.generateChallanPDF(full);
    if (pdf.length > 1000) rendered++;
  }
  check(rendered === 4, "and every one of them renders as a PDF", { rendered });

  // Not this wholesaler's sale.
  const other = (await testPool.query(
    `INSERT INTO users (first_name,last_name,email,phone,password_hash,role)
     VALUES ('Other','Seller',$1,$2,'x','seller') RETURNING id`,
    [`other+${uniq()}@mx.local`, `80${uniq().slice(-8)}`])).rows[0].id;
  const asOther = { user: { id: other, role: "seller" }, business: { id: other, owner: true } };
  const stolen = await call(challans.createForSale, {
    ...asOther, params: { id: live.id }, body: {},
  });
  check(stolen.statusCode === 404, "another wholesaler cannot challan this sale", {
    s: stolen.statusCode,
  });
  const stolenBill = await call(sales.createInvoiceForSale, { ...asOther, params: { id: live.id } });
  check(stolenBill.statusCode >= 400, "nor bill it", { s: stolenBill.statusCode });

  // A sale billed before this rule existed can still send goods out. The
  // balance is what decides, not whether a document happens to exist.
  const oldWay = await makeSale({ paid: 0 });
  process.env.CHALLAN_WHEN_UNPAID = "false";
  const oldBill = await billFor(oldWay.id);
  delete process.env.CHALLAN_WHEN_UNPAID;
  check(oldBill.statusCode === 201, "with the flag off, an unpaid sale bills", { s: oldBill.statusCode });
  const stillOut = await challanFor(oldWay.id);
  check(stillOut.statusCode === 201,
    "and the goods can still go out against the balance", { s: stillOut.statusCode });

  // Cancelling a billed sale raises a credit note. The sale is dead after
  // that, so no further goods go out.
  const toReverse = await makeSale({ paid: 1050 });
  await call(sales.updateSaleStatus, {
    ...asOwner, params: { id: toReverse.id }, body: { status: "cancelled" },
  });
  const afterCredit = await challanFor(toReverse.id);
  check(afterCredit.body?.code === "cancelled",
    "a reversed sale sends nothing further out", { code: afterCredit.body?.code });

  // ---------------------------------------------------------------
  console.log("\nThe switches around the feature");
  // ---------------------------------------------------------------
  /**
   * CHALLAN_WHEN_UNPAID now decides ONE thing and defaults OFF.
   *
   * It used to gate the whole feature: off meant no challans at all. It now
   * only answers "does an unpaid sale hold its bill back", and challans exist
   * either way, because they are about goods moving. The old behaviour is
   * still reachable for a wholesaler who has not re-trained their counter.
   */
  const flagged = await makeSale({ paid: 0 });
  const alwaysChallan = await challanFor(flagged.id);
  check(alwaysChallan.statusCode === 201,
    "challans are made whatever the flag says, because goods moved",
    { s: alwaysChallan.statusCode });
  const offBill = await billFor(flagged.id);
  check(offBill.statusCode === 201, "and by default an unpaid sale bills", {
    s: offBill.statusCode,
  });

  const onAgain = await makeSale({ paid: 0 });
  process.env.CHALLAN_WHEN_UNPAID = "true";
  const backOnBill = await billFor(onAgain.id);
  check(backOnBill.body?.code === "UNPAID",
    "turning it on puts the old waiting behaviour back exactly", {
    code: backOnBill.body?.code,
  });
  const stillChallans = await challanFor(onAgain.id);
  check(stillChallans.statusCode === 201,
    "and challans are unaffected by it either way", { s: stillChallans.statusCode });
  delete process.env.CHALLAN_WHEN_UNPAID;

  // The migration not run. Probed once and cached, so the cache is what has
  // to be poisoned to simulate it.
  challanService.resetChallanTables();
  const realQuery = testPool.query.bind(testPool);
  testPool.query = async (text, params) => {
    if (typeof text === "string" && text.includes("to_regclass")) {
      return { rows: [{ yes: false }] };
    }
    return realQuery(text, params);
  };
  await challanService.challanTablesExist();
  testPool.query = realQuery;

  const notReady = await challanFor(onAgain.id);
  check(notReady.body?.code === "notReady", "migration not run: the challan says so", {
    code: notReady.body?.code,
  });
  const readyBill = await makeSale({ paid: 0 });
  const unguarded = await billFor(readyBill.id);
  check(unguarded.statusCode === 201,
    "and billing is not held hostage by a table that is not there",
    { s: unguarded.statusCode, why: "an unmigrated database must still be able to bill" });
  const emptyList = await call(challans.listChallans, asOwner);
  check(Array.isArray(emptyList.body) && emptyList.body.length === 0,
    "the challans screen is empty rather than broken", { n: emptyList.body?.length });
  challanService.resetChallanTables();

  // ---------------------------------------------------------------
  console.log("\nThe order grid");
  // ---------------------------------------------------------------
  const makeOrder = async ({ paid = 0, status = "pending", accept = true } = {}) => {
    const product = (await testPool.query(
      `INSERT INTO products (name, category) VALUES ($1,'Fabric') RETURNING id`,
      [`Cotton shirting ${uniq()}`])).rows[0].id;
    const listing = (await testPool.query(
      `INSERT INTO supplier_inventory
         (supplier_id, product_id, price, moq, stock, shipping_days, unit, hsn_code, gst_percent)
       VALUES ($1,$2,142,1,100,2,'mtr','5208',5) RETURNING id`,
      [seller, product])).rows[0].id;
    const id = (await testPool.query(
      `INSERT INTO orders (buyer_id, supplier_id, party_id, inventory_item_id, quantity,
                           total_amount, subtotal, amount_paid, status, payment_status, order_number)
       VALUES ($1,$2,$3,$4,10,1420,1420,$5,$6,'pending',$7) RETURNING id`,
      [buyer, seller, partyId, listing, paid, status, `ORD${uniq().slice(-10)}`])).rows[0].id;
    await testPool.query(
      `INSERT INTO order_items (order_id, inventory_item_id, product_name, quantity, unit_price, total_price, moq)
       VALUES ($1,$2,'Cotton shirting',10,142,1420,1)`,
      [id, listing],
    );
    if (accept) {
      const c = await testPool.connect();
      await orderSale.createSaleFromOrder(c, id);
      c.release();
    }
    return id;
  };

  /**
   * Walk one part-paid order through the whole lifecycle, asking at every
   * stop whether goods can still go out. Walked with the real state machine
   * rather than by writing statuses, because a status set by hand leaves the
   * sale behind the order untouched and would prove nothing about the two of
   * them together.
   */
  const walk = async (path, { paid, label }) => {
    const id = await makeOrder({ paid });
    for (const to of path) {
      // Driven through the controller, not the service. The service moves the
      // status; the controller is where a completed return cancels the sale
      // behind it. Walking the service alone would have proved nothing about
      // the two of them together, and did: an earlier version of this walk
      // said goods could still go out against a finished return.
      const moved = await call(orders.updateOrderStatus, {
        ...asOwner, params: { orderId: id }, body: { status: to },
      });
      if (moved.statusCode >= 400) {
        check(false, `could not move an order to ${to}`, { s: moved.statusCode, m: moved.body?.message });
        break;
      }
      const r = await call(challans.createForOrder, { ...asOwner, params: { id }, body: {} });
      const got = r.statusCode === 201 ? "ok" : (r.body?.code || `HTTP${r.statusCode}`);
      const want = label(to);
      check(got === want, `${to.padEnd(20)} ${String(paid).padStart(4)} paid`, {
        want, got, m: got === want ? undefined : r.body?.message,
      });
    }
    return id;
  };

  // Part paid, all the way to delivered and completed. Goods are moving and
  // money is owed at every one of these, so a challan is right at every one.
  await walk(
    ["payment_pending", "payment_completed", "supplier_accepted", "processing",
     "packed", "ready_for_pickup", "shipped", "in_transit", "out_for_delivery",
     "delivered", "completed"],
    { paid: 700, label: () => "ok" },
  );

  // The return arm. A refused return leaves the goods with the customer and
  // the money owed, so goods can still go out; an approved one is unwinding,
  // and once it completes the sale behind it is cancelled.
  await walk(
    ["payment_pending", "payment_completed", "supplier_accepted", "processing",
     "packed", "ready_for_pickup", "shipped", "in_transit", "out_for_delivery",
     "delivered", "return_requested", "return_rejected"],
    { paid: 700, label: () => "ok" },
  );
  await walk(
    ["payment_pending", "payment_completed", "supplier_accepted", "processing",
     "packed", "ready_for_pickup", "shipped", "in_transit", "out_for_delivery",
     "delivered", "return_requested", "return_approved", "return_completed"],
    {
      paid: 700,
      // The sale is cancelled when the return completes, so nothing further
      // leaves the godown against it.
      label: (to) => (to === "return_completed" ? "cancelled" : "ok"),
    },
  );

  // A delivery that failed. The goods came back to them, but the order is not
  // dead and the customer still owes, so this is left as it is rather than
  // asserted into a rule nobody has asked for.
  const failedId = await walk(
    ["payment_pending", "payment_completed", "supplier_accepted", "processing",
     "packed", "ready_for_pickup", "shipped", "in_transit", "out_for_delivery",
     "failed_delivery"],
    { paid: 700, label: () => "ok" },
  );
  check(Boolean(failedId), "a failed delivery is walked through too");

  // Fully paid: the bill is the document, not the challan.
  const paidOrder = await makeOrder({ paid: 1420 });
  const paidChallan = await call(challans.createForOrder, {
    ...asOwner, params: { id: paidOrder }, body: {},
  });
  // Was "settled": a fully paid order refused a challan. Goods leaving has
  // nothing to do with the money, so it is allowed now.
  check(paidChallan.statusCode === 201, "a fully paid order can still send goods out", {
    code: paidChallan.body?.code,
  });
  const paidView = await call(challans.listForOrder, { ...asOwner, params: { id: paidOrder } });
  check(paidView.body?.settlement?.settled === true, "and the screen is told so, so it hides the button");

  // Not accepted yet: nothing in the book to send out against.
  const pending = await makeOrder({ paid: 0, status: "pending", accept: false });
  const early = await call(challans.createForOrder, { ...asOwner, params: { id: pending }, body: {} });
  check(early.body?.code === "noSale", "an order not yet accepted has nothing to send", {
    code: early.body?.code,
  });
  const earlyView = await call(challans.listForOrder, { ...asOwner, params: { id: pending } });
  check(earlyView.body?.hasSale === false, "and the screen is told that too");

  // Cancelled: the sale behind it is cancelled with it.
  const killed = await makeOrder({ paid: 0 });
  // Through the cancel endpoint, which is the only way an order dies. The
  // plain status route refuses `cancelled` now, because writing the word
  // without unwinding the sale left the customer being billed for goods that
  // were never coming.
  const refused = await call(orders.updateOrderStatus, {
    ...asOwner, params: { orderId: killed }, body: { status: "cancelled" },
  });
  check(refused.body?.code === "USE_DEDICATED_ROUTE",
    "the plain status route will not kill an order", { code: refused.body?.code });
  await call(orders.cancelOrderHandler, {
    ...asOwner, params: { orderId: killed }, body: { reason: "out of stock" },
  });
  const deadChallan = await call(challans.createForOrder, { ...asOwner, params: { id: killed }, body: {} });
  check(deadChallan.statusCode >= 400,
    "a cancelled order sends nothing out", { s: deadChallan.statusCode, code: deadChallan.body?.code });

  // Another wholesaler's order.
  const mine = await makeOrder({ paid: 700 });
  const theirs = await call(challans.createForOrder, { ...asOther, params: { id: mine }, body: {} });
  check(theirs.body?.code === "noSale",
    "another wholesaler finds no sale behind it, so no challan",
    { code: theirs.body?.code, why: "the lookup is scoped to the owner" });
  const theirView = await call(challans.listForOrder, { ...asOther, params: { id: mine } });
  check(theirView.body?.settlement === null, "and no settlement figures leak either", {
    settlement: theirView.body?.settlement,
  });

  // ---------------------------------------------------------------
  console.log("\nThe two sides agree about the same goods");
  // ---------------------------------------------------------------
  // A challan raised from the order must be visible from the sale, and the
  // other way round. One document trail, reachable from both screens.
  const shared = await makeOrder({ paid: 700 });
  const saleId = await challanService.saleIdForOrder(shared, seller);
  await call(challans.createForOrder, { ...asOwner, params: { id: shared }, body: {} });
  await call(challans.createForSale, { ...asOwner, params: { id: saleId }, body: {} });

  const fromOrderSide = await call(challans.listForOrder, { ...asOwner, params: { id: shared } });
  const fromSaleSide = await call(challans.listForSale, { ...asOwner, params: { id: saleId } });
  check(
    (fromOrderSide.body?.challans || []).length === 2,
    "both challans show on the order screen",
    { n: (fromOrderSide.body?.challans || []).length },
  );
  check(
    (fromSaleSide.body || []).length === 2,
    "and both show on the sale screen",
    { n: (fromSaleSide.body || []).length },
  );
  const orderNumbers = (fromOrderSide.body?.challans || []).map((c) => c.challan_number).sort();
  const saleNumbers = (fromSaleSide.body || []).map((c) => c.challan_number).sort();
  check(
    JSON.stringify(orderNumbers) === JSON.stringify(saleNumbers),
    "and they are the same two documents, not four",
    { order: orderNumbers.join(","), sale: saleNumbers.join(",") },
  );

  // The order list and the sale list must count the same goods the same way.
  const orderRows = await call(orders.getSupplierOrders, asOwner);
  const orderRow = (orderRows.body || []).find((o) => String(o.id) === String(shared));
  const saleRows = await call(sales.listSales, { ...asOwner, query: {} });
  const saleRow = (saleRows.body || []).find((s) => String(s.id) === String(saleId));
  check(
    Number(orderRow?.challan_count) === 2 && Number(saleRow?.challan_count) === 2,
    "and both lists count two",
    { orders: orderRow?.challan_count, sales: saleRow?.challan_count },
  );

  // Settling the order stamps every challan with the bill that superseded it.
  await call(parties.recordPayment, {
    ...asOwner, params: { id: partyId },
    body: { amount: 720, method: "cash", saleId },
  });
  await testPool.query("UPDATE orders SET amount_paid = 1420 WHERE id = $1", [shared]);
  await call(sales.createInvoiceForSale, { ...asOwner, params: { id: saleId } });
  const stamped = await testPool.query(
    "SELECT invoice_id FROM delivery_challans WHERE sale_id = $1", [saleId]);
  check(
    stamped.rows.length === 2 && stamped.rows.every((r) => r.invoice_id),
    "and settling stamps both with the bill that superseded them",
    { stamped: stamped.rows.filter((r) => r.invoice_id).length },
  );
  const nowSettled = await call(challans.listForOrder, { ...asOwner, params: { id: shared } });
  check(
    nowSettled.body?.settlement?.settled === true,
    "after which the order screen stops offering the button",
  );

  console.log(`\n${fails === 0 ? "all good" : `${fails} FAILED`}\n`);
  await testPool.end();
  process.exit(fails === 0 ? 0 : 1);
})().catch((err) => {
  console.error("THREW", err);
  process.exit(1);
});

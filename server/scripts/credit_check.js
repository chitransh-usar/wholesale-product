/**
 * Money of a customer's that the wholesaler is holding, and spending it.
 *
 * Reported 11 Sept 2026, in the wholesaler's own words: they were owed nothing,
 * the customer paid them, and afterwards they owed the customer 2 lakh.
 *
 * The sequence, all of it arithmetically correct and all of it useless:
 *
 *   they return a 2 lakh order, not refunded    you owe them 2,00,000
 *   they orders 4 lakh, pays half                they owe 0
 *   they pay the other half                     you owe them 2,00,000
 *
 * The credit was never spent. The khata is one netted number per customer, so
 * billing them 4 lakh cancelled their 2 lakh of credit on the display, and
 * settling that bill uncovered it again. They were asked to pay the whole 4 lakh
 * while 2 lakh of their money sat in the till, because nothing in the product
 * could set a credit against an order, although two screens offered to.
 *
 * What has to hold:
 *   - the credit is found even while a new bill hides it in the balance
 *   - setting it against a bill spends it, and it cannot come back
 *   - the customer's balance does not move, because nothing happened between
 *     them: the same rupees are simply against different goods
 *   - the order stops asking them for money they have already handed over
 *   - it cannot be spent twice, cannot exceed what is owed, and cannot be put
 *     against another wholesaler's sale
 *
 *     node scripts/credit_check.js <database>
 */
const Module = require("module");
const { Pool } = require("pg");

const DB = process.argv[2] || "qa_credit";
const dbPath = require.resolve("../src/config/db");
const testPool = new Pool({ connectionString: `postgres://postgres@127.0.0.1:5433/${DB}` });
const stub = new Module(dbPath, null);
stub.exports = testPool;
stub.loaded = true;
require.cache[dbPath] = stub;

const orders = require("../src/controllers/orderController");
const products = require("../src/controllers/productController");
const parties = require("../src/controllers/partyController");
const sales = require("../src/controllers/saleController");
const creditService = require("../src/services/creditApplyService");
const orderSale = require("../src/services/orderSaleService");
const partyService = require("../src/services/partyService");

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
  console.log(`  ${cond ? "PASS" : "FAIL"} ${String(label).padEnd(58)} ${JSON.stringify(detail ?? {})}`);
};

const uniq = () => String(Date.now()) + Math.floor(Math.random() * 1000);
const money = (n) => Number(Number(n || 0).toFixed(2));
const wait = () => new Promise((r) => setTimeout(r, 600));

(async () => {
  console.log(`\n=== a customer's money, held and then spent, against ${DB} ===\n`);
  orderSale.resetSaleLink();
  partyService.resetPartyLink();

  const seller = (await testPool.query(
    `INSERT INTO users (first_name,last_name,email,phone,password_hash,role)
     VALUES ('Ram','Textiles',$1,$2,'x','seller') RETURNING id`,
    [`ram+${uniq()}@cr.local`, `90${uniq().slice(-8)}`])).rows[0].id;
  await testPool.query(
    `INSERT INTO wholesaler_profiles (user_id, company_name, warehouse_state, city)
     VALUES ($1,'Ram Textiles','Gujarat','Surat')`, [seller]);
  const asSeller = {
    user: { id: seller, role: "seller" },
    business: { id: seller, owner: true, isOwner: true },
    query: {},
  };

  const buyer = (await testPool.query(
    `INSERT INTO users (first_name,last_name,email,phone,password_hash,role)
     VALUES ('Kishan','Kumar',$1,$2,'x','buyer') RETURNING id`,
    [`kishan+${uniq()}@cr.local`, `97${uniq().slice(-8)}`])).rows[0].id;

  await call(products.addProduct, {
    ...asSeller,
    body: {
      name: `Cotton shirting ${uniq()}`, category: "Fabric", price: 1000,
      moq: 1, stock: 10000, unit: "mtr", shippingDays: 2, visibility: "public",
    },
  });
  const listing = (await testPool.query(
    "SELECT id, product_id FROM supplier_inventory WHERE supplier_id = $1", [seller])).rows[0];

  const place = async (qty, plan = "full") => (await call(orders.createOrder, {
    user: { id: buyer, role: "buyer" },
    body: {
      products: [{ productId: listing.product_id, inventoryId: listing.id, quantity: qty }],
      deliveryAddress: {
        name: "Kishan Cloth House", street: "12 Ring Road", city: "Surat",
        state: "Gujarat", pincode: "395002", phone: "9820011223",
      },
      paymentPlan: plan,
    },
  })).body.orderId;

  const pay = async (orderId, installment) => {
    const s = await call(orders.initiatePayment, {
      user: { id: buyer }, params: { orderId },
      body: installment ? { installment } : {},
    });
    return call(orders.updatePaymentStatus, {
      user: { id: buyer }, params: { orderId },
      body: { paymentStatus: "paid", transactionId: s.body?.transactionId || `T${uniq()}` },
    });
  };

  const move = async (orderId, steps) => {
    for (const to of steps) {
      await call(orders.updateOrderStatus, { ...asSeller, params: { orderId }, body: { status: to } });
    }
  };

  const balanceOf = async (partyId) => {
    const k = await call(parties.getPartyById, { ...asSeller, params: { id: partyId } });
    return money(k.body?.party?.outstanding ?? k.body?.outstanding ?? 0);
  };
  const saleRow = async (saleId) => {
    const list = await call(sales.listSales, { ...asSeller, query: {} });
    return (list.body || []).find((r) => String(r.id) === String(saleId));
  };

  // ---------------------------------------------------------------
  console.log("They return a 2 lakh order and is not refunded");
  // ---------------------------------------------------------------
  const first = await place(200);
  await pay(first);
  await wait();
  await move(first, ["supplier_accepted", "processing", "packed", "ready_for_pickup",
                     "shipped", "in_transit", "out_for_delivery", "delivered"]);
  await call(orders.requestReturn, {
    user: { id: buyer }, params: { orderId: first }, body: { reason: "shade does not match" },
  });
  await move(first, ["return_approved", "return_completed"]);
  await wait();

  const partyId = (await testPool.query(
    "SELECT party_id FROM orders WHERE id = $1", [first])).rows[0].party_id;

  check(await balanceOf(partyId) === -200000,
    "the customer page says the wholesaler owes them 2,00,000",
    { balance: await balanceOf(partyId) });

  const held = await creditService.offer(partyId, seller);
  check(held.credit === 200000, "and 2,00,000 of their money is loose", { credit: held.credit });
  check(held.targets.length === 0, "with nothing yet to set it against", { n: held.targets.length });

  // ---------------------------------------------------------------
  console.log("\nHe orders 4 lakh and pays the first half");
  // ---------------------------------------------------------------
  const second = await place(400, "installment_50_50");
  await pay(second, 1);
  await wait();
  await call(orders.updateOrderStatus, {
    ...asSeller, params: { orderId: second }, body: { status: "supplier_accepted" },
  });
  await wait();
  const sale = (await testPool.query(
    "SELECT id, sale_number FROM sales WHERE order_id = $1", [second])).rows[0];

  const netted = await balanceOf(partyId);
  check(netted === 0, "customer balance nets to zero, which is what misled the wholesaler", {
    balance: netted,
    why: "2 lakh held against 2 lakh owed, both real, neither visible",
  });

  const hidden = await creditService.offer(partyId, seller);
  check(hidden.credit === 200000,
    "but the 2,00,000 is still found, because it is real rows and not a balance",
    { credit: hidden.credit, balanceSays: netted });
  check(
    hidden.targets.length === 1 && hidden.targets[0].outstanding === 200000,
    "and the 4 lakh order is offered as something to set it against",
    { targets: hidden.targets.map((t) => `${t.saleNumber}:${t.outstanding}`) },
  );

  // ---------------------------------------------------------------
  console.log("\nThe wholesaler sets it against that order");
  // ---------------------------------------------------------------
  const applied = await call(parties.applyCredit, {
    ...asSeller, params: { id: partyId }, body: { saleId: sale.id },
  });
  check(applied.statusCode === 200, "the credit is set", {
    s: applied.statusCode, m: applied.body?.message,
  });
  check(money(applied.body?.applied) === 200000, "for the whole 2,00,000", {
    applied: applied.body?.applied,
  });
  check(money(applied.body?.creditLeft) === 0, "and none of it is left over");
  await wait();

  check(await balanceOf(partyId) === 0,
    "customer balance has not moved, because nothing happened between the two of them",
    { balance: await balanceOf(partyId) });

  const row = await saleRow(sale.id);
  check(money(row?.received) === 400000, "the 4 lakh sale now reads as fully received", {
    received: row?.received,
  });

  const askedFor = money((await testPool.query(
    "SELECT total_amount - COALESCE(amount_paid,0) AS n FROM orders WHERE id = $1",
    [second])).rows[0].n);
  check(askedFor === 0,
    "and the order stops asking them for money they have already handed over",
    { stillAsks: askedFor, was: 200000 });

  const noMore = await creditService.offer(partyId, seller);
  check(noMore.credit === 0, "the credit is spent and cannot come back", {
    credit: noMore.credit,
  });

  const timeline = await testPool.query(
    "SELECT remarks FROM order_status_history WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1",
    [second]);
  check(
    /already held/i.test(String(timeline.rows[0]?.remarks || "")),
    "the order's history says where the money came from",
    { remark: timeline.rows[0]?.remarks },
  );

  // ---------------------------------------------------------------
  console.log("\nIt cannot be spent twice, or on the wrong thing");
  // ---------------------------------------------------------------
  const again = await call(parties.applyCredit, {
    ...asSeller, params: { id: partyId }, body: { saleId: sale.id },
  });
  check(again.body?.code === "noCredit", "a second go finds nothing left", {
    code: again.body?.code,
  });

  const noTarget = await call(parties.applyCredit, {
    ...asSeller, params: { id: partyId }, body: {},
  });
  check(noTarget.statusCode === 400, "it must name what to set it against", {
    s: noTarget.statusCode,
  });

  // Another wholesaler's sale.
  const other = (await testPool.query(
    `INSERT INTO users (first_name,last_name,email,phone,password_hash,role)
     VALUES ('Other','Seller',$1,$2,'x','seller') RETURNING id`,
    [`other+${uniq()}@cr.local`, `80${uniq().slice(-8)}`])).rows[0].id;
  const theirs = await call(parties.applyCredit, {
    user: { id: other, role: "seller" },
    business: { id: other, owner: true, isOwner: true },
    params: { id: partyId }, body: { saleId: sale.id },
  });
  check(theirs.statusCode === 404, "and another wholesaler cannot reach this customer", {
    s: theirs.statusCode,
  });

  // ---------------------------------------------------------------
  console.log("\nA credit bigger than the bill leaves the rest loose");
  // ---------------------------------------------------------------
  const big = await place(300);
  await pay(big);
  await wait();
  await move(big, ["supplier_accepted", "processing", "packed", "ready_for_pickup",
                   "shipped", "in_transit", "out_for_delivery", "delivered"]);
  await call(orders.requestReturn, {
    user: { id: buyer }, params: { orderId: big }, body: { reason: "wrong goods" },
  });
  await move(big, ["return_approved", "return_completed"]);
  await wait();

  const small = await place(50, "installment_50_50");
  await wait();
  await call(orders.updateOrderStatus, {
    ...asSeller, params: { orderId: small }, body: { status: "payment_pending" },
  });
  await call(orders.updateOrderStatus, {
    ...asSeller, params: { orderId: small }, body: { status: "cancelled" },
  }).catch(() => {});
  // Not cancelled: accept it so it becomes a sale worth 50,000.
  await pay(small, 1);
  await wait();
  await call(orders.updateOrderStatus, {
    ...asSeller, params: { orderId: small }, body: { status: "supplier_accepted" },
  });
  await wait();
  const smallSale = (await testPool.query(
    "SELECT id FROM sales WHERE order_id = $1", [small])).rows[0];

  const before = await creditService.offer(partyId, seller);
  const target = (before.targets || []).find((t) => String(t.saleId) === String(smallSale?.id));
  check(before.credit === 300000, "3,00,000 of their money is loose again", {
    credit: before.credit,
  });
  check(
    target && target.canApply === target.outstanding && target.canApply < before.credit,
    "and only what that bill owes is offered, not the whole credit",
    { owed: target?.outstanding, offered: target?.canApply, credit: before.credit },
  );

  const partial = await call(parties.applyCredit, {
    ...asSeller, params: { id: partyId }, body: { saleId: smallSale.id },
  });
  check(
    money(partial.body?.applied) === money(target.outstanding),
    "setting it covers the bill exactly",
    { applied: partial.body?.applied, owed: target?.outstanding },
  );
  check(
    money(partial.body?.creditLeft) === money(300000 - target.outstanding),
    "and the rest of their money is still their",
    { left: partial.body?.creditLeft },
  );

  const leftover = await creditService.offer(partyId, seller);
  check(leftover.credit === money(300000 - target.outstanding),
    "which the next read agrees with", { credit: leftover.credit });

  const statement = await call(parties.getPartyStatement, {
    ...asSeller, params: { id: partyId }, query: {},
  });
  check(
    money(statement.body?.closingBalance) === money(await balanceOf(partyId)),
    "and the statement still closes where the customer page says",
    { statement: statement.body?.closingBalance, page: await balanceOf(partyId) },
  );

  console.log(`\n${fails === 0 ? "all good" : `${fails} FAILED`}\n`);
  await testPool.end();
  process.exit(fails === 0 ? 0 : 1);
})().catch((err) => {
  console.error("THREW", err);
  process.exit(1);
});

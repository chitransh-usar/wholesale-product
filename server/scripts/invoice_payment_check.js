/**
 * Does a part payment reach the invoice?
 *
 * It did not. An order can be paid half now and half later, but the invoice
 * only ever heard about a payment once the whole amount was in, so a buyer who
 * had paid their first instalment looked, on their own bill, exactly like a buyer
 * who had paid nothing: no entry, no date, no amount, and UNPAID stamped over
 * the PDF. The order screen showed them a receipt for money the bill said had
 * never arrived.
 *
 * What has to hold:
 *   - the first instalment appears on the invoice, for the right amount
 *   - the bill says Pending, not Paid, while money is still owed
 *   - the second instalment settles it, and the two entries sum to the bill
 *   - running the reconcile again changes nothing, because it is called on
 *     every payment event and on the backfill
 *   - a payment the wholesaler recorded by hand is not counted twice
 *   - the invoice closes on its own total, not the order's, so GST rounding
 *     cannot leave a few paise owing forever
 *
 *     node scripts/invoice_payment_check.js <database>
 */
/**
 * NOTE, added 10 Sept 2026.
 *
 * This suite tests the 50/50 instalment plan and how an invoice mirrors a
 * part payment. Both need an invoice to EXIST while money is still
 * outstanding, which the delivery challan rule specified on 10 Sept forbids:
 * under that rule the bill waits until the sale is settled.
 *
 * Settled 11 Sept: the rule stands, and the "Partial" payment status is gone
 * with it. A bill is Pending or Paid, nothing in between, because a document
 * that only exists once it is settled can never honestly be half paid. What
 * has come in is still recorded as payment rows against the bill, so the
 * Invoices header shows received and outstanding separately and nothing is
 * lost; only the status word stopped describing a state that is not supposed
 * to exist.
 *
 * The flag is turned off here so this suite goes on exercising the path the
 * flag exists to preserve: with the rule off, a bill is raised unpaid and
 * payments arrive against it over time, and it must still read Pending until
 * the last rupee.
 */
process.env.CHALLAN_WHEN_UNPAID = "false";

const Module = require("module");
const { Pool } = require("pg");

const DB = process.argv[2] || "qa_invpay";
const dbPath = require.resolve("../src/config/db");
const testPool = new Pool({ connectionString: `postgres://postgres@127.0.0.1:5433/${DB}` });
const stub = new Module(dbPath, null);
stub.exports = testPool;
stub.loaded = true;
require.cache[dbPath] = stub;

const orders = require("../src/controllers/orderController");
const invoiceController = require("../src/controllers/invoiceController");
const saleCtrl = require("../src/controllers/saleController");
const parties = require("../src/controllers/partyController");
const invoiceService = require("../src/services/invoiceService");
const invoiceRepository = require("../src/repositories/invoiceRepository");
const partyService = require("../src/services/partyService");
const saleService = require("../src/services/orderSaleService");

const mk = () => {
  const r = { statusCode: 200, body: null };
  r.status = (c) => ((r.statusCode = c), r);
  r.json = (b) => ((r.body = b), r);
  return r;
};
const call = async (fn, req) => { const r = mk(); await fn(req, r); return r; };

let fails = 0;
const check = (cond, label, v) => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"} ${String(label).padEnd(54)} ${JSON.stringify(v ?? "")}`);
};
const q = (sql, args) => testPool.query(sql, args);
const money = (n) => Number(Number(n || 0).toFixed(2));

const stamp = Date.now();
let seq = 0;
const mkUser = async (role, phone) =>
  (await q(
    `INSERT INTO users (first_name,last_name,email,role,phone,password_hash)
     VALUES ($1,'T',$2,$3,$4,'x') RETURNING id`,
    [role === "seller" ? "Ram" : "Kishan", `${role}${stamp}${seq++}@x.local`, role, phone],
  )).rows[0].id;

(async () => {
  console.log(`\n=== invoice part payments, ${DB} ===`);
  partyService.resetPartyLink();
  saleService.resetSaleLink();

  const wid = await mkUser("seller", "9000000001");
  await q(
    `INSERT INTO wholesaler_profiles (user_id, company_name, upi_id, contact_phone, city, gstin)
     VALUES ($1,'Ram Textiles','ram@upi','9000000001','Surat','24AAAAA0000A1Z8')`,
    [wid],
  );

  const p = (await q(`INSERT INTO products (name,category) VALUES ($1,'Fabric') RETURNING id`,
    [`Cotton shirting ${stamp}`])).rows[0].id;
  const inv = (await q(
    `INSERT INTO supplier_inventory (supplier_id,product_id,price,moq,stock,status,visibility,shipping_days,unit,gst_percent)
     VALUES ($1,$2,255,1,0,'Active','public',5,'mtr',5) RETURNING id`,
    [wid, p],
  )).rows[0].id;

  // 7 metres at 255 gives an odd total on purpose, so a 50/50 split cannot
  // divide evenly and rounding has somewhere to go wrong.
  const buyer = await mkUser("buyer", "9820011223");
  const placed = await call(orders.createOrder, {
    user: { id: buyer },
    body: {
      products: [{ productId: p, inventoryId: inv, quantity: 7 }],
      deliveryAddress: { name: "Kishan Cloth House", phone: "9820011223", city: "Surat" },
      paymentPlan: "installment_50_50",
    },
  });
  const orderId = placed.body?.orderId;
  check(!!orderId, "an order was placed on the 50/50 plan", { s: placed.statusCode });

  const orderTotal = money((await q("SELECT total_amount FROM orders WHERE id=$1", [orderId])).rows[0].total_amount);

  // The invoice is raised when the order is placed, but off the request, so
  // wait for it rather than racing it.
  const invoiceOf = async () => invoiceRepository.findInvoiceByOrderId(orderId);
  const waitForInvoice = async () => {
    for (let i = 0; i < 40; i++) {
      const found = await invoiceOf();
      if (found) return found;
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  };
  let bill = await waitForInvoice();
  check(!!bill, "an invoice exists before any payment", { n: bill?.invoice_number });
  const grandTotal = money(bill?.grand_total);
  check((bill?.payments || []).length === 0, "and it shows no payments yet", {});

  const invoiceCount = async (id) =>
    Number((await q("SELECT COUNT(*)::int AS n FROM invoices WHERE order_id=$1", [id])).rows[0].n);
  check((await invoiceCount(orderId)) === 1,
    "the order has exactly one invoice", { n: await invoiceCount(orderId) });

  const paidOnBill = async () => {
    const b = await invoiceOf();
    return {
      status: String(b.payment_status || ""),
      rows: (b.payments || []).length,
      sum: money((b.payments || []).reduce((s, x) => s + Number(x.amount), 0)),
      logs: (b.logs || []).map((l) => l.action),
    };
  };

  // ---- first instalment --------------------------------------------------
  await call(orders.initiatePayment, { user: { id: buyer }, params: { orderId }, body: {} });
  const first = await call(orders.updatePaymentStatus, {
    user: { id: buyer }, params: { orderId }, body: { paymentStatus: "paid" },
  });
  check(first.statusCode === 200, "the first instalment goes through", { s: first.statusCode });
  const afterFirstOrder = (await q("SELECT amount_paid, remaining_amount, payment_status FROM orders WHERE id=$1", [orderId])).rows[0];
  check(money(afterFirstOrder.remaining_amount) > 0,
    "the order still says money is owed", { left: afterFirstOrder.remaining_amount });

  // reconcile runs in the background off the request, so drive it directly.
  await invoiceService.reconcileInvoiceForOrder(orderId);
  let onBill = await paidOnBill();
  check(onBill.rows === 1, "the part payment reached the invoice", onBill);
  check(onBill.sum === money(afterFirstOrder.amount_paid),
    "for exactly what the order says was received",
    { bill: onBill.sum, order: money(afterFirstOrder.amount_paid) });
  // Pending, not "Partial". Settled 11 Sept: a bill is paid or it is not, and
  // since a bill only exists once the money is all in, a half paid one is a
  // state the product should not be able to hold. What HAS come in is carried
  // by the payment rows above, which is where the Invoices header reads it
  // from, so nothing is lost by the status word being honest.
  check(onBill.status.toLowerCase() === "pending",
    "the bill reads Pending, not Paid", { status: onBill.status, was: "Partial" });
  check(onBill.logs.includes("Payment"),
    "and the timeline has an entry for it", { logs: onBill.logs });
  check(!onBill.logs.includes("Paid"),
    "but does not claim the bill is settled", { logs: onBill.logs });

  // ---- running it again must not double count ----------------------------
  await invoiceService.reconcileInvoiceForOrder(orderId);
  await invoiceService.reconcileInvoiceForOrder(orderId);
  const repeated = await paidOnBill();
  check(repeated.rows === 1 && repeated.sum === onBill.sum,
    "reconciling again adds nothing", repeated);

  // ---- second instalment settles it --------------------------------------
  await call(orders.initiatePayment, { user: { id: buyer }, params: { orderId }, body: {} });
  const second = await call(orders.updatePaymentStatus, {
    user: { id: buyer }, params: { orderId }, body: { paymentStatus: "paid" },
  });
  check(second.statusCode === 200, "the second instalment goes through", { s: second.statusCode });
  await invoiceService.reconcileInvoiceForOrder(orderId);

  onBill = await paidOnBill();
  check(onBill.rows === 2, "the invoice now shows both payments", onBill);
  check(onBill.sum === grandTotal,
    "which add up to the bill exactly", { sum: onBill.sum, bill: grandTotal });
  check(onBill.status.toLowerCase() === "paid", "and the bill reads Paid", { status: onBill.status });
  check(onBill.logs.includes("Paid"), "the timeline records the settlement", { logs: onBill.logs });

  const finalInvoice = await invoiceOf();
  check(String(finalInvoice.invoice_status) === "Paid",
    "the document is marked Paid too", { s: finalInvoice.invoice_status });

  // The invoice closes on its own total, which need not equal the order's once
  // GST has been worked out. Settling against the order's figure is what would
  // leave a few paise owing forever.
  check(money(grandTotal - onBill.sum) === 0,
    "nothing is left owing on the bill",
    { left: money(grandTotal - onBill.sum), order: orderTotal });
  check((await invoiceCount(orderId)) === 1,
    "and still exactly one invoice after four reconciles",
    { n: await invoiceCount(orderId) });

  // ---- a hand entered payment is not billed twice ------------------------
  const buyer2 = await mkUser("buyer", "9820011224");
  const placed2 = await call(orders.createOrder, {
    user: { id: buyer2 },
    body: {
      products: [{ productId: p, inventoryId: inv, quantity: 4 }],
      deliveryAddress: { name: "Second Shop", phone: "9820011224", city: "Surat" },
      paymentPlan: "installment_50_50",
    },
  });
  const orderId2 = placed2.body.orderId;
  let bill2 = null;
  for (let i = 0; i < 40 && !bill2; i++) {
    bill2 = await invoiceRepository.findInvoiceByOrderId(orderId2);
    if (!bill2) await new Promise((r) => setTimeout(r, 100));
  }

  await call(orders.initiatePayment, { user: { id: buyer2 }, params: { orderId: orderId2 }, body: {} });
  await call(orders.updatePaymentStatus, {
    user: { id: buyer2 }, params: { orderId: orderId2 }, body: { paymentStatus: "paid" },
  });
  const paidByOrder = money((await q("SELECT amount_paid FROM orders WHERE id=$1", [orderId2])).rows[0].amount_paid);

  // The wholesaler writes the same money onto the bill themselves first.
  await invoiceRepository.addPayment({
    invoiceId: bill2.id, amount: paidByOrder, paymentMethod: "Cash",
    remarks: "Entered by hand",
  });
  await invoiceService.reconcileInvoiceForOrder(orderId2);

  const b2 = await invoiceRepository.findInvoiceByOrderId(orderId2);
  const sum2 = money((b2.payments || []).reduce((s, x) => s + Number(x.amount), 0));
  check((b2.payments || []).length === 1,
    "a payment entered by hand is not duplicated", { rows: (b2.payments || []).length });
  check(sum2 === paidByOrder, "and the total on the bill is right", { sum: sum2, paid: paidByOrder });

  // ---- a cancelled invoice is never touched ------------------------------
  await invoiceRepository.updateInvoice(b2.id, { invoice_status: "Cancelled" });
  await call(orders.initiatePayment, { user: { id: buyer2 }, params: { orderId: orderId2 }, body: {} });
  await call(orders.updatePaymentStatus, {
    user: { id: buyer2 }, params: { orderId: orderId2 }, body: { paymentStatus: "paid" },
  });
  await invoiceService.reconcileInvoiceForOrder(orderId2);
  const b3 = await invoiceRepository.findInvoiceByOrderId(orderId2);
  check(String(b3.invoice_status) === "Cancelled",
    "a cancelled bill stays cancelled", { s: b3.invoice_status });
  check((b3.payments || []).length === 1,
    "and takes on no further payments", { rows: (b3.payments || []).length });

  // ---- the three cards on the Invoices tab agree with each other --------
  //
  // They were counted off payment_status rather than off money, and on a part
  // paid bill none of the three was right: "Still to come in" took the whole
  // grand_total, "Received" counted only fully paid bills so the money already
  // in appeared on neither card, and the count beside the first read 0 while
  // its amount read the full bill.
  //
  // The third order also pays the moment it is placed, without waiting for
  // checkout to finish raising the bill. That race used to lose the payment
  // entirely: both callers found no invoice, one created it, the other was
  // handed it back and never recorded the money.
  const buyer3 = await mkUser("buyer", "9820011225");
  const placed3 = await call(orders.createOrder, {
    user: { id: buyer3 },
    body: {
      products: [{ productId: p, inventoryId: inv, quantity: 5 }],
      deliveryAddress: { name: "Third Shop", phone: "9820011225", city: "Surat" },
      paymentPlan: "installment_50_50",
    },
  });
  const orderId3 = placed3.body.orderId;
  await call(orders.initiatePayment, {
    user: { id: buyer3 }, params: { orderId: orderId3 }, body: { installment: 1 },
  });
  await call(orders.updatePaymentStatus, {
    user: { id: buyer3 }, params: { orderId: orderId3 }, body: { paymentStatus: "paid" },
  });
  await new Promise((r) => setTimeout(r, 1200));

  const bill3 = await invoiceRepository.findInvoiceByOrderId(orderId3);
  const onBill3 = money((bill3?.payments || []).reduce((s, x) => s + Number(x.amount), 0));
  check(onBill3 > 0, "the first instalment reaches the bill even when they pay at once", {
    on: onBill3,
    why: "checkout raises the bill in the background, so the two race",
  });

  const head = mk();
  await invoiceController.getDashboardStats(
    { user: { id: wid, role: "seller" }, business: { id: wid, owner: true, isOwner: true }, query: {} },
    head,
  );
  const card = head.body?.stats?.summary || head.body?.stats || {};
  const still = money(card.pending_amount);
  const got = money(card.paid_amount);
  const bills = money(
    (await q(
      `SELECT COALESCE(SUM(grand_total),0) n FROM invoices
        WHERE supplier_id = $1 AND invoice_status <> 'Cancelled'
          AND buyer_id IS DISTINCT FROM supplier_id`, [wid])).rows[0].n);
  check(money(still + got) === bills,
    "still to come in, plus received, is the value of the bills",
    { still, received: got, bills });
  check(
    (still > 0) === (Number(card.pending_count) > 0),
    "and the count beside the amount is not zero while the amount is not",
    { amount: still, count: card.pending_count },
  );

  // ---- a bill settled from the SALE side still reads as received --------
  //
  // Reported 12 Sept: two invoices both marked PAID in the list, above a card
  // reading "1,35,700 still to come in, 2 unpaid", which was their exact sum.
  //
  // A sale-side bill deliberately writes NO row into the invoice module's
  // payments table, because that money is already in party_payments against
  // the sale and writing it twice is what once made a bill read Paid while the
  // customer still owed the lot. So a header counting those rows alone read
  // every such bill as wholly unpaid.
  //
  // Since a bill is now Paid or Pending and nothing between, the stamp answers
  // it outright and the rows are consulted only for one that is not settled.
  const cashParty = await call(parties.createParty, {
    user: { id: wid, role: "seller" }, business: { id: wid, owner: true, isOwner: true },
    body: { name: "Counter Sale Shop", city: "Surat", phone: `96${Date.now() % 100000000}` },
  });
  await call(saleCtrl.createSale, {
    user: { id: wid, role: "seller" }, business: { id: wid, owner: true, isOwner: true },
    body: {
      partyId: cashParty.body.id, status: "confirmed",
      lines: [{ itemName: "Cloth", quantity: 1, unit: "mtr", rate: 5000, gstPercent: 0 }],
      amountPaid: 5000, paymentMethod: "cash",
    },
  });
  await new Promise((r) => setTimeout(r, 900));

  const saleBill = (await q(
    `SELECT i.id, i.grand_total, i.payment_status,
            (SELECT count(*)::int FROM payments p WHERE p.invoice_id = i.id) AS rows
       FROM invoices i
       JOIN sales s ON s.id = i.sale_id
      WHERE s.party_id = $1`, [cashParty.body.id])).rows[0];
  check(saleBill?.payment_status === "Paid" && saleBill?.rows === 0,
    "a cash sale bills itself with no invoice payment row",
    { status: saleBill?.payment_status, rows: saleBill?.rows });

  const head2 = mk();
  await invoiceController.getDashboardStats(
    { user: { id: wid, role: "seller" }, business: { id: wid, owner: true, isOwner: true }, query: {} },
    head2,
  );
  const card2 = head2.body?.stats?.summary || head2.body?.stats || {};
  const settledTotal = money((await q(
    `SELECT COALESCE(SUM(grand_total),0) n FROM invoices
      WHERE supplier_id = $1 AND payment_status = 'Paid'
        AND invoice_status <> 'Cancelled' AND buyer_id IS DISTINCT FROM supplier_id`,
    [wid])).rows[0].n);
  check(money(card2.paid_amount) >= settledTotal,
    "and every settled bill is counted under Received",
    { received: card2.paid_amount, settled: settledTotal });
  check(money(card2.pending_amount) < settledTotal,
    "rather than under Still to come in",
    { still: card2.pending_amount, why: "which is where they all landed before" });

  /**
   * A bill reversed by a credit note is not money to collect.
   *
   * Found 12 Sept while sweeping the invoice screens. Cancelling a bill and
   * crediting one are two different instruments and only the first was
   * excluded from these cards. A credit note deliberately leaves the invoice
   * Generated and Pending, because under GST the document stands and is
   * reversed by another document, so a fully credited bill went on being
   * counted as money still to come in and as revenue.
   *
   * The list beside the cards already showed such a row as "Credited". The
   * card above it asked them to chase the money anyway.
   */
  /**
   * The losing ordering, forced.
   *
   * The suite above hand-enters a payment and then reconciles, which is the
   * order that always worked. The failure was the other way round: reconcile
   * lands FIRST from its background call, the hand entry arrives after, and
   * nothing looks again. It reproduced about one run in three under load and
   * never on an idle machine, so it is driven explicitly here rather than
   * left to timing.
   */
  console.log("\n-- the same money entered by hand AFTER reconcile --");

  const buyerRace = await mkUser("buyer", "9820011226");
  const placedRace = await call(orders.createOrder, {
    user: { id: buyerRace },
    body: {
      products: [{ productId: p, inventoryId: inv, quantity: 4 }],
      deliveryAddress: { name: "Third Shop", phone: "9820011226", city: "Surat" },
      paymentPlan: "installment_50_50",
    },
  });
  const orderIdRace = placedRace.body.orderId;
  let billRace = null;
  for (let i = 0; i < 40 && !billRace; i++) {
    billRace = await invoiceRepository.findInvoiceByOrderId(orderIdRace);
    if (!billRace) await new Promise((r) => setTimeout(r, 100));
  }

  await call(orders.initiatePayment, { user: { id: buyerRace }, params: { orderId: orderIdRace }, body: {} });
  await call(orders.updatePaymentStatus, {
    user: { id: buyerRace }, params: { orderId: orderIdRace }, body: { paymentStatus: "paid" },
  });
  const paidRace = money((await q("SELECT amount_paid FROM orders WHERE id=$1", [orderIdRace])).rows[0].amount_paid);

  // Reconcile FIRST, deterministically, which is what the background call did
  // when it won the race.
  await invoiceService.reconcileInvoiceForOrder(orderIdRace);
  const mirrored = await invoiceRepository.findInvoiceByOrderId(orderIdRace);
  check((mirrored.payments || []).length === 1,
    "reconcile mirrors the shop payment onto the bill",
    { rows: (mirrored.payments || []).length });

  // Now the wholesaler writes the same money by hand. This is the entry that
  // used to be added blind.
  const handEntry = await invoiceRepository.addPayment({
    invoiceId: billRace.id, amount: paidRace, paymentMethod: "Cash",
    remarks: "Entered by hand, after reconcile",
  }, null);
  check(handEntry === null, "the same money entered afterwards is refused", { got: handEntry });

  const billRaceNow = await invoiceRepository.findInvoiceByOrderId(orderIdRace);
  check((billRaceNow.payments || []).length === 1, "so the bill still holds one payment",
    { rows: (billRaceNow.payments || []).length });
  const sumRace = money((billRaceNow.payments || []).reduce((s, x) => s + Number(x.amount), 0));
  check(sumRace === paidRace, "summing to what the order actually received",
    { onBill: sumRace, order: paidRace });
  check(String(billRaceNow.payment_status).toLowerCase() !== "paid",
    "and it does not read fully paid while half is owed",
    { status: billRaceNow.payment_status, total: billRaceNow.grand_total });

  // The rest of the instalment, by hand, IS allowed once the order shows it.
  await call(orders.initiatePayment, { user: { id: buyerRace }, params: { orderId: orderIdRace }, body: {} });
  await call(orders.updatePaymentStatus, {
    user: { id: buyerRace }, params: { orderId: orderIdRace }, body: { paymentStatus: "paid" },
  });
  await invoiceService.reconcileInvoiceForOrder(orderIdRace);
  const billRaceAfter = await invoiceRepository.findInvoiceByOrderId(orderIdRace);
  const sumRaceAfter = money((billRaceAfter.payments || []).reduce((s, x) => s + Number(x.amount), 0));
  check(sumRaceAfter === money(billRaceAfter.grand_total),
    "and the second instalment still settles it in full",
    { onBill: sumRaceAfter, bill: money(billRaceAfter.grand_total) });

  // A bill with no order behind it is untouched by any of this: there is no
  // other writer, so a hand entry is the only truth there is.
  const standaloneBill = (await q(
    `INSERT INTO invoices (invoice_number, supplier_id, buyer_id, grand_total,
       total_tax, invoice_status, payment_status, issue_date)
     VALUES ($1,$2,$3,5000,0,'Generated','Pending',CURRENT_DATE) RETURNING id`,
    [`SA-${stamp}`, wid, buyerRace])).rows[0].id;
  const standaloneEntry = await invoiceRepository.addPayment({
    invoiceId: standaloneBill, amount: 5000, paymentMethod: "Cash",
  }, null);
  check(standaloneEntry && money(standaloneEntry.amount) === 5000,
    "a bill with no order behind it still takes a hand entry in full",
    { got: standaloneEntry && money(standaloneEntry.amount) });

  console.log("\n-- a credited bill is not money to collect --");

  const headA = mk();
  await invoiceController.getDashboardStats(
    { user: { id: wid, role: "seller" }, business: { id: wid, owner: true, isOwner: true }, query: {} },
    headA,
  );
  const cardA = headA.body?.stats?.summary || headA.body?.stats || {};

  const creditMe = (await q(
    `INSERT INTO invoices (invoice_number, supplier_id, buyer_id, grand_total,
       total_tax, invoice_status, payment_status, issue_date, due_date)
     VALUES ($1,$2,$3,40000,0,'Generated','Pending',CURRENT_DATE,CURRENT_DATE + 30)
     RETURNING id`,
    [`CRD-${stamp}`, wid, buyer])).rows[0].id;

  const headB = mk();
  await invoiceController.getDashboardStats(
    { user: { id: wid, role: "seller" }, business: { id: wid, owner: true, isOwner: true }, query: {} },
    headB,
  );
  const cardB = headB.body?.stats?.summary || headB.body?.stats || {};
  check(
    money(cardB.pending_amount) === money(cardA.pending_amount) + 40000,
    "a live unpaid bill is counted as still to come in",
    { before: cardA.pending_amount, after: cardB.pending_amount },
  );

  await q(
    `INSERT INTO credit_notes (note_number, invoice_id, wholesaler_id, reason,
       subtotal, taxable_amount, grand_total)
     VALUES ($1,$2,$3,'sale_cancelled',40000,40000,40000)`,
    [`CN-${stamp}`, creditMe, wid]);

  const headC = mk();
  await invoiceController.getDashboardStats(
    { user: { id: wid, role: "seller" }, business: { id: wid, owner: true, isOwner: true }, query: {} },
    headC,
  );
  const cardC = headC.body?.stats?.summary || headC.body?.stats || {};
  check(
    money(cardC.pending_amount) === money(cardA.pending_amount),
    "and once a credit note reverses it, it stops being counted",
    { still: cardC.pending_amount, expected: cardA.pending_amount },
  );
  check(
    money(cardC.total_revenue) === money(cardA.total_revenue),
    "and it stops counting towards revenue too",
    { revenue: cardC.total_revenue, expected: cardA.total_revenue },
  );
  check(
    Number(cardC.pending_count) === Number(cardA.pending_count),
    "and the count beside the card agrees with the amount",
    { count: cardC.pending_count, expected: cardA.pending_count },
  );

  console.log(fails ? `\n${fails} FAILED\n` : "\nall good\n");
  await testPool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("THREW", e); process.exit(1); });

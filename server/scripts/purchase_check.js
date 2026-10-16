/**
 * The purchase book, driven end to end against a real database.
 *
 * Purchases are the mirror of sales, so the cases that have actually bitten
 * this codebase on the sales side are the ones worth driving here rather than
 * the happy path alone. Every one of these corresponds to a real bug already
 * fixed somewhere else:
 *
 *   - a cancelled document must release its payments rather than keep them,
 *     and must stop counting as owed          (the credit bug, 11 Sept)
 *   - a balance must never be a single netted number across counterparties
 *                                              (collectionTotals, 9 Sept)
 *   - a total must not be editable below what has already changed hands
 *   - one document, one number, taken under a lock
 *   - a scoping check on every id that arrives in a request body
 *
 * Plus the two things purchases have that sales do not: the supplier's own
 * bill number cannot be entered twice, and a line can be blocked from input
 * tax credit.
 *
 *     node scripts/purchase_check.js <database>
 */
const Module = require("module");
const { Pool } = require("pg");

const DB = process.argv[2] || "pur1";
const dbPath = require.resolve("../src/config/db");
const testPool = new Pool({ connectionString: `postgres://postgres@127.0.0.1:5433/${DB}` });
const stub = new Module(dbPath, null);
stub.exports = testPool;
stub.loaded = true;
require.cache[dbPath] = stub;

const purchases = require("../src/controllers/purchaseController");
const suppliers = require("../src/controllers/supplierController");
const invoiceRepository = require("../src/repositories/invoiceRepository");

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
  console.log(`  ${cond ? "PASS" : "FAIL"} ${String(label).padEnd(62)} ${JSON.stringify(detail ?? {})}`);
};

const uniq = () => String(Date.now()) + Math.floor(Math.random() * 1000);
const money = (n) => Number(Number(n || 0).toFixed(2));

(async () => {
  console.log(`\n=== the purchase book, against ${DB} ===\n`);
  invoiceRepository.resetSchemaExtras();

  const mkSeller = async (tag) => {
    const id = (await testPool.query(
      `INSERT INTO users (first_name,last_name,email,phone,password_hash,role)
       VALUES ('Ram','Textiles',$1,$2,'x','seller') RETURNING id`,
      [`${tag}+${uniq()}@pur.local`, `90${uniq().slice(-8)}`])).rows[0].id;
    await testPool.query(
      `INSERT INTO wholesaler_profiles (user_id, company_name, warehouse_state, city)
       VALUES ($1,'Ram Textiles','Gujarat','Surat')`, [id]);
    return {
      user: { id, role: "seller" },
      business: { id, isOwner: true, staffId: null, name: null, permissions: [] },
    };
  };

  const asSeller = await mkSeller("ram");
  const asOther = await mkSeller("other");

  // ---------------------------------------------------------------
  console.log("-- the supplier book --");

  const badName = await call(suppliers.createSupplier, { ...asSeller, body: {} });
  check(badName.statusCode === 400, "a supplier needs a name", { got: badName.statusCode });

  const badGst = await call(suppliers.createSupplier, {
    ...asSeller, body: { name: "Mill", gstin: "NOTAGSTIN" },
  });
  check(badGst.statusCode === 400, "a malformed GSTIN is refused", { got: badGst.statusCode });

  const made = await call(suppliers.createSupplier, {
    ...asSeller,
    body: { name: "Arvind Mills", businessName: "Arvind Ltd", phone: `88${uniq().slice(-8)}`,
            city: "Ahmedabad", gstin: "24aaacc1206d1zm" },
  });
  check(made.statusCode === 201, "supplier created", { got: made.statusCode });
  check(made.body?.gstin === "24AAACC1206D1ZM", "GSTIN stored upper case", { got: made.body?.gstin });
  const mill = made.body.id;

  const dupPhone = await call(suppliers.createSupplier, {
    ...asSeller, body: { name: "Another", phone: made.body.phone },
  });
  check(dupPhone.statusCode === 409, "the same phone twice is refused", { got: dupPhone.statusCode });

  // A second supplier, for the netting test further down.
  const agent = (await call(suppliers.createSupplier, {
    ...asSeller, body: { name: "Surat Agent", phone: `87${uniq().slice(-8)}` },
  })).body.id;

  // Somebody else's supplier, to scope against.
  const theirs = (await call(suppliers.createSupplier, {
    ...asOther, body: { name: "Their Mill", phone: `86${uniq().slice(-8)}` },
  })).body.id;

  const peek = await call(suppliers.getSupplierById, { ...asSeller, params: { id: theirs } });
  check(peek.statusCode === 404, "cannot open another wholesaler's supplier", { got: peek.statusCode });

  // ---------------------------------------------------------------
  console.log("\n-- recording a purchase --");

  const noSupplier = await call(purchases.createPurchase, {
    ...asSeller, body: { lines: [{ itemName: "Cotton", quantity: 1, rate: 10 }] },
  });
  check(noSupplier.statusCode === 400, "a purchase needs a supplier", { got: noSupplier.statusCode });

  const noLines = await call(purchases.createPurchase, {
    ...asSeller, body: { supplierId: mill, lines: [] },
  });
  check(noLines.statusCode === 400, "a purchase needs at least one line", { got: noLines.statusCode });

  const crossBook = await call(purchases.createPurchase, {
    ...asSeller,
    body: { supplierId: theirs, lines: [{ itemName: "Cotton", quantity: 1, rate: 10 }] },
  });
  check(crossBook.statusCode === 404, "cannot buy from another wholesaler's supplier", { got: crossBook.statusCode });

  // 100 metres at 200 = 20,000, plus 5% = 21,000.
  const p1 = await call(purchases.createPurchase, {
    ...asSeller,
    body: {
      supplierId: mill,
      supplierInvoiceNumber: "AM/4471",
      supplierInvoiceDate: "2026-09-01",
      lines: [{ itemName: "Cotton shirting", quantity: 100, unit: "mtr", rate: 200,
                gstPercent: 5, hsnCode: "5208" }],
    },
  });
  check(p1.statusCode === 201, "purchase recorded", { got: p1.statusCode, msg: p1.body?.message });
  check(money(p1.body?.total) === 21000, "20,000 plus 5% is 21,000", { got: p1.body?.total });
  check(money(p1.body?.tax_amount) === 1000, "tax is 1,000", { got: p1.body?.tax_amount });
  check(/^PUR\/\d+\/\d\d-\d\d$/.test(p1.body?.purchase_number || ""),
    "numbered PUR/n/FY", { got: p1.body?.purchase_number });
  const purchase1 = p1.body.id;

  const dupBill = await call(purchases.createPurchase, {
    ...asSeller,
    body: { supplierId: mill, supplierInvoiceNumber: "am/4471",
            lines: [{ itemName: "Cotton shirting", quantity: 1, rate: 1 }] },
  });
  check(dupBill.statusCode === 409 && dupBill.body?.code === "DUPLICATE_BILL",
    "the same supplier bill cannot be entered twice", { got: dupBill.statusCode, code: dupBill.body?.code });

  const sameNumberOtherSupplier = await call(purchases.createPurchase, {
    ...asSeller,
    body: { supplierId: agent, supplierInvoiceNumber: "AM/4471",
            lines: [{ itemName: "Silk", quantity: 10, rate: 500, gstPercent: 5 }] },
  });
  check(sameNumberOtherSupplier.statusCode === 201,
    "but a different supplier may use the same bill number", { got: sameNumberOtherSupplier.statusCode });
  const purchase2 = sameNumberOtherSupplier.body.id;

  const overpaid = await call(purchases.createPurchase, {
    ...asSeller,
    body: { supplierId: mill, amountPaid: 99999,
            lines: [{ itemName: "Linen", quantity: 1, rate: 100 }] },
  });
  check(overpaid.statusCode === 400, "cannot pay more than the bill at entry", { got: overpaid.statusCode });

  const draftWithMoney = await call(purchases.createPurchase, {
    ...asSeller,
    body: { supplierId: mill, status: "draft", amountPaid: 50,
            lines: [{ itemName: "Linen", quantity: 1, rate: 100 }] },
  });
  check(draftWithMoney.statusCode === 400, "a draft cannot carry a payment", { got: draftWithMoney.statusCode });

  const badDiscount = await call(purchases.createPurchase, {
    ...asSeller,
    body: { supplierId: mill, discount: 5000,
            lines: [{ itemName: "Linen", quantity: 1, rate: 100 }] },
  });
  check(badDiscount.statusCode === 400, "discount cannot exceed the goods", { got: badDiscount.statusCode });

  // ---------------------------------------------------------------
  console.log("\n-- what is owed --");

  const one = await call(purchases.getPurchaseById, { ...asSeller, params: { id: purchase1 } });
  check(one.statusCode === 200, "the purchase reads back", { got: one.statusCode });
  check(money(one.body?.settlement?.outstanding) === 21000, "all 21,000 is outstanding", { got: one.body?.settlement?.outstanding });
  check(one.body?.settlement?.settled === false, "and it is not settled", { got: one.body?.settlement?.settled });
  check(money(one.body?.inputTaxCredit?.claimable) === 1000, "1,000 of input credit is claimable", { got: one.body?.inputTaxCredit?.claimable });

  const sup = await call(suppliers.getSupplierById, { ...asSeller, params: { id: mill } });
  check(money(sup.body?.supplier?.balance) === 21000, "the mill is owed 21,000", { got: sup.body?.supplier?.balance });

  const payTooMuch = await call(suppliers.recordSupplierPayment, {
    ...asSeller, params: { id: mill }, body: { amount: 30000, purchaseId: purchase1 },
  });
  check(payTooMuch.statusCode === 400, "cannot pay 30,000 against a 21,000 bill", { got: payTooMuch.statusCode });

  const payWrongSupplier = await call(suppliers.recordSupplierPayment, {
    ...asSeller, params: { id: agent }, body: { amount: 100, purchaseId: purchase1 },
  });
  check(payWrongSupplier.statusCode === 404, "cannot pay one supplier's bill through another", { got: payWrongSupplier.statusCode });

  const pay1 = await call(suppliers.recordSupplierPayment, {
    ...asSeller, params: { id: mill }, body: { amount: 15000, purchaseId: purchase1, method: "bank" },
  });
  check(pay1.statusCode === 201, "15,000 paid against the bill", { got: pay1.statusCode });

  const after = await call(purchases.getPurchaseById, { ...asSeller, params: { id: purchase1 } });
  check(money(after.body?.settlement?.outstanding) === 6000, "6,000 still owed on the bill", { got: after.body?.settlement?.outstanding });

  const supAfter = await call(suppliers.getSupplierById, { ...asSeller, params: { id: mill } });
  check(money(supAfter.body?.supplier?.balance) === 6000, "and the mill's balance agrees", { got: supAfter.body?.supplier?.balance });

  // An advance: not tied to a bill, so not capped.
  const advance = await call(suppliers.recordSupplierPayment, {
    ...asSeller, params: { id: mill }, body: { amount: 10000 },
  });
  check(advance.statusCode === 201, "an advance with no bill against it is allowed", { got: advance.statusCode });

  const supAdv = await call(suppliers.getSupplierById, { ...asSeller, params: { id: mill } });
  check(money(supAdv.body?.supplier?.balance) === -4000, "paying 25,000 on a 21,000 bill leaves 4,000 on account", { got: supAdv.body?.supplier?.balance });

  // ---------------------------------------------------------------
  console.log("\n-- the totals are not netted across suppliers --");

  // The mill is 4,000 in credit. The agent is owed 5,250 (5,000 + 5%).
  const stats = await call(suppliers.getSupplierStats, { ...asSeller, query: {} });
  check(money(stats.body?.owedByYou) === 5250, "owed to suppliers is the agent's bill alone", { got: stats.body?.owedByYou });
  check(money(stats.body?.onAccount) === 4000, "and the mill's credit is reported separately", { got: stats.body?.onAccount });
  check(money(stats.body?.owedByYou) - money(stats.body?.onAccount) !== money(stats.body?.owedByYou),
    "the two are genuinely different figures, not one netted number", {});

  // ---------------------------------------------------------------
  console.log("\n-- editing --");

  const shrink = await call(purchases.updatePurchase, {
    ...asSeller, params: { id: purchase1 },
    body: { lines: [{ itemName: "Cotton shirting", quantity: 1, rate: 100, gstPercent: 5 }] },
  });
  check(shrink.statusCode === 400, "cannot edit the total below what has been paid", { got: shrink.statusCode, msg: shrink.body?.message });

  const grow = await call(purchases.updatePurchase, {
    ...asSeller, params: { id: purchase1 },
    body: { supplierInvoiceNumber: "AM/4471",
            lines: [{ itemName: "Cotton shirting", quantity: 120, unit: "mtr", rate: 200,
                      gstPercent: 5, hsnCode: "5208" }] },
  });
  check(grow.statusCode === 200, "but it can be corrected upward", { got: grow.statusCode, msg: grow.body?.message });
  check(money(grow.body?.total) === 25200, "24,000 plus 5% is 25,200", { got: grow.body?.total });

  const stealEdit = await call(purchases.updatePurchase, {
    ...asOther, params: { id: purchase1 },
    body: { lines: [{ itemName: "x", quantity: 1, rate: 1 }] },
  });
  check(stealEdit.statusCode === 404, "another wholesaler cannot edit it", { got: stealEdit.statusCode });

  // ---------------------------------------------------------------
  console.log("\n-- input tax credit, blocked and claimable --");

  const mixed = await call(purchases.createPurchase, {
    ...asSeller,
    body: {
      supplierId: agent,
      supplierInvoiceNumber: `SA/${uniq().slice(-5)}`,
      lines: [
        { itemName: "Polyester", quantity: 100, rate: 100, gstPercent: 5 },
        { itemName: "Staff lunch", quantity: 1, rate: 2000, gstPercent: 5, itcEligible: false },
      ],
    },
  });
  check(mixed.statusCode === 201, "a bill with a blocked line records", { got: mixed.statusCode, msg: mixed.body?.message });

  const mixedRead = await call(purchases.getPurchaseById, { ...asSeller, params: { id: mixed.body.id } });
  check(money(mixedRead.body?.purchase?.tax_amount) === 600, "the bill's own tax is 600", { got: mixedRead.body?.purchase?.tax_amount });
  check(money(mixedRead.body?.inputTaxCredit?.claimable) === 500, "but only 500 is claimable", { got: mixedRead.body?.inputTaxCredit?.claimable });
  check(mixedRead.body?.inputTaxCredit?.blocked === true, "and the screen is told a line is blocked", { got: mixedRead.body?.inputTaxCredit?.blocked });

  // ---------------------------------------------------------------
  console.log("\n-- cancelling --");

  const cancelled = await call(purchases.updatePurchaseStatus, {
    ...asSeller, params: { id: purchase1 }, body: { status: "cancelled" },
  });
  check(cancelled.statusCode === 200, "a purchase can be cancelled", { got: cancelled.statusCode });
  check(money(cancelled.body?.releasedToAccount) === 15000,
    "the 15,000 already paid is released onto the supplier's account", { got: cancelled.body?.releasedToAccount });

  const supCancel = await call(suppliers.getSupplierById, { ...asSeller, params: { id: mill } });
  check(money(supCancel.body?.supplier?.balance) === -25000,
    "so all 25,000 handed over is now money on account, not lost", { got: supCancel.body?.supplier?.balance });

  const stillThere = await testPool.query(
    "SELECT COUNT(*)::int AS n FROM supplier_payments WHERE supplier_id = $1", [mill]);
  check(stillThere.rows[0].n === 2, "cancelling deletes no payment rows", { got: stillThere.rows[0].n });

  const editCancelled = await call(purchases.updatePurchase, {
    ...asSeller, params: { id: purchase1 },
    body: { lines: [{ itemName: "x", quantity: 1, rate: 1 }] },
  });
  check(editCancelled.statusCode === 400, "a cancelled purchase cannot be edited", { got: editCancelled.statusCode });

  const reviveIt = await call(purchases.updatePurchaseStatus, {
    ...asSeller, params: { id: purchase1 }, body: { status: "received" },
  });
  check(reviveIt.statusCode === 400, "and it cannot be brought back", { got: reviveIt.statusCode });

  const payCancelled = await call(suppliers.recordSupplierPayment, {
    ...asSeller, params: { id: mill }, body: { amount: 100, purchaseId: purchase1 },
  });
  check(payCancelled.statusCode === 400, "nor paid against", { got: payCancelled.statusCode });

  // ---------------------------------------------------------------
  console.log("\n-- the list --");

  const list = await call(purchases.listPurchases, { ...asSeller, query: {} });
  check(list.statusCode === 200 && Array.isArray(list.body), "the list reads", { got: list.statusCode });
  const listed = (list.body || []).find((row) => row.id === purchase2);
  check(listed && money(listed.paid) === 0, "an unpaid purchase shows nothing paid", { got: listed?.paid });
  check(listed?.supplier_name === "Surat Agent", "and carries the supplier's name", { got: listed?.supplier_name });

  const mine = await call(purchases.listPurchases, { ...asOther, query: {} });
  check((mine.body || []).length === 0, "another wholesaler's list is empty", { got: (mine.body || []).length });

  const filtered = await call(purchases.listPurchases, { ...asSeller, query: { supplierId: agent } });
  check((filtered.body || []).every((row) => row.supplier_name === "Surat Agent"),
    "filtering by supplier works", { got: (filtered.body || []).length });

  // ---------------------------------------------------------------
  console.log("\n-- numbering does not repeat under concurrency --");

  const racers = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      call(purchases.createPurchase, {
        ...asSeller,
        body: { supplierId: agent, supplierInvoiceNumber: `RACE/${i}/${uniq().slice(-4)}`,
                lines: [{ itemName: "Race", quantity: 1, rate: 10 }] },
      })),
  );
  const numbers = racers.filter((r) => r.statusCode === 201).map((r) => r.body.purchase_number);
  check(numbers.length === 8, "all eight recorded", { got: numbers.length });
  check(new Set(numbers).size === numbers.length, "and every number is distinct", { got: numbers.length - new Set(numbers).size });

  console.log(`\n${fails === 0 ? "all good" : `${fails} FAILED`}\n`);
  await testPool.end();
  process.exit(fails === 0 ? 0 : 1);
})().catch((err) => { console.error(err); process.exit(1); });

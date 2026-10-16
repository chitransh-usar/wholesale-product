/**
 * The challan as a movement document, in two directions.
 *
 * What this pins, and why each one would hurt:
 *
 *   a challan no longer holds an invoice back    the old rule was not what
 *                                                section 31(1) says
 *   sale and purchase runs are separate          a run that skips cannot be
 *                                                reconciled
 *   a challan moves STOCK and not the ledger     otherwise every sale is
 *                                                counted twice in the khata
 *   a billed challan cannot be billed again      the same goods billed twice,
 *                                                and the second bill looks
 *                                                perfectly normal
 *   a billed challan cannot be edited            the bill would stand on a
 *                                                document that has moved
 *
 *     createdb qa_cbook
 *     DATABASE_URL="postgres://postgres@127.0.0.1:5433/qa_cbook?sslmode=disable" npm run migrate
 *     node scripts/challan_book_check.js qa_cbook
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const Module = require("module");
const { Pool } = require("pg");

const DB = process.argv[2] || "qa_cbook";
const dbPath = require.resolve("../src/config/db");
const testPool = new Pool({ connectionString: `postgres://postgres@127.0.0.1:5433/${DB}` });
const stub = new Module(dbPath, null);
stub.exports = testPool;
stub.loaded = true;
require.cache[dbPath] = stub;

const challanBook = require("../src/services/challanBook");
const challanService = require("../src/services/challanService");
const pdfService = require("../src/services/pdfService");
const saleController = require("../src/controllers/saleController");
const purchaseController = require("../src/controllers/purchaseController");
const saleInvoiceService = require("../src/services/saleInvoiceService");

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

(async () => {
  const s = Date.now().toString(36).slice(-6);
  const dial = String(Date.now()).slice(-7);

  const owner = (await testPool.query(
    `INSERT INTO users (first_name,last_name,email,password_hash,phone,role)
     VALUES ('CB','Seth',$1,'x',$2,'seller') RETURNING id`,
    [`cb-${s}@example.com`, `74${dial}`])).rows[0].id;
  await testPool.query(
    `INSERT INTO wholesaler_profiles (user_id,company_name,gstin,city,warehouse_state)
     VALUES ($1,$2,'27AAAPA1234A1Z5','Bhiwandi','Maharashtra')`, [owner, `Kamal ${s}`]);
  await testPool.query(
    `INSERT INTO invoice_settings (user_id,prefix) VALUES ($1,$2)`, [owner, `C${s}/`]);
  const party = (await testPool.query(
    `INSERT INTO parties (wholesaler_id,name,city,state,phone)
     VALUES ($1,$2,'Surat','Gujarat',$3) RETURNING id`,
    [owner, `Ramesh ${s}`, `98${dial}`])).rows[0].id;
  const supplier = (await testPool.query(
    `INSERT INTO suppliers (wholesaler_id,name,city,phone)
     VALUES ($1,$2,'Bhiwandi',$3) RETURNING id`,
    [owner, `Mohan Mills ${s}`, `88${dial}`])).rows[0].id;

  // ------------------------------------------------------------------
  console.log("\nA challan is recorded because goods moved, not because of money");
  // ------------------------------------------------------------------
  check(challanService.invoiceWaitsForPayment() === false,
    "an unpaid sale no longer holds its tax invoice back");

  const out = await challanBook.create(owner, {
    kind: "sale", partyId: party, reason: "bill_to_follow",
    lines: [{ itemName: "Cotton shirting", quantity: 20, unit: "mtr", rate: 100,
              hsnCode: "52081110", gstPercent: 5 }],
  });
  check(!out.error, "a sale challan is recorded", out.error);
  check(out.challan?.challan_number?.startsWith("SC/"),
    "numbered in the sale run", out.challan?.challan_number);
  check(out.challan?.kind === "sale" && out.challan?.status === "pending",
    "and starts pending", { kind: out.challan?.kind, status: out.challan?.status });
  check(Number(out.challan?.total_value) === 2000,
    "its value is the goods, with NO tax added", out.challan?.total_value);

  const inward = await challanBook.create(owner, {
    kind: "purchase", supplierId: supplier, reason: "bill_to_follow",
    supplierChallanNumber: `MM/${s}/77`,
    lines: [{ itemName: "Grey yarn", quantity: 100, unit: "kg", rate: 90, gstPercent: 5 }],
  });
  check(!inward.error, "a purchase challan is recorded", inward.error);
  check(inward.challan?.challan_number?.startsWith("PC/"),
    "numbered in its OWN run, not the sale one", inward.challan?.challan_number);
  check(inward.challan?.supplier_challan_number === `MM/${s}/77`,
    "and it keeps the supplier's own number off the paper that came with the goods");

  console.log("\nThe two runs do not borrow from each other");
  const out2 = await challanBook.create(owner, {
    kind: "sale", partyId: party,
    lines: [{ itemName: "Poplin", quantity: 10, rate: 100 }],
  });
  const in2 = await challanBook.create(owner, {
    kind: "purchase", supplierId: supplier,
    lines: [{ itemName: "Dye", quantity: 5, rate: 50 }],
  });
  const seq = (n) => Number(String(n).split("/")[1]);
  check(seq(out2.challan.challan_number) === seq(out.challan.challan_number) + 1,
    "the sale run is consecutive in itself",
    [out.challan.challan_number, out2.challan.challan_number]);
  check(seq(in2.challan.challan_number) === seq(inward.challan.challan_number) + 1,
    "and so is the purchase run",
    [inward.challan.challan_number, in2.challan.challan_number]);

  // ------------------------------------------------------------------
  console.log("\nIt moves stock, never the party's balance");
  // ------------------------------------------------------------------
  const owed = await testPool.query(
    `SELECT COALESCE(SUM(total),0) AS billed FROM sales WHERE wholesaler_id=$1`, [owner]);
  check(Number(owed.rows[0].billed) === 0,
    "four challans, and the customer owes nothing yet", owed.rows[0]);
  const payments = await testPool.query(
    `SELECT COUNT(*)::int n FROM party_payments WHERE wholesaler_id=$1`, [owner]);
  check(payments.rows[0].n === 0, "and no money has moved");

  // ------------------------------------------------------------------
  console.log("\nWhat is waiting to be billed, per party");
  // ------------------------------------------------------------------
  const pendingSale = await challanBook.pendingFor(owner, "sale", party);
  check(pendingSale.length === 2, "two sale challans pending for this customer",
    pendingSale.map((c) => c.challan_number));
  check(Array.isArray(pendingSale[0].lines) && pendingSale[0].lines.length === 1,
    "and they carry their lines, so the sale form can load them",
    pendingSale[0].lines);
  check(pendingSale[0].lines[0].gstPercent !== undefined,
    "including the rate they will be billed at", pendingSale[0].lines[0]);
  const pendingBuy = await challanBook.pendingFor(owner, "purchase", supplier);
  check(pendingBuy.length === 2, "two purchase challans pending for this supplier");
  check(await challanBook.pendingFor(owner, "sale", supplier).then((r) => r.length === 0),
    "a supplier id does not find sale challans");

  // ------------------------------------------------------------------
  console.log("\nEditing, while it is still pending");
  // ------------------------------------------------------------------
  const edited = await challanBook.update(out2.challan.id, owner, {
    reason: "on_approval",
    lines: [{ itemName: "Poplin", quantity: 12, rate: 100 },
            { itemName: "Lining", quantity: 4, rate: 50 }],
  });
  check(!edited.error, "a pending challan can be changed", edited.error);
  check(Number(edited.challan?.total_value) === 1400,
    "and its value follows the new lines", edited.challan?.total_value);
  const editedLines = await testPool.query(
    `SELECT COUNT(*)::int n FROM delivery_challan_items WHERE challan_id=$1`,
    [out2.challan.id]);
  check(editedLines.rows[0].n === 2, "the old lines were replaced, not added to",
    editedLines.rows[0]);

  // ------------------------------------------------------------------
  console.log("\nBilling it: the sale form posts back the challans it used");
  // ------------------------------------------------------------------
  const res = mk();
  await saleController.createSale({
    user: { id: owner, role: "seller" },
    body: {
      partyId: party, amountPaid: 0, paymentMethod: "cash",
      challanIds: [out.challan.id, out2.challan.id],
      lines: [{ itemName: "Cotton shirting", quantity: 20, rate: 100,
                hsnCode: "52081110", gstPercent: 5 },
              { itemName: "Poplin", quantity: 12, rate: 100, gstPercent: 5 },
              { itemName: "Lining", quantity: 4, rate: 50, gstPercent: 5 }],
    },
  }, res);
  check(res.statusCode === 201, "one sale covers both challans", res.body);
  const saleId = res.body.id;

  const closed = await testPool.query(
    `SELECT challan_number, status, sale_id FROM delivery_challans
      WHERE id = ANY($1::uuid[]) ORDER BY challan_number`,
    [[out.challan.id, out2.challan.id]]);
  check(closed.rows.every((r) => r.status === "billed" && r.sale_id === saleId),
    "both are stamped billed and point at that sale",
    closed.rows.map((r) => `${r.challan_number}:${r.status}`));
  check((await challanBook.pendingFor(owner, "sale", party)).length === 0,
    "and nothing is left pending for that customer");

  console.log("\nAnd now the money exists");
  const nowOwed = await testPool.query(
    `SELECT total FROM sales WHERE id=$1`, [saleId]);
  check(Number(nowOwed.rows[0].total) === 3570,
    "the sale carries the tax the challans never did", nowOwed.rows[0]);

  // ------------------------------------------------------------------
  console.log("\nThe same goods cannot be billed twice");
  // ------------------------------------------------------------------
  const again = mk();
  await saleController.createSale({
    user: { id: owner, role: "seller" },
    body: {
      partyId: party, amountPaid: 0, paymentMethod: "cash",
      challanIds: [out.challan.id],
      lines: [{ itemName: "Cotton shirting", quantity: 20, rate: 100, gstPercent: 5 }],
    },
  }, again);
  check(again.statusCode === 409 && again.body?.code === "CHALLAN_TAKEN",
    "a second sale against an already billed challan is refused",
    { s: again.statusCode, code: again.body?.code });
  const salesNow = await testPool.query(
    `SELECT COUNT(*)::int n FROM sales WHERE wholesaler_id=$1`, [owner]);
  check(salesNow.rows[0].n === 1, "and no half written sale was left behind",
    salesNow.rows[0]);

  console.log("\nA billed challan is closed for good");
  const lateEdit = await challanBook.update(out.challan.id, owner, {
    lines: [{ itemName: "Something else", quantity: 1, rate: 1 }],
  });
  check(!!lateEdit.error && /billed/.test(lateEdit.error),
    "it cannot be edited", lateEdit.error);
  const lateCancel = await challanBook.cancel(out.challan.id, owner, "changed my mind");
  check(!!lateCancel.error, "and it cannot be cancelled", lateCancel.error);

  // ------------------------------------------------------------------
  console.log("\nThe purchase side, the same way round");
  // ------------------------------------------------------------------
  const pres = mk();
  await purchaseController.createPurchase({
    user: { id: owner, role: "seller" },
    body: {
      supplierId: supplier, supplierInvoiceNumber: `MM/${s}/BILL`,
      amountPaid: 0, challanIds: [inward.challan.id, in2.challan.id],
      lines: [{ itemName: "Grey yarn", quantity: 100, rate: 90, gstPercent: 5 },
              { itemName: "Dye", quantity: 5, rate: 50, gstPercent: 5 }],
    },
  }, pres);
  check(pres.statusCode === 201, "one purchase covers both purchase challans", pres.body);
  const closedBuy = await testPool.query(
    `SELECT status, purchase_id FROM delivery_challans WHERE id = ANY($1::uuid[])`,
    [[inward.challan.id, in2.challan.id]]);
  check(closedBuy.rows.every((r) => r.status === "billed" && r.purchase_id === pres.body.id),
    "both stamped and pointing at the purchase",
    closedBuy.rows.map((r) => r.status));

  // ------------------------------------------------------------------
  console.log("\nCancelling one raised in error");
  // ------------------------------------------------------------------
  const spare = await challanBook.create(owner, {
    kind: "sale", partyId: party,
    lines: [{ itemName: "Wrong item", quantity: 1, rate: 10 }],
  });
  const gone = await challanBook.cancel(spare.challan.id, owner, "typed the wrong customer");
  check(!gone.error, "a pending challan can be cancelled", gone.error);
  const still = await testPool.query(
    `SELECT status, cancelled_reason FROM delivery_challans WHERE id=$1`,
    [spare.challan.id]);
  check(still.rows[0].status === "cancelled" && still.rows.length === 1,
    "and the row survives, because the paper went out of the gate", still.rows[0]);
  check((await challanBook.pendingFor(owner, "sale", party)).length === 0,
    "a cancelled challan is not offered for billing");

  // ------------------------------------------------------------------
  console.log("\nWhat it refuses");
  // ------------------------------------------------------------------
  const bad = [
    [{ kind: "nonsense", partyId: party, lines: [{ itemName: "x" }] }, /sale or a purchase/],
    [{ kind: "sale", lines: [{ itemName: "x" }] }, /Choose the customer/],
    [{ kind: "purchase", lines: [{ itemName: "x" }] }, /Choose the supplier/],
    [{ kind: "sale", partyId: party, lines: [] }, /at least one item/],
    [{ kind: "sale", partyId: party, lines: [{ itemName: "" }] }, /no item name/],
    [{ kind: "sale", partyId: party, reason: "because", lines: [{ itemName: "x" }] },
      /not a reason/],
    [{ kind: "sale", partyId: supplier, lines: [{ itemName: "x" }] },
      /not in your book/],
  ];
  for (const [body, pattern] of bad) {
    const r = await challanBook.create(owner, body);
    check(!!r.error && pattern.test(r.error),
      `refused: ${JSON.stringify(body.kind)} ${pattern}`, r.error);
  }

  // ------------------------------------------------------------------
  console.log("\nThe bill no longer waits for the money");
  // ------------------------------------------------------------------
  const unpaid = mk();
  await saleController.createSale({
    user: { id: owner, role: "seller" },
    body: { partyId: party, amountPaid: 0, paymentMethod: "cash",
            lines: [{ itemName: "Unpaid cloth", quantity: 1, rate: 100, gstPercent: 5 }] },
  }, unpaid);
  const raised = await saleInvoiceService.createInvoiceFromSale(unpaid.body.id, owner);
  check(!!raised.invoice,
    "a wholly unpaid sale can be billed, which section 31(1) requires", raised);

  // ------------------------------------------------------------------
  console.log("\nAnother wholesaler's book is not reachable");
  // ------------------------------------------------------------------
  const other = (await testPool.query(
    `INSERT INTO users (first_name,last_name,email,password_hash,phone,role)
     VALUES ('OT','Seth',$1,'x',$2,'seller') RETURNING id`,
    [`ot-${s}@example.com`, `75${dial}`])).rows[0].id;
  const stolen = await challanBook.create(other, {
    kind: "sale", partyId: party, lines: [{ itemName: "x", quantity: 1, rate: 1 }],
  });
  check(!!stolen.error, "another wholesaler cannot raise one against your customer",
    stolen.error);
  check((await challanBook.list(other, "sale")).length === 0,
    "and sees none of your challans");
  const notTheirs = await challanBook.update(spare.challan.id, other, {
    lines: [{ itemName: "x", quantity: 1, rate: 1 }] });
  check(notTheirs.error === "notFound", "nor can they edit one", notTheirs.error);

  // ------------------------------------------------------------------
  console.log("\nThe things a sweep found after the first build");
  // ------------------------------------------------------------------
  // A BILLED PURCHASE CHALLAN reads as billed. It points at a purchase and
  // never at an invoice, and the screen used to test invoice_id alone, so a
  // billed purchase challan showed "Not billed".
  const billedBuy = (await testPool.query(
    `SELECT status, invoice_id, purchase_id FROM delivery_challans WHERE id = $1`,
    [inward.challan.id])).rows[0];
  check(billedBuy.status === "billed" && !billedBuy.invoice_id && !!billedBuy.purchase_id,
    "a billed purchase challan carries purchase_id and no invoice_id, so status is the only honest test",
    billedBuy);

  /**
   * THE PDF POINTS THE RIGHT WAY. An inward challan came FROM the supplier,
   * so printing "FROM <us>" on it reads exactly backwards.
   *
   * Read through pdftotext, not by searching the bytes. pdfkit compresses the
   * content stream, so `buffer.includes("DELIVER TO")` is false on a PDF that
   * says it in letters an inch high, and an assertion written that way passes
   * and fails for reasons that have nothing to do with the document.
   */
  const textOf = async (challanId) => {
    const full = await challanService.findById(challanId, owner);
    const file = path.join(os.tmpdir(), `challan-${challanId}.pdf`);
    fs.writeFileSync(file, await pdfService.generateChallanPDF(full));
    try {
      return { full, text: execFileSync("pdftotext", [file, "-"], { encoding: "utf8" }) };
    } finally {
      fs.rmSync(file, { force: true });
    }
  };

  const buy = await textOf(inward.challan.id);
  check(buy.text.includes("RECEIVED FROM") && !buy.text.includes("DELIVER TO"),
    "a purchase challan prints RECEIVED FROM, not DELIVER TO");
  const sell = await textOf(out.challan.id);
  check(sell.text.includes("DELIVER TO") && !sell.text.includes("RECEIVED FROM"),
    "and a sale challan prints DELIVER TO");
  const sellFull = sell.full;

  // NO INVENTED DEBT. amount_paid is zero on a movement challan because
  // nothing was ever paid against a challan, not because the whole value is
  // owed. The money block used to key off sale_id, which stampBilled sets, so
  // it came back the moment a challan was used.
  check(Number(sellFull.amount_paid) === 0 && !!sellFull.sale_id,
    "a billed movement challan has a sale_id and no money on it, which is the trap",
    { paid: sellFull.amount_paid, sale: !!sellFull.sale_id });
  check(!sell.text.includes("Balance on this date"),
    "so its PDF states no balance at all");

  // And the old part paid snapshot still prints, because that one is real.
  await testPool.query(
    `UPDATE delivery_challans SET amount_paid = 500 WHERE id = $1`, [in2.challan.id]);
  const snap = await textOf(in2.challan.id);
  check(snap.text.includes("Balance on this date"),
    "while a challan that really did receive money still shows what it received");
  await testPool.query(
    `UPDATE delivery_challans SET amount_paid = 0 WHERE id = $1`, [in2.challan.id]);

  // ------------------------------------------------------------------
  console.log("\nA database that has NOT had the migration still works");
  // ------------------------------------------------------------------
  /**
   * Migrations here are applied by hand, so between a deploy and somebody
   * pasting the SQL there is a live database on the new code without the new
   * columns. That window broke once already: the stampers guarded `status`
   * with `SET status = CASE WHEN $3 ...`, which reads like a guard and is
   * not, because Postgres parses the whole statement before running it. Every
   * sale that billed a challan answered `column "status" does not exist`.
   *
   * Simulated by hiding the column rather than by dropping it, so the suite
   * does not have to tear down and rebuild a second database.
   */
  await testPool.query(`ALTER TABLE delivery_challans RENAME COLUMN status TO status_hidden`);
  challanService.resetChallanTables?.();
  try {
    const legacySale = mk();
    await saleController.createSale({
      user: { id: owner, role: "seller" },
      body: { partyId: party, amountPaid: 0, paymentMethod: "cash",
              lines: [{ itemName: "Old way", quantity: 1, rate: 100, gstPercent: 5 }] },
    }, legacySale);
    check(legacySale.statusCode === 201,
      "a sale can still be recorded without the challan columns", legacySale.body);

    const total2 = (await testPool.query(
      `SELECT total FROM sales WHERE id=$1`, [legacySale.body.id])).rows[0].total;
    await testPool.query(
      `INSERT INTO party_payments (wholesaler_id, party_id, sale_id, amount, method)
       VALUES ($1,$2,$3,$4,'cash')`, [owner, party, legacySale.body.id, total2]);
    const legacyBill = await saleInvoiceService.createInvoiceFromSale(legacySale.body.id, owner);
    check(!!legacyBill.invoice,
      "and a bill raised for it, which is where the parse error used to land",
      legacyBill.error || legacyBill);
  } finally {
    await testPool.query(
      `ALTER TABLE delivery_challans RENAME COLUMN status_hidden TO status`);
    challanService.resetChallanTables?.();
  }

  // ------------------------------------------------------------------
  console.log("\nThe line carries its product and its rate through an edit");
  // ------------------------------------------------------------------
  /**
   * The item box on the challan form suggests from the wholesaler's own
   * products, and picking one sets product_id alongside the name. The name is
   * still the content, exactly as it is on a sale line: a challan for
   * something that was never on the list has to stay recordable.
   *
   * What this pins is the ROUND TRIP. `findById` is what the edit form reads,
   * and it selected six columns, not gst_percent and not product_id. So
   * opening a challan and saving it again dropped the GST rate off every line
   * it had one on, and would have dropped the product link too. Nothing
   * failed and nothing said anything: the form simply loaded a blank where a
   * number had been, and wrote the blank back.
   */
  /**
   * The id a picked line carries is the row from /api/dashboard/inventory,
   * which is supplier_inventory.id, the same id the sale form's picker hands
   * back. `supplier_id` on that table is the wholesaler: the marketplace half
   * of this product calls him the supplier of the listing.
   */
  const catalogue = (await testPool.query(
    `INSERT INTO products (name, category) VALUES ($1,'Textiles') RETURNING id`,
    [`Shirting ${s}`])).rows[0].id;
  const prod = (await testPool.query(
    `INSERT INTO supplier_inventory (supplier_id, product_id, price, moq, stock, shipping_days, unit, hsn_code, gst_percent, status)
     VALUES ($1,$2,250,1,500,2,'mtr','5208',12,'Active') RETURNING id`,
    [owner, catalogue])).rows[0];

  const withProduct = await challanBook.create(owner, {
    kind: "sale", partyId: party, reason: "bill_to_follow",
    lines: [{ itemName: "Picked off the list", quantity: 4, rate: 250,
              gstPercent: 12, hsnCode: "5208",
              productId: prod ? prod.id : null }],
  });
  check(!withProduct.error, "a challan saves a line that names a product",
    withProduct.error);

  const readBack = await challanService.findById(withProduct.challan.id, owner);
  const line0 = (readBack?.items || [])[0] || {};
  check(Number(line0.gst_percent) === 12,
    "and findById gives the GST rate back, which the edit form reloads",
    { got: line0.gst_percent });
  if (prod) {
    check(line0.product_id === prod.id,
      "and the product the line was picked from", { got: line0.product_id });
  }

  const reEdited = await challanBook.update(withProduct.challan.id, owner, {
    kind: "sale", partyId: party, reason: "bill_to_follow",
    lines: [{ itemName: "Picked off the list", quantity: 9, rate: 250,
              gstPercent: 12, hsnCode: "5208",
              productId: prod ? prod.id : null }],
  });
  check(!reEdited.error, "the challan can be edited", reEdited.error);

  const afterEdit = await challanService.findById(withProduct.challan.id, owner);
  const line1 = (afterEdit?.items || [])[0] || {};
  check(Number(line1.quantity) === 9, "the quantity changed", { got: line1.quantity });
  check(Number(line1.gst_percent) === 12,
    "and the GST rate survived the edit rather than coming back blank",
    { got: line1.gst_percent });

  /**
   * And the same read on a database without those columns. findById picks its
   * column list from a probe, so this is the branch that runs between a
   * deploy and somebody pasting the migration.
   */
  await testPool.query(
    `ALTER TABLE delivery_challan_items RENAME COLUMN product_id TO product_id_hidden`);
  challanService.resetChallanTables?.();
  try {
    const legacyRead = await challanService.findById(withProduct.challan.id, owner);
    check(!!legacyRead && (legacyRead.items || []).length === 1,
      "a challan still opens on a database without the line columns",
      legacyRead);
    check((legacyRead.items || [])[0]?.product_id === undefined,
      "and simply has no product on the line, rather than throwing",
      (legacyRead.items || [])[0]);
  } finally {
    await testPool.query(
      `ALTER TABLE delivery_challan_items RENAME COLUMN product_id_hidden TO product_id`);
    challanService.resetChallanTables?.();
  }

  // ------------------------------------------------------------------
  console.log("\nA challan billed by a SALE says so on every screen");
  // ------------------------------------------------------------------
  /**
   * Reported from the running app on 18 Sept: a brand new challan showed a
   * due, and a billed one showed a due under its own Billed badge.
   *
   * Two faults, both from reading the wrong column.
   *
   * 1. The list worked out `total_value - amount_paid` and called it "due".
   *    On a movement challan amount_paid is always zero, so every row printed
   *    the whole value of the goods as a debt, on a document whose entire
   *    point is that nothing is owed until the bill. The list query did not
   *    even SELECT amount_paid, so the sum was `total - undefined`.
   *
   * 2. Every "is it billed" test outside the challan list read `invoice_id`.
   *    A challan billed through a SALE gets status 'billed' and a sale_id and
   *    NEVER an invoice_id, so those screens disagreed with each other about
   *    the same document.
   */
  const forList = await challanBook.create(owner, {
    kind: "sale", partyId: party,
    lines: [{ itemName: "List check", quantity: 4, rate: 100 }],
  });

  const listed = (await challanBook.list(owner, "sale"))
    .find((c) => c.id === forList.challan.id);
  check(listed !== undefined, "a new challan appears in the list");
  check(listed.amount_paid !== undefined,
    "the list returns amount_paid, so a money test is a real test rather "
    + "than total minus undefined", { got: listed.amount_paid });
  check(Number(listed.amount_paid) === 0,
    "and it is zero, because a challan takes no money", listed.amount_paid);

  const billedBySale = mk();
  await saleController.createSale({
    user: { id: owner, role: "seller" },
    body: { partyId: party, amountPaid: 0, paymentMethod: "cash",
            challanIds: [forList.challan.id],
            lines: [{ itemName: "List check", quantity: 4, rate: 100,
                      gstPercent: 5, fromChallan: forList.challan.id }] },
  }, billedBySale);
  check(billedBySale.statusCode === 201, "it is billed from a sale",
    billedBySale.body);

  const afterBilling = (await challanBook.list(owner, "sale"))
    .find((c) => c.id === forList.challan.id);
  check(afterBilling.status === "billed", "the list says billed",
    afterBilling.status);
  check(!afterBilling.invoice_id,
    "and carries NO invoice_id, which is why status has to be the authority",
    afterBilling.invoice_id);

  const onTheSale = await challanService.listForSale(
    billedBySale.body.id, owner);
  check(onTheSale.length === 1, "the sale screen lists it", onTheSale.length);
  check(onTheSale[0].status === "billed",
    "and gets the status, so the Billed badge can appear there too",
    onTheSale[0].status);

  console.log(fails ? `\n${fails} FAILED\n` : "\nall good\n");
  await testPool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("THREW", e); process.exit(1); });

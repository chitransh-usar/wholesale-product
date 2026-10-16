/**
 * The stock ledger.
 *
 * What this pins, and why each one would hurt:
 *
 *   a sale takes goods out               before this, nothing in the khata
 *                                        moved stock at all
 *   a purchase brings them in            same
 *   a challan moves them when they move   that is what the document is for
 *   A BILL RAISED FROM A CHALLAN MOVES    otherwise the same cloth leaves
 *   NOTHING                               twice and both rows look correct
 *   cancelling reverses, never deletes    a cancelled document still happened
 *   reversing twice is a no op            cancel is a button people press twice
 *   the figure is a SUM, never a counter  a stored counter drifts silently
 *
 *     createdb qa_stock
 *     DATABASE_URL="postgres://postgres@127.0.0.1:5433/qa_stock?sslmode=disable" npm run migrate
 *     node scripts/stock_check.js qa_stock
 */
const Module = require("module");
const { Pool } = require("pg");

const DB = process.argv[2] || "qa_stock";
const dbPath = require.resolve("../src/config/db");
const testPool = new Pool({ connectionString: `postgres://postgres@127.0.0.1:5433/${DB}` });
const stub = new Module(dbPath, null);
stub.exports = testPool;
stub.loaded = true;
require.cache[dbPath] = stub;

const stockLedger = require("../src/services/stockLedger");
const challanBook = require("../src/services/challanBook");
const saleController = require("../src/controllers/saleController");
const purchaseController = require("../src/controllers/purchaseController");

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

const onHand = async (owner, productId) => {
  const { rows } = await testPool.query(
    `SELECT COALESCE(SUM(quantity), 0) AS n FROM stock_ledger
      WHERE wholesaler_id = $1 AND product_id = $2`, [owner, productId]);
  return Number(rows[0].n);
};

(async () => {
  const s = Date.now().toString(36).slice(-6);
  const dial = String(Date.now()).slice(-7);

  const owner = (await testPool.query(
    `INSERT INTO users (first_name,last_name,email,password_hash,phone,role)
     VALUES ('SL','Seth',$1,'x',$2,'seller') RETURNING id`,
    [`sl-${s}@example.com`, `74${dial}`])).rows[0].id;
  await testPool.query(
    `INSERT INTO wholesaler_profiles (user_id,company_name,gstin,city,warehouse_state)
     VALUES ($1,$2,'27AAAPA1234A1Z5','Bhiwandi','Maharashtra')`, [owner, `Stock ${s}`]);
  await testPool.query(
    `INSERT INTO invoice_settings (user_id,prefix) VALUES ($1,$2)`, [owner, `S${s}/`]);
  const party = (await testPool.query(
    `INSERT INTO parties (wholesaler_id,name,city,state,phone)
     VALUES ($1,$2,'Surat','Gujarat',$3) RETURNING id`,
    [owner, `Ramesh ${s}`, `98${dial}`])).rows[0].id;
  const supplier = (await testPool.query(
    `INSERT INTO suppliers (wholesaler_id,name,city,phone)
     VALUES ($1,$2,'Bhiwandi',$3) RETURNING id`,
    [owner, `Mohan Mills ${s}`, `88${dial}`])).rows[0].id;

  const catalogue = (await testPool.query(
    `INSERT INTO products (name, category) VALUES ($1,'Textiles') RETURNING id`,
    [`Shirting ${s}`])).rows[0].id;
  const item = (await testPool.query(
    `INSERT INTO supplier_inventory
       (supplier_id, product_id, price, moq, stock, shipping_days, unit, hsn_code, gst_percent, status)
     VALUES ($1,$2,250,1,500,2,'mtr','5208',5,'Active') RETURNING id`,
    [owner, catalogue])).rows[0].id;

  // ------------------------------------------------------------------
  console.log("\nGoods in, goods out");
  // ------------------------------------------------------------------
  check(await onHand(owner, item) === 0, "a product nothing has happened to is at zero");

  const buy = mk();
  await purchaseController.createPurchase({
    user: { id: owner, role: "seller" },
    body: { supplierId: supplier, purchaseDate: "2026-09-01",
            supplierInvoiceNumber: `MM/${s}/1`, amountPaid: 0,
            lines: [{ itemName: "Shirting", quantity: 100, rate: 200,
                      gstPercent: 5, productId: item }] },
  }, buy);
  check(buy.statusCode === 201, "a purchase is entered", buy.body);
  check(await onHand(owner, item) === 100,
    "and 100 metres came IN", await onHand(owner, item));

  const sell = mk();
  await saleController.createSale({
    user: { id: owner, role: "seller" },
    body: { partyId: party, saleDate: "2026-09-02", amountPaid: 0,
            paymentMethod: "cash",
            lines: [{ itemName: "Shirting", quantity: 30, rate: 250,
                      gstPercent: 5, productId: item }] },
  }, sell);
  check(sell.statusCode === 201, "a sale is recorded", sell.body);
  check(await onHand(owner, item) === 70,
    "and 30 went OUT, leaving 70", await onHand(owner, item));

  // ------------------------------------------------------------------
  console.log("\nA challan moves the goods when the goods move");
  // ------------------------------------------------------------------
  const out = await challanBook.create(owner, {
    kind: "sale", partyId: party, reason: "bill_to_follow",
    issueDate: "2026-09-03",
    lines: [{ itemName: "Shirting", quantity: 20, unit: "mtr", rate: 250,
              gstPercent: 5, productId: item }],
  });
  check(!out.error, "a sale challan is recorded", out.error);
  check(await onHand(owner, item) === 50,
    "and the 20 metres left on it are out of stock now, leaving 50",
    await onHand(owner, item));

  // ------------------------------------------------------------------
  console.log("\nTHE BILL FOR THAT CHALLAN MOVES NOTHING");
  // ------------------------------------------------------------------
  /**
   * The one that matters. The goods left on the challan. Billing them is a
   * money event, not a goods event, and a ledger that took them out again
   * would be short by the whole challan with two rows that each look right.
   */
  const billed = mk();
  await saleController.createSale({
    user: { id: owner, role: "seller" },
    body: { partyId: party, saleDate: "2026-09-04", amountPaid: 0,
            paymentMethod: "cash", challanIds: [out.challan.id],
            lines: [{ itemName: "Shirting", quantity: 20, rate: 250,
                      gstPercent: 5, productId: item,
                      fromChallan: out.challan.id }] },
  }, billed);
  check(billed.statusCode === 201, "the challan is billed", billed.body);
  check(await onHand(owner, item) === 50,
    "and stock did NOT move again: still 50, not 30",
    await onHand(owner, item));

  const movements = (await testPool.query(
    `SELECT document_kind, quantity FROM stock_ledger
      WHERE wholesaler_id = $1 AND product_id = $2 ORDER BY created_at`,
    [owner, item])).rows;
  check(movements.length === 3,
    "three movements, not four: purchase, sale, challan",
    movements.map((m) => `${m.document_kind} ${m.quantity}`));

  // And a line typed straight onto a bill, with no challan, still moves.
  const plain = mk();
  await saleController.createSale({
    user: { id: owner, role: "seller" },
    body: { partyId: party, saleDate: "2026-09-05", amountPaid: 0,
            paymentMethod: "cash",
            lines: [{ itemName: "Shirting", quantity: 5, rate: 250,
                      gstPercent: 5, productId: item }] },
  }, plain);
  check(await onHand(owner, item) === 45,
    "a line typed straight onto a bill still moves the goods",
    await onHand(owner, item));

  // ------------------------------------------------------------------
  console.log("\nCancelling gives the goods back, and never deletes");
  // ------------------------------------------------------------------
  const before = (await testPool.query(
    `SELECT COUNT(*)::int n FROM stock_ledger WHERE wholesaler_id = $1`, [owner])).rows[0].n;

  const killed = mk();
  await saleController.updateSaleStatus({
    user: { id: owner, role: "seller" },
    params: { id: plain.body.id },
    body: { status: "cancelled" },
  }, killed);
  check(killed.statusCode === 200, "the sale is cancelled", killed.body);
  check(await onHand(owner, item) === 50,
    "the 5 metres came back, 45 to 50", await onHand(owner, item));

  const after = (await testPool.query(
    `SELECT COUNT(*)::int n FROM stock_ledger WHERE wholesaler_id = $1`, [owner])).rows[0].n;
  check(after === before + 1,
    "by ADDING a reversing row, not by deleting the original",
    { before, after });

  // Pressing cancel twice must not give the goods back twice.
  const again = mk();
  await saleController.updateSaleStatus({
    user: { id: owner, role: "seller" },
    params: { id: plain.body.id },
    body: { status: "cancelled" },
  }, again);
  check(await onHand(owner, item) === 50,
    "cancelling a second time changes nothing", await onHand(owner, item));

  // A cancelled challan gives its goods back too.
  const out2 = await challanBook.create(owner, {
    kind: "sale", partyId: party,
    lines: [{ itemName: "Shirting", quantity: 8, rate: 250, productId: item }],
  });
  check(await onHand(owner, item) === 42, "another challan takes 8 out");
  await challanBook.cancel(out2.challan.id, owner, "Sent in error");
  check(await onHand(owner, item) === 50,
    "and cancelling it puts them back", await onHand(owner, item));

  // ------------------------------------------------------------------
  console.log("\nEditing a challan restates what it moved");
  // ------------------------------------------------------------------
  const edit = await challanBook.create(owner, {
    kind: "sale", partyId: party,
    lines: [{ itemName: "Shirting", quantity: 20, rate: 250, productId: item }],
  });
  check(await onHand(owner, item) === 30, "20 out on a new challan");
  await challanBook.update(edit.challan.id, owner, {
    lines: [{ itemName: "Shirting", quantity: 15, rate: 250, productId: item }],
  });
  check(await onHand(owner, item) === 35,
    "edited down to 15, so 5 came back rather than 15 going out again",
    await onHand(owner, item));

  // ------------------------------------------------------------------
  console.log("\nWhat the screens read");
  // ------------------------------------------------------------------
  const rows = await stockLedger.balances(owner);
  const mine = rows.find((r) => r.product_id === item);
  check(Number(mine?.on_hand) === 35, "the balance matches the sum", mine?.on_hand);
  check(Number(mine?.offered_on_shop) === 500,
    "and the shop figure is reported SEPARATELY, not merged into it",
    mine?.offered_on_shop);

  const reg = await stockLedger.register(owner, item);
  check(reg.length >= 8, "the register lists every movement", reg.length);
  const last = reg[reg.length - 1];
  check(Number(last.running) === 35,
    "with a running balance that ends where the total does", last.running);

  // ------------------------------------------------------------------
  console.log("\nA purchase challan brings goods IN, and its bill does not");
  // ------------------------------------------------------------------
  const inward = await challanBook.create(owner, {
    kind: "purchase", supplierId: supplier,
    lines: [{ itemName: "Shirting", quantity: 60, rate: 200, productId: item }],
  });
  check(await onHand(owner, item) === 95, "60 in on a purchase challan",
    await onHand(owner, item));

  const buy2 = mk();
  await purchaseController.createPurchase({
    user: { id: owner, role: "seller" },
    body: { supplierId: supplier, purchaseDate: "2026-09-08",
            supplierInvoiceNumber: `MM/${s}/2`, amountPaid: 0,
            challanIds: [inward.challan.id],
            lines: [{ itemName: "Shirting", quantity: 60, rate: 200,
                      gstPercent: 5, productId: item,
                      fromChallan: inward.challan.id }] },
  }, buy2);
  check(buy2.statusCode === 201, "and the supplier's bill is entered against it", buy2.body);
  check(await onHand(owner, item) === 95,
    "the goods do NOT arrive twice: still 95, not 155",
    await onHand(owner, item));

  // ------------------------------------------------------------------
  console.log("\nA database that has NOT had the migration still works");
  // ------------------------------------------------------------------
  /**
   * Migrations here are pasted by hand, so between a deploy and somebody
   * running the SQL there is a live database on this code with no ledger. A
   * sale that cannot be recorded because stock has nowhere to go would be a
   * far worse failure than one that simply does not track stock yet.
   */
  await testPool.query(`ALTER TABLE stock_ledger RENAME TO stock_ledger_hidden`);
  stockLedger.resetStockLedger();
  try {
    const legacy = mk();
    await saleController.createSale({
      user: { id: owner, role: "seller" },
      body: { partyId: party, amountPaid: 0, paymentMethod: "cash",
              lines: [{ itemName: "Shirting", quantity: 2, rate: 250,
                        gstPercent: 5, productId: item }] },
    }, legacy);
    check(legacy.statusCode === 201,
      "a sale is still recorded with no ledger table at all", legacy.body);

    const legacyChallan = await challanBook.create(owner, {
      kind: "sale", partyId: party,
      lines: [{ itemName: "Shirting", quantity: 2, rate: 250 }],
    });
    check(!legacyChallan.error, "and a challan", legacyChallan.error);

    check((await stockLedger.balances(owner)).length === 0,
      "and the balances read comes back empty rather than throwing");
  } finally {
    await testPool.query(`ALTER TABLE stock_ledger_hidden RENAME TO stock_ledger`);
    stockLedger.resetStockLedger();
  }

  // ------------------------------------------------------------------
  console.log("\nThe credit limit is TOLD, never enforced");
  // ------------------------------------------------------------------
  /**
   * parties.credit_limit has existed since the opening balance migration and
   * was read by nothing, so it looked like a control and was not. It warns
   * now, and deliberately does not block: the wholesaler is writing down a
   * sale whose goods have already gone, and refusing it would lose the sale
   * from the khata rather than undo it.
   */
  const capped = (await testPool.query(
    `INSERT INTO parties (wholesaler_id,name,city,phone,credit_limit)
     VALUES ($1,$2,'Surat',$3,1000) RETURNING id`,
    [owner, `Capped ${s}`, `97${dial}`])).rows[0].id;

  const under = mk();
  await saleController.createSale({
    user: { id: owner, role: "seller" },
    body: { partyId: capped, amountPaid: 0, paymentMethod: "cash",
            lines: [{ itemName: "Shirting", quantity: 1, rate: 500, gstPercent: 0 }] },
  }, under);
  check(under.statusCode === 201, "a sale inside the limit is recorded");
  check(!under.body.creditWarning, "with no warning", under.body.creditWarning);

  const over = mk();
  await saleController.createSale({
    user: { id: owner, role: "seller" },
    body: { partyId: capped, amountPaid: 0, paymentMethod: "cash",
            lines: [{ itemName: "Shirting", quantity: 1, rate: 900, gstPercent: 0 }] },
  }, over);
  check(over.statusCode === 201,
    "a sale that takes him PAST it is still recorded, not refused", over.statusCode);
  check(!!over.body.creditWarning, "and comes back with a warning",
    over.body.creditWarning);
  check(Number(over.body.creditWarning?.balance) === 1400,
    "naming what he owes now", over.body.creditWarning?.balance);
  check(Number(over.body.creditWarning?.over) === 400,
    "and how far past the limit that is", over.body.creditWarning?.over);

  const noLimit = mk();
  await saleController.createSale({
    user: { id: owner, role: "seller" },
    body: { partyId: party, amountPaid: 0, paymentMethod: "cash",
            lines: [{ itemName: "Shirting", quantity: 1, rate: 90000, gstPercent: 0 }] },
  }, noLimit);
  check(!noLimit.body.creditWarning,
    "a customer with no limit set is never warned about", noLimit.body.creditWarning);

  // ------------------------------------------------------------------
  console.log("\nA new product opens the book with what he already holds");
  // ------------------------------------------------------------------
  /**
   * The Add product form carried a `stock` key that the form never asked for,
   * so the server was sent Number("") and every product ever added through
   * that screen was created holding nothing.
   *
   * With a box for it, the figure does two different things on purpose: it
   * sets what the shop page OFFERS, and it opens the book with an 'opening'
   * ledger row. Without the second the Stock screen shows nothing until the
   * first sale and then shows a NEGATIVE, because goods leave a book that
   * never recorded them arriving.
   */
  const productController = require("../src/controllers/productController");

  const added = mk();
  await productController.addProduct({
    user: { id: owner, role: "seller" },
    body: { name: `Opening ${s}`, category: "Textiles", price: 300, moq: 1,
            stock: 500, shippingDays: 2, unit: "mtr", visibility: "public" },
  }, added);
  check(added.statusCode === 201, "a product is added with an opening stock",
    added.body);

  const opened = (await testPool.query(
    `SELECT si.id FROM supplier_inventory si
       JOIN products p ON p.id = si.product_id
      WHERE si.supplier_id = $1 AND p.name = $2`, [owner, `Opening ${s}`])).rows[0].id;
  check(await onHand(owner, opened) === 500,
    "and the book opens at 500, not at nothing", await onHand(owner, opened));

  const openingRow = (await testPool.query(
    `SELECT document_kind FROM stock_ledger
      WHERE wholesaler_id = $1 AND product_id = $2`, [owner, opened])).rows[0];
  check(openingRow?.document_kind === "opening",
    "filed as an opening, so the register says where the figure came from",
    openingRow);

  const sellSome = mk();
  await saleController.createSale({
    user: { id: owner, role: "seller" },
    body: { partyId: party, amountPaid: 0, paymentMethod: "cash",
            lines: [{ itemName: `Opening ${s}`, quantity: 30, rate: 300,
                      gstPercent: 5, productId: opened }] },
  }, sellSome);
  check(await onHand(owner, opened) === 470,
    "selling 30 leaves 470, NOT minus 30, which is what it did without the "
    + "opening row", await onHand(owner, opened));

  const addedEmpty = mk();
  await productController.addProduct({
    user: { id: owner, role: "seller" },
    body: { name: `NoStock ${s}`, category: "Textiles", price: 80, moq: 1,
            stock: 0, shippingDays: 2, unit: "mtr", visibility: "public" },
  }, addedEmpty);
  const emptyId = (await testPool.query(
    `SELECT si.id FROM supplier_inventory si
       JOIN products p ON p.id = si.product_id
      WHERE si.supplier_id = $1 AND p.name = $2`, [owner, `NoStock ${s}`])).rows[0].id;
  const emptyRows = (await testPool.query(
    `SELECT COUNT(*)::int n FROM stock_ledger
      WHERE wholesaler_id = $1 AND product_id = $2`, [owner, emptyId])).rows[0].n;
  check(emptyRows === 0,
    "a product added with no stock writes NO row, so a wholesaler who does "
    + "not count stock is not given a zero that looks like a claim", emptyRows);


  // ------------------------------------------------------------------
  console.log("\nThe 18 Sept audit findings, pinned");
  // ------------------------------------------------------------------
  const productCtl = require("../src/controllers/productController");
  const dayBook = require("../src/controllers/dayBookController");
  const orderSale = require("../src/services/orderSaleService");

  /** Free typed lines must not collapse into one bucket. */
  for (const [nm, qty] of [["Lot A", 10], ["Lot B", 20], ["Lot A", 5]]) {
    await testPool.query(
      `INSERT INTO stock_ledger (wholesaler_id, product_id, item_name, quantity, document_kind)
       VALUES ($1, NULL, $2, $3, 'adjustment')`, [owner, nm, qty]);
  }
  const typed = (await stockLedger.balances(owner)).filter((r) => !r.product_id);
  const lotA = typed.find((r) => r.name === "Lot A");
  const lotB = typed.find((r) => r.name === "Lot B");
  check(!!lotA && !!lotB,
    "two different free typed items stay two rows. The GROUP BY named only "
    + "product_id, so every free typed item in the book collapsed into one",
    typed.map((r) => `${r.name}=${r.on_hand}`));
  check(Number(lotA?.on_hand) === 15 && Number(lotB?.on_hand) === 20,
    "and each one sums only its own movements",
    { lotA: lotA?.on_hand, lotB: lotB?.on_hand });

  /** A stock figure corrected by hand is a movement and must be recorded. */
  const adj = mk();
  await productCtl.updateInventoryItem({
    user: { id: owner, role: "seller" },
    params: { id: opened }, body: { stock: 400 },
  }, adj);
  const adjRows = (await testPool.query(
    `SELECT document_kind, quantity FROM stock_ledger
      WHERE wholesaler_id = $1 AND product_id = $2 AND document_kind = 'adjustment'`,
    [owner, opened])).rows;
  check(adjRows.length === 1,
    "correcting the stock by hand writes an adjustment, which it did not before",
    adjRows);
  check(adjRows[0] && Number(adjRows[0].quantity) === -70,
    "and it moves the BOOK from 470 to the 400 he typed, rather than the "
    + "shop offer's own delta, so counting the shelf leaves the book agreeing",
    adjRows[0]?.quantity);

  /** Money paid to a mill on account, against no particular bill. */
  const oldBill = (await testPool.query(
    `INSERT INTO purchases (wholesaler_id, supplier_id, purchase_number, purchase_date,
      status, subtotal, discount, tax_amount, total)
     VALUES ($1,$2,$3,CURRENT_DATE-40,'received',10000,0,0,10000) RETURNING id`,
    [owner, supplier, `AGE/${s}/1`])).rows[0].id;
  const age1 = mk();
  await dayBook.getPayableAgeing({ user: { id: owner, role: "seller" }, query: {} }, age1);
  const ageBefore = Number(age1.body.total);
  await testPool.query(
    `INSERT INTO supplier_payments (wholesaler_id, supplier_id, purchase_id, amount, method, paid_on)
     VALUES ($1,$2,NULL,6000,'cash',CURRENT_DATE)`, [owner, supplier]);
  const age2 = mk();
  await dayBook.getPayableAgeing({ user: { id: owner, role: "seller" }, query: {} }, age2);
  check(Number(age2.body.total) === ageBefore - 6000,
    "an ON ACCOUNT payment reduces the ageing. It joined on purchase_id, so "
    + "every untagged payment, which is most of them in this trade, was ignored",
    { before: ageBefore, after: age2.body.total });

  /** A delivered order must not be read as an active one. */
  const histOrder = (await testPool.query(
    `INSERT INTO orders (buyer_id, supplier_id, inventory_item_id, quantity, total_amount, status)
     VALUES ($1,$2,$3,1,100,'delivered') RETURNING id`,
    [owner, owner, opened])).rows[0].id;
  const del = mk();
  await productCtl.deleteInventoryItem({
    user: { id: owner, role: "seller" }, params: { id: opened } }, del);
  check(/order history/.test(del.body?.message || ""),
    "a DELIVERED order is history, not an active order. The query tested "
    + "'Delivered' capitalised against lowercase data, so it was neither",
    del.body);

  console.log(fails ? `\n${fails} FAILED\n` : "\nall good\n");
  await testPool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("THREW", e); process.exit(1); });

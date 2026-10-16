/**
 * Can a wholesaler bring his old book in, and only into his own?
 *
 * The export suite's risk was a leak out. This one's is worse, because this
 * side WRITES. The things that would hurt somebody, in the order they are
 * checked here:
 *
 *   sending the same file twice duplicates a year of sales
 *   a half finished import leaves a book nobody can reconcile
 *   an imported bill takes a number the wholesaler's own run needs, and he
 *     cannot raise another bill at all
 *   a row lands in the wrong wholesaler's book
 *   a figure on an old bill is quietly recomputed into a different one
 *
 *     createdb qa_import
 *     DATABASE_URL="postgres://postgres@127.0.0.1:5433/qa_import?sslmode=disable" npm run migrate
 *     node scripts/import_check.js qa_import
 */
const Module = require("module");
const { Pool } = require("pg");

const DB = process.argv[2] || "qa_import";
const dbPath = require.resolve("../src/config/db");
const testPool = new Pool({ connectionString: `postgres://postgres@127.0.0.1:5433/${DB}` });
const stub = new Module(dbPath, null);
stub.exports = testPool;
stub.loaded = true;
require.cache[dbPath] = stub;

const importService = require("../src/services/importService");
const importRoutes = require("../src/routes/importRoutes");
const saleInvoiceService = require("../src/services/saleInvoiceService");
const saleController = require("../src/controllers/saleController");
const { ZipWriter } = require("../src/services/zipWriter");
const { resolveBusiness, resetStaffTable } = require("../src/middlewares/businessContext");

let fails = 0;
const check = (pass, label, extra) => {
  if (!pass) fails++;
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${extra !== undefined ? `   ${JSON.stringify(extra)}` : ""}`);
};

const mk = () => {
  const r = { statusCode: 0, body: null, headers: {}, sent: null };
  r.status = (c) => ((r.statusCode = c), r);
  r.json = (b) => ((r.body = b), r);
  r.setHeader = (k, v) => ((r.headers[k.toLowerCase()] = v), r);
  r.send = (b) => ((r.sent = b), r);
  return r;
};

const zipOf = (files) => {
  const z = new ZipWriter();
  for (const [name, text] of Object.entries(files)) z.add(`data/${name}`, text);
  return { fileName: "book.zip", buffer: z.end() };
};

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const countOf = async (sql, params) => Number((await testPool.query(sql, params)).rows[0].n);

(async () => {
  const stamp = Date.now().toString(36).slice(-6);
  // Phone numbers have to be digits, so the run gets a numeric stamp of its own.
  const dial = String(Date.now()).slice(-7);

  const makeSeller = async (tag, company, prefix) => {
    const id = (await testPool.query(
      `INSERT INTO users (first_name, last_name, email, password_hash, phone, role)
       VALUES ($1,'Seth',$2,'x',$3,'seller') RETURNING id`,
      [tag, `${tag}-${stamp}@example.com`, `7${stamp}${tag.length}`],
    )).rows[0].id;
    await testPool.query(
      `INSERT INTO wholesaler_profiles (user_id, company_name, gstin, city, warehouse_state)
       VALUES ($1,$2,'27AAAPA1234A1Z5','Bhiwandi','Maharashtra')`, [id, company]);
    await testPool.query(
      `INSERT INTO invoice_settings (user_id, prefix) VALUES ($1,$2)`, [id, prefix]);
    return id;
  };

  const A = await makeSeller("AAA", `Kamal Textiles ${stamp}`, `K${stamp}/`);
  const B = await makeSeller("BBB", `Rival Mills ${stamp}`, `R${stamp}/`);
  const PREFIX = `K${stamp}/`;

  // ------------------------------------------------------------------
  // One book, in a file.
  // ------------------------------------------------------------------
  const book = () => zipOf({
    "customers.csv":
      `name,business_name,phone,gstin,city,state,opening_balance,opening_balance_on\n` +
      `Ramesh Verma ${stamp},Verma Garments,98${dial}1,24AAAPA1234A1Z5,Surat,gujarat,"1,23,456.78",03/04/2026\n` +
      `Suresh Shah ${stamp},Shah Cloth,98${dial}2,,Rajkot,Gujarat,,\n`,

    "suppliers.csv":
      `name,business_name,phone,city\n` +
      `Mohan Mills ${stamp},Mohan Spinning,88${dial}1,Bhiwandi\n`,

    "purchases.csv":
      `supplier_name,supplier_invoice_number,supplier_invoice_date,subtotal,tax_amount,total\n` +
      `Mohan Mills ${stamp},MM/${stamp}/1,01/04/2026,10000,500,10500\n`,

    "purchase-lines.csv":
      `supplier_invoice_number,item_name,quantity,unit,rate,amount,hsn_code,gst_percent\n` +
      `MM/${stamp}/1,Grey yarn,100,kg,100,10000,52081110,5\n`,

    "sales.csv":
      `customer_name,sale_number,sale_date,subtotal,tax_amount,total\n` +
      `Ramesh Verma ${stamp},S/${stamp}/1,05/04/2026,2000,100,2100\n` +
      `Naya Customer ${stamp},S/${stamp}/2,06/04/2026,1000,50,1050\n`,

    "sale-lines.csv":
      `sale_number,item_name,quantity,unit,rate,amount,hsn_code,gst_percent\n` +
      `S/${stamp}/1,Cotton shirting,20,mtr,100,2000,52081110,5\n` +
      `S/${stamp}/2,Poplin,10,mtr,100,1000,52081110,5\n`,

    "invoices.csv":
      `invoice_number,issue_date,recipient_name,recipient_gstin,recipient_state,taxable_amount,cgst,sgst,grand_total\n` +
      `${PREFIX}000001,05/04/2026,Ramesh Verma ${stamp},24AAAPA1234A1Z5,Gujarat,2000,0,0,2100\n` +
      `${PREFIX}000002,06/04/2026,Suresh Shah ${stamp},,Maharashtra,1000,25,25,1050\n` +
      `${PREFIX}000005,07/04/2026,Ramesh Verma ${stamp},,Maharashtra,500,12.5,12.5,525\n`,

    "invoice-lines.csv":
      `invoice_number,product_name,hsn_code,quantity,uqc,unit_price,gst_percent,total\n` +
      `${PREFIX}000001,Cotton shirting,52081110,20,MTR,100,5,2100\n` +
      `${PREFIX}000002,Poplin,52081110,10,MTR,100,5,1050\n`,
  });

  // ------------------------------------------------------------------
  console.log("\nThe preview writes nothing");
  // ------------------------------------------------------------------
  const before = await countOf(
    `SELECT (SELECT COUNT(*) FROM parties WHERE wholesaler_id=$1)
          + (SELECT COUNT(*) FROM sales WHERE wholesaler_id=$1)
          + (SELECT COUNT(*) FROM invoices WHERE supplier_id=$1) AS n`, [A]);
  const plan = await importService.preview(A, book());
  const after = await countOf(
    `SELECT (SELECT COUNT(*) FROM parties WHERE wholesaler_id=$1)
          + (SELECT COUNT(*) FROM sales WHERE wholesaler_id=$1)
          + (SELECT COUNT(*) FROM invoices WHERE supplier_id=$1) AS n`, [A]);
  check(before === after && after === 0, "nothing was written by the preview", { before, after });

  const list = (kind) => plan.lists.find((l) => l.kind === kind) || {};
  check(list("customers").create === 2, "two customers to create", list("customers"));
  check(list("suppliers").create === 1, "one supplier");
  check(list("purchases").create === 1, "one purchase");
  check(list("sales").create === 2, "two sales");
  check(list("invoices").create === 3, "three old bills");
  check(plan.totals.reject === 0, "and nothing refused", plan.lists.flatMap((l) => l.problems));

  const impliedCustomers = plan.implied.find((i) => i.label === "Customers");
  check(impliedCustomers && impliedCustomers.count === 1,
    "the customer named only on a sale is called out, not created silently",
    impliedCustomers);

  console.log("\nThe preview says what it will do to your run of numbers");
  check(plan.numbering && plan.numbering.moved.length === 1,
    "one series moves", plan.numbering?.moved);
  check(plan.numbering?.moved[0]?.from === 0 && plan.numbering?.moved[0]?.to === 5,
    "from 0 to 5, the highest number in the file", plan.numbering?.moved[0]);

  // ------------------------------------------------------------------
  console.log("\nAnd then it does it");
  // ------------------------------------------------------------------
  const done = await importService.apply(A, A, book());
  check(done.written.customers === 3, "three customers, the two listed and the implied one",
    done.written);
  check(done.written.suppliers === 1, "one supplier");
  check(done.written.purchases === 1, "one purchase");
  check(done.written.sales === 2, "two sales");
  check(done.written.invoices === 3, "three bills");

  const ramesh = (await testPool.query(
    `SELECT * FROM parties WHERE wholesaler_id=$1 AND name=$2`,
    [A, `Ramesh Verma ${stamp}`])).rows[0];
  check(!!ramesh, "the customer is there");
  check(Number(ramesh.opening_balance) === 123456.78,
    "with the Indian grouped balance read correctly", ramesh.opening_balance);
  check(String(ramesh.opening_balance_on).startsWith("Fri Apr 03 2026")
    || new Date(ramesh.opening_balance_on).toISOString().startsWith("2026-04-03"),
    "and the date read day first", ramesh.opening_balance_on);
  check(ramesh.state === "Gujarat", "state canonicalised from lower case", ramesh.state);
  check(!!ramesh.import_batch_id, "and it knows which import made it");

  const sale = (await testPool.query(
    `SELECT * FROM sales WHERE wholesaler_id=$1 AND sale_number=$2`,
    [A, `S/${stamp}/1`])).rows[0];
  check(Number(sale.total) === 2100, "the sale total is the figure in the file", sale.total);
  check(sale.source === "imported", "and the khata says where it came from", sale.source);
  const saleLines = await countOf(
    `SELECT COUNT(*) n FROM sale_lines WHERE sale_id=$1`, [sale.id]);
  check(saleLines === 1, "its item came with it", saleLines);

  const purchaseLines = await countOf(
    `SELECT COUNT(*) n FROM purchase_lines l JOIN purchases p ON p.id=l.purchase_id
      WHERE p.wholesaler_id=$1`, [A]);
  check(purchaseLines === 1, "the purchase item came too");

  console.log("\nThe tax on an old bill");
  const bill1 = (await testPool.query(
    `SELECT * FROM invoices WHERE supplier_id=$1 AND invoice_number=$2`,
    [A, `${PREFIX}000001`])).rows[0];
  check(Number(bill1.grand_total) === 2100, "the total is the figure on the paper",
    bill1.grand_total);
  check(Number(bill1.igst) === 0 && Number(bill1.cgst) === 0,
    "zeroes given in the file are taken as given, not invented",
    { cgst: bill1.cgst, sgst: bill1.sgst, igst: bill1.igst });
  check(bill1.einvoice_status === "not_applicable", "and it has no e-invoice standing");
  check(bill1.irn === null && bill1.signed_qr === null, "no IRN, no signed QR");
  check(!!bill1.import_batch_id, "it is marked as brought in, not raised here");
  check(bill1.invoice_number === `${PREFIX}000001`, "and it kept its own number");

  const bill2 = (await testPool.query(
    `SELECT * FROM invoices WHERE supplier_id=$1 AND invoice_number=$2`,
    [A, `${PREFIX}000002`])).rows[0];
  check(Number(bill2.cgst) === 25 && Number(bill2.sgst) === 25,
    "a split given in the file is used as given", { cgst: bill2.cgst, sgst: bill2.sgst });

  const billItems = await countOf(
    `SELECT COUNT(*) n FROM invoice_items i JOIN invoices v ON v.id=i.invoice_id
      WHERE v.supplier_id=$1`, [A]);
  check(billItems === 2, "the bill items came with them", billItems);

  // ------------------------------------------------------------------
  console.log("\nSending the same file again does NOT do it twice");
  // ------------------------------------------------------------------
  const again = await importService.apply(A, A, book());
  check(Object.values(again.written).every((n) => n === 0),
    "nothing was written the second time", again.written);
  const secondPlan = again.lists.reduce((a, l) => a + l.skip, 0);
  check(secondPlan >= 8, "and every row was counted as already there", secondPlan);

  const totals = await testPool.query(
    `SELECT (SELECT COUNT(*) FROM parties WHERE wholesaler_id=$1) AS parties,
            (SELECT COUNT(*) FROM sales WHERE wholesaler_id=$1) AS sales,
            (SELECT COUNT(*) FROM invoices WHERE supplier_id=$1) AS invoices,
            (SELECT COUNT(*) FROM purchases WHERE wholesaler_id=$1) AS purchases,
            (SELECT COUNT(*) FROM suppliers WHERE wholesaler_id=$1) AS suppliers`, [A]);
  check(Number(totals.rows[0].parties) === 3
    && Number(totals.rows[0].sales) === 2
    && Number(totals.rows[0].invoices) === 3
    && Number(totals.rows[0].purchases) === 1
    && Number(totals.rows[0].suppliers) === 1,
    "the book holds exactly one copy of everything", totals.rows[0]);

  // ------------------------------------------------------------------
  console.log("\nThe run of numbers carries on after the bills brought in");
  // ------------------------------------------------------------------
  const counter = (await testPool.query(
    `SELECT last_number FROM invoice_sequences
      WHERE wholesaler_id=$1 AND series='counter'`, [A])).rows[0];
  check(Number(counter?.last_number) === 5, "the counter moved past the highest imported number",
    counter);

  // The real proof: raise a bill the ordinary way and see it come out clear of
  // them. Before this was handled, this call failed on the unique index and a
  // wholesaler who imported his old bills could not raise a new one at all.
  const party = (await testPool.query(
    `SELECT id FROM parties WHERE wholesaler_id=$1 AND name=$2`,
    [A, `Ramesh Verma ${stamp}`])).rows[0].id;
  const res = mk();
  await saleController.createSale({
    user: { id: A, role: "seller" },
    body: { partyId: party, amountPaid: 0, paymentMethod: "cash", channel: "counter",
            lines: [{ itemName: "New cloth", quantity: 1, rate: 100,
                      hsnCode: "52081110", gstPercent: 5 }] },
  }, res);
  check(res.statusCode === 201, "a new sale can still be recorded", res.body);
  const newSale = res.body.id;
  const saleTotal = (await testPool.query(
    `SELECT total FROM sales WHERE id=$1`, [newSale])).rows[0].total;
  await testPool.query(
    `INSERT INTO party_payments (wholesaler_id, party_id, sale_id, amount, method)
     VALUES ($1,$2,$3,$4,'cash')`, [A, party, newSale, saleTotal]);
  const raised = await saleInvoiceService.createInvoiceFromSale(newSale, A);
  check(!!raised.invoice, "and a bill can still be raised for it", raised);
  check(raised.invoice?.invoice_number === `${PREFIX}000006`,
    "numbered after the imported run, not colliding with it",
    raised.invoice?.invoice_number);

  // ------------------------------------------------------------------
  console.log("\nOne tax figure, split by which state the customer is in");
  // ------------------------------------------------------------------
  // One tax figure, split by which state the customer is in. The seller is in
  // Maharashtra throughout this suite.
  const splitFile = zipOf({
    "invoices.csv":
      `invoice_number,issue_date,recipient_name,recipient_state,taxable_amount,total_tax,grand_total\n` +
      `SPL/${stamp}/1,05/04/2026,Far Away,Gujarat,2000,100,2100\n` +
      `SPL/${stamp}/2,05/04/2026,Next Door,Maharashtra,2000,100,2100\n` +
      `SPL/${stamp}/3,05/04/2026,Odd Total,Maharashtra,2000,99.99,2099.99\n`,
  });
  await importService.apply(A, A, splitFile);
  const split = await testPool.query(
    `SELECT invoice_number, cgst, sgst, igst FROM invoices
      WHERE supplier_id=$1 AND invoice_number LIKE $2 ORDER BY invoice_number`,
    [A, `SPL/${stamp}/%`]);
  const [far, near, odd] = split.rows;
  check(Number(far.igst) === 100 && Number(far.cgst) === 0,
    "a customer in another state is billed IGST", far);
  check(Number(near.cgst) === 50 && Number(near.sgst) === 50 && Number(near.igst) === 0,
    "a customer in the same state is billed CGST plus SGST", near);
  check(round2(Number(odd.cgst) + Number(odd.sgst)) === 99.99,
    "and an odd figure splits without losing a paisa", odd);


  // ------------------------------------------------------------------
  console.log("\nA bill that already carries an IRN is refused");
  // ------------------------------------------------------------------
  const withIrn = zipOf({
    "invoices.csv":
      `invoice_number,issue_date,grand_total,irn\n` +
      `OLD/${stamp}/9,01/04/2026,500,a1b2c3d4e5f6\n`,
  });
  const irnPlan = await importService.preview(A, withIrn);
  check(irnPlan.totals.reject === 1 && irnPlan.totals.create === 0,
    "refused in the preview", irnPlan.lists[0]?.problems);
  check(/IRN/.test(irnPlan.lists[0]?.problems[0]?.message || ""),
    "and the reason says why", irnPlan.lists[0]?.problems[0]?.message);
  await importService.apply(A, A, withIrn);
  const irnRows = await countOf(
    `SELECT COUNT(*) n FROM invoices WHERE supplier_id=$1 AND invoice_number=$2`,
    [A, `OLD/${stamp}/9`]);
  check(irnRows === 0, "and nothing was written for it");

  // ------------------------------------------------------------------
  console.log("\nA file that fails halfway writes nothing at all");
  // ------------------------------------------------------------------
  const good = await countOf(`SELECT COUNT(*) n FROM parties WHERE wholesaler_id=$1`, [A]);
  const goodBills = await countOf(`SELECT COUNT(*) n FROM invoices WHERE supplier_id=$1`, [A]);

  // A failure the plan cannot see coming, which is the only kind that matters.
  // Everything the plan CAN see is refused before a transaction is opened, so
  // the rollback is only ever exercised by the database saying no to a row
  // that looked fine. A constraint standing in for that is the honest way to
  // reach it: what breaks is not the point, that nothing survives it is.
  await testPool.query(
    `ALTER TABLE parties ADD CONSTRAINT tmp_poison CHECK (name NOT LIKE 'POISON%')`);
  const poison = zipOf({
    "customers.csv":
      `name,phone\nWill Not Land ${stamp},98${dial}7\nPOISON ${stamp},98${dial}8\n`,
    "invoices.csv":
      `invoice_number,issue_date,grand_total\nROLLBACK/${stamp},01/04/2026,100\n`,
  });

  const runsBefore = await countOf(
    `SELECT COUNT(*) n FROM imports WHERE wholesaler_id=$1`, [A]);
  const poisonPlan = await importService.preview(A, poison);
  check(poisonPlan.totals.reject === 0,
    "the plan sees nothing wrong with it, which is the point", poisonPlan.totals);

  let threw = null;
  await importService.apply(A, A, poison).catch((e) => (threw = e));
  check(threw !== null, "the import failed", threw && threw.message.slice(0, 60));

  const afterPoison = await countOf(
    `SELECT COUNT(*) n FROM parties WHERE wholesaler_id=$1`, [A]);
  check(afterPoison === good,
    "the customer that WOULD have landed is not in the book", { good, afterPoison });
  const afterBills = await countOf(`SELECT COUNT(*) n FROM invoices WHERE supplier_id=$1`, [A]);
  check(afterBills === goodBills, "nor the bill", { goodBills, afterBills });
  const strays = await countOf(
    `SELECT COUNT(*) n FROM invoices WHERE supplier_id=$1 AND invoice_number=$2`,
    [A, `ROLLBACK/${stamp}`]);
  check(strays === 0, "not one row of it survived");
  const runsAfter = await countOf(
    `SELECT COUNT(*) n FROM imports WHERE wholesaler_id=$1`, [A]);
  check(runsAfter === runsBefore,
    "and the record of the run rolled back with it, so the history shows no run that did nothing",
    { runsBefore, runsAfter });

  await testPool.query(`ALTER TABLE parties DROP CONSTRAINT tmp_poison`);

  // ------------------------------------------------------------------
  console.log("\nB's book is untouched by all of it");
  // ------------------------------------------------------------------
  const bRows = await countOf(
    `SELECT (SELECT COUNT(*) FROM parties WHERE wholesaler_id=$1)
          + (SELECT COUNT(*) FROM sales WHERE wholesaler_id=$1)
          + (SELECT COUNT(*) FROM suppliers WHERE wholesaler_id=$1)
          + (SELECT COUNT(*) FROM purchases WHERE wholesaler_id=$1)
          + (SELECT COUNT(*) FROM invoices WHERE supplier_id=$1) AS n`, [B]);
  check(bRows === 0, "not one row anywhere", bRows);

  console.log("\nThe route will not take a book from the request");
  const layerOf = (path) => importRoutes.stack.find((l) => l.route && l.route.path === path);
  for (const path of ["/preview", "/commit", "/template"]) {
    check(!/:/.test(layerOf(path)?.route.path || ":"), `no path parameter on ${path}`);
  }

  const drive = async (userId, path, file) => {
    const layer = layerOf(path);
    const req = {
      user: { id: userId, role: "seller" },
      query: { wholesalerId: B, wholesaler_id: B, id: B, businessId: B, userId: B },
      params: { id: B, wholesalerId: B },
      body: { wholesalerId: B, id: B },
      headers: { "x-business-id": B },
      file: file ? { originalname: file.fileName, buffer: file.buffer } : undefined,
    };
    const res = mk();
    await new Promise((d) => resolveBusiness(req, res, d));
    for (const s of layer.route.stack) {
      // multer's own middleware wants a real stream. The file is already on
      // the request, which is all the handler reads.
      if (s.name === "multerMiddleware" || s.handle.length === 3 && s.name === "") {
        // fall through to calling it, then skip if it complains
      }
      let carried = false;
      const ran = await new Promise((d) => {
        try {
          const out = s.handle(req, res, () => { carried = true; d(true); });
          if (out && typeof out.then === "function") out.then(() => d(true), () => d(true));
          else if (!carried) d(true);
        } catch { d(false); }
      });
      void ran;
      if (res.statusCode && res.statusCode >= 400) break;
      if (res.body || res.sent) break;
    }
    return res;
  };

  const attack = await drive(A, "/preview", book());
  check(attack.body?.success === true, "a preview as A is served", attack.body?.message);
  const attackPlan = attack.body?.plan;
  check(attackPlan && attackPlan.totals.create === 0,
    "and it is A's book it was planned against, where all this already exists",
    attackPlan?.totals);
  const bStill = await countOf(`SELECT COUNT(*) n FROM parties WHERE wholesaler_id=$1`, [B]);
  check(bStill === 0, "B's book still empty after driving the route with B's id everywhere");

  console.log("\nAn employee cannot write the whole book from a file");
  const clerk = (await testPool.query(
    `INSERT INTO users (first_name, last_name, email, password_hash, phone, role)
     VALUES ('Munim','Clerk',$1,'x',$2,'seller') RETURNING id`,
    [`clerk-${stamp}@example.com`, `6${stamp}1`])).rows[0].id;
  await testPool.query(
    `INSERT INTO staff_members (wholesaler_id, user_id, name, permissions, status)
     VALUES ($1,$2,'Munim',$3,'active')`,
    [A, clerk, ["customers", "sales", "purchases", "invoices"]]);
  resetStaffTable();
  for (const path of ["/preview", "/commit", "/template"]) {
    const asClerk = await drive(clerk, path, book());
    check(asClerk.statusCode === 403, `staff are refused on ${path}`,
      { s: asClerk.statusCode, code: asClerk.body?.code });
  }
  resetStaffTable();

  console.log("\nAn import with no book is refused rather than run wide open");
  for (const bad of [null, undefined, ""]) {
    let e = null;
    await importService.preview(bad, book()).catch((x) => (e = x));
    check(!!e, `${JSON.stringify(bad)} is refused on preview`, e && e.message);
    e = null;
    await importService.apply(bad, bad, book()).catch((x) => (e = x));
    check(!!e, `${JSON.stringify(bad)} is refused on commit`);
  }

  console.log("\nFiles that are not what they claim");
  const cases = [
    [{ fileName: "book.zip", buffer: Buffer.from("not a zip") }, /does not look like a zip|too small/],
    [{ fileName: "book.xlsx", buffer: Buffer.from("PK\u0003\u0004" + "x".repeat(200)) }, /Save As/],
    [zipOf({ "notes.txt": "hello" }), /no spreadsheets|recognises/],
    [zipOf({ "mystery.csv": "a,b\n1,2\n" }), /recognises/],
  ];
  for (const [file, pattern] of cases) {
    let e = null;
    await importService.preview(A, file).catch((x) => (e = x));
    check(!!e && pattern.test(e.message), `${file.fileName} is refused readably`, e?.message);
  }

  console.log("\nThe template can be filled in and sent straight back");
  const templateRes = mk();
  const tLayer = layerOf("/template");
  const tReq = { user: { id: A, role: "seller" }, query: {}, params: {}, headers: {} };
  await new Promise((d) => resolveBusiness(tReq, templateRes, d));
  for (const s of tLayer.route.stack) {
    let carried = false;
    await new Promise((d) => {
      const out = s.handle(tReq, templateRes, () => { carried = true; d(); });
      if (out && typeof out.then === "function") out.then(d, d);
      else if (!carried) d();
    });
    if (templateRes.sent) break;
  }
  check(!!templateRes.sent, "a template comes back", templateRes.statusCode);
  const zipReader = require("../src/services/zipReader");
  const template = zipReader.read(templateRes.sent);
  check([...template.keys()].some((k) => k.endsWith("customers.csv")),
    "with a sheet per list", [...template.keys()]);

  // Fill one in and send it back, which is the round trip somebody will
  // actually do.
  const headers = template.get("data/customers.csv").toString("utf8").trim();
  const filled = zipOf({ "customers.csv": `${headers}\nFilled In ${stamp},,,,,,,,,,,\n` });
  const filledPlan = await importService.preview(A, filled);
  check(filledPlan.lists[0]?.create === 1,
    "and a row pasted under those headings is understood",
    filledPlan.lists[0]?.problems);

  console.log("\nThe run is recorded, so somebody can see what happened");
  const runs = await testPool.query(
    `SELECT file_name, summary, status FROM imports WHERE wholesaler_id=$1
      ORDER BY created_at DESC LIMIT 1`, [A]);
  check(runs.rows.length === 1, "an import leaves a record");
  check(runs.rows[0].summary?.written !== undefined,
    "saying what it wrote", runs.rows[0].summary?.written);

  console.log(fails ? `\n${fails} FAILED\n` : "\nall good\n");
  await testPool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("THREW", e); process.exit(1); });

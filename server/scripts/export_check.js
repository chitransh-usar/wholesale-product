/**
 * Can a wholesaler take his own book out, and only his own?
 *
 * The whole point of this feature is to hand over a file, which is exactly what
 * makes getting the scope wrong so bad. A leak here is not a row on a screen,
 * it is another firm's entire ledger, customer list and bills in one download,
 * and it would look precisely like the feature working.
 *
 * So every check here uses two wholesalers with real books, and asserts both
 * halves: A's export has A's rows, and it has none of B's, anywhere, in any
 * file, including inside the PDFs. The route is then driven as A with B's id
 * set in the query string under every name somebody would try, in the params,
 * in the body and in a header at the same time.
 *
 *     createdb qa_export
 *     DATABASE_URL="postgres://postgres@127.0.0.1:5433/qa_export?sslmode=disable" npm run migrate
 *     node scripts/export_check.js qa_export
 *
 * The sslmode=disable matters. src/config/db.js hardcodes ssl, which a local
 * server does not offer, and the connection string is the one place that
 * overrides it.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const Module = require("module");
const { Pool } = require("pg");

const DB = process.argv[2] || "qa_export";
const dbPath = require.resolve("../src/config/db");
const testPool = new Pool({ connectionString: `postgres://postgres@127.0.0.1:5433/${DB}` });
const stub = new Module(dbPath, null);
stub.exports = testPool;
stub.loaded = true;
require.cache[dbPath] = stub;

const exportService = require("../src/services/exportService");
const exportRoutes = require("../src/routes/exportRoutes");
const saleController = require("../src/controllers/saleController");
const saleInvoiceService = require("../src/services/saleInvoiceService");
const { resolveBusiness, resetStaffTable } = require("../src/middlewares/businessContext");

let fails = 0;
const check = (pass, label, extra) => {
  if (!pass) fails++;
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${extra ? `   ${JSON.stringify(extra)}` : ""}`);
};

const mk = () => {
  const r = { statusCode: 0, body: null, headers: {}, sent: null };
  r.status = (c) => ((r.statusCode = c), r);
  r.json = (b) => ((r.body = b), r);
  r.setHeader = (k, v) => ((r.headers[k.toLowerCase()] = v), r);
  r.send = (b) => ((r.sent = b), r);
  return r;
};

/**
 * A ZIP reader, written from the format rather than from zipWriter.
 *
 * Deliberately not sharing a line with the writer. A reader built out of the
 * writer's own assumptions would agree with it about a malformed archive, which
 * is the one thing this needs to catch. Walks the central directory backwards
 * from the end record, exactly as a real unarchiver does.
 */
const readZip = (buf) => {
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("no end of central directory record");

  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const entries = new Map();

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error(`bad directory header at ${at}`);
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const offset = buf.readUInt32LE(at + 42);
    const name = buf.slice(at + 46, at + 46 + nameLen).toString("utf8");

    if (method !== 0) throw new Error(`${name} is not stored`);
    if (buf.readUInt32LE(offset) !== 0x04034b50) throw new Error(`bad local header for ${name}`);
    const localName = buf.readUInt16LE(offset + 26);
    const localExtra = buf.readUInt16LE(offset + 28);
    const start = offset + 30 + localName + localExtra;
    entries.set(name, { data: buf.slice(start, start + size), crc });

    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
};

// Counted the way a spreadsheet counts. A terms and conditions cell has line
// breaks in it, and a correctly quoted CSV carries them inside one record, so
// splitting on newlines reads roughly double.
const records = (csv) => {
  let n = 0;
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') {
      if (quoted && csv[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (ch === "\n" && !quoted) n++;
  }
  return n;
};

(async () => {
  const stamp = Date.now().toString(36).slice(-6);

  const makeSeller = async (tag, company, gstin, prefix) => {
    const id = (await testPool.query(
      `INSERT INTO users (first_name, last_name, email, password_hash, phone, role)
       VALUES ($1,'Seth',$2,'x',$3,'seller') RETURNING id`,
      [tag, `${tag}-${stamp}@example.com`, `7${stamp}${tag.length}`],
    )).rows[0].id;
    await testPool.query(
      `INSERT INTO wholesaler_profiles (user_id, company_name, gstin, city, warehouse_state)
       VALUES ($1,$2,$3,'Bhiwandi','Maharashtra')`,
      [id, company, gstin],
    );
    await testPool.query(
      `INSERT INTO invoice_settings (user_id, prefix) VALUES ($1,$2)`, [id, prefix]);
    return id;
  };

  const A = await makeSeller("AAA", `Kamal Textiles ${stamp}`, "27AAAPA1234A1Z5", `K${stamp}/`);
  const B = await makeSeller("BBB", `Rival Mills ${stamp}`, "27BBBPB1111B1Z9", `R${stamp}/`);

  const fill = async (seller, tag) => {
    const party = (await testPool.query(
      `INSERT INTO parties (wholesaler_id, name, business_name, gstin, city, state, phone)
       VALUES ($1,$2,$3,'24BBBPB5678B1Z3','Surat','Gujarat',$4) RETURNING id`,
      [seller, `${tag}-CUSTOMER-${stamp}`, `${tag}-SHOP-${stamp}`, `9${stamp}${tag.length}`],
    )).rows[0].id;

    const res = mk();
    await saleController.createSale({
      user: { id: seller, role: "seller" },
      body: {
        partyId: party, amountPaid: 0, paymentMethod: "cash", channel: "counter",
        notes: `${tag}-NOTE-${stamp}`,
        lines: [{ itemName: `${tag}-CLOTH-${stamp}`, quantity: 2, rate: 100,
                  hsnCode: "52081110", gstPercent: 5 }],
      },
    }, res);
    if (res.statusCode !== 201) throw new Error(`sale failed: ${JSON.stringify(res.body)}`);

    // Settle it in full before asking for a bill. With CHALLAN_WHEN_UNPAID on,
    // which is the default, an unsettled sale gets a delivery challan and the
    // bill waits, so a half paid fixture would leave nothing to export.
    const { total } = (await testPool.query(
      `SELECT total FROM sales WHERE id = $1`, [res.body.id])).rows[0];
    await testPool.query(
      `INSERT INTO party_payments (wholesaler_id, party_id, sale_id, amount, method, note)
       VALUES ($1,$2,$3,$4,'cash',$5)`,
      [seller, party, res.body.id, total, `${tag}-PAYMENT-${stamp}`]);

    const raised = await saleInvoiceService.createInvoiceFromSale(res.body.id, seller);
    if (!raised.invoice) throw new Error(`bill refused: ${JSON.stringify(raised)}`);
    const { invoice } = raised;

    const supplier = (await testPool.query(
      `INSERT INTO suppliers (wholesaler_id, name, business_name, phone)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [seller, `${tag}-SUPPLIER-${stamp}`, `${tag}-MILL-${stamp}`, `8${stamp}${tag.length}`],
    )).rows[0].id;
    const purchase = (await testPool.query(
      `INSERT INTO purchases (wholesaler_id, supplier_id, purchase_number,
         supplier_invoice_number, subtotal, total, notes)
       VALUES ($1,$2,$3,$4,500,500,$5) RETURNING id`,
      [seller, supplier, `PUR/${tag}/${stamp}`, `${tag}-BILL-${stamp}`,
       `${tag}-PURCHASE-NOTE-${stamp}`],
    )).rows[0].id;
    await testPool.query(
      `INSERT INTO purchase_lines (purchase_id, item_name, quantity, rate, amount)
       VALUES ($1,$2,5,100,500)`, [purchase, `${tag}-YARN-${stamp}`]);

    return { party, sale: res.body.id, invoice };
  };

  const dataA = await fill(A, "AAA");
  const dataB = await fill(B, "BBB");

  // A name somebody could genuinely type, which a spreadsheet would execute.
  await testPool.query(
    `INSERT INTO parties (wholesaler_id, name, city) VALUES ($1, $2, 'Surat')`,
    [A, `=cmd|' /C calc'!A0`]);

  console.log("\nThe export is built for the signed in wholesaler and nobody else");
  const zipA = await exportService.buildZip(A);
  check(zipA.length > 0, "something came out", { bytes: zipA.length });

  const files = readZip(zipA);
  check(files.size > 0, "it parses as a zip, read back from the format itself",
    { entries: files.size });
  for (const want of ["customers", "sales", "sale-lines", "payments-received", "suppliers",
                      "purchases", "purchase-lines", "invoices", "invoice-lines"]) {
    check(files.has(`data/${want}.csv`), `data/${want}.csv is in it`);
  }
  check(files.has("readme.txt"), "and a readme");
  const pdfs = [...files.keys()].filter((n) => n.endsWith(".pdf"));
  check(pdfs.length === 1, "and the bill, exactly one and A's own", { pdfs });
  check(files.get(pdfs[0])?.data.slice(0, 4).toString() === "%PDF", "which really is a PDF");

  // Written out so a real unarchiver gets a look at it too, when one is about.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "export-check-"));
  const zipPath = path.join(scratch, "a.zip");
  fs.writeFileSync(zipPath, zipA);
  try {
    const out = execFileSync("unzip", ["-t", zipPath], { encoding: "utf8" });
    check(/No errors detected/.test(out), "and unzip agrees it is sound");
  } catch (e) {
    if (e.code === "ENOENT") console.log("  SKIP  unzip is not installed here");
    else check(false, "and unzip agrees it is sound", { error: e.message });
  }

  console.log("\nB's book is nowhere in A's download");
  const hits = (needle) =>
    [...files.entries()].filter(([, f]) => f.data.includes(needle)).map(([n]) => n);
  for (const needle of [`BBB-CUSTOMER-${stamp}`, `BBB-SHOP-${stamp}`, `BBB-CLOTH-${stamp}`,
                        `BBB-NOTE-${stamp}`, `BBB-SUPPLIER-${stamp}`, `BBB-MILL-${stamp}`,
                        `BBB-YARN-${stamp}`, `BBB-PURCHASE-NOTE-${stamp}`,
                        `BBB-BILL-${stamp}`, `Rival Mills ${stamp}`,
                        dataB.party, dataB.sale, dataB.invoice.id,
                        dataB.invoice.invoice_number]) {
    check(hits(needle).length === 0, `nothing says ${JSON.stringify(needle)}`, hits(needle));
  }

  console.log("\nA's own book is");
  for (const needle of [`AAA-CUSTOMER-${stamp}`, `AAA-CLOTH-${stamp}`, `AAA-SUPPLIER-${stamp}`,
                        `AAA-YARN-${stamp}`, `AAA-BILL-${stamp}`,
                        dataA.invoice.invoice_number]) {
    check(hits(needle).length > 0, `${JSON.stringify(needle)} is there`);
  }

  console.log("\nThe route will not take an owner from the request");
  const layer = exportRoutes.stack.find((l) => l.route && l.route.path === "/zip");
  check(!/:/.test(layer.route.path), "there is no path parameter on it", layer.route.path);

  // The route's own stack, guard included. Only authenticateToken is stood in
  // for, because it wants a signed JWT and all this needs from it is the user
  // it would have put on the request.
  const drive = async (userId) => {
    const req = {
      user: { id: userId, role: "seller" },
      query: { wholesalerId: B, wholesaler_id: B, id: B, sellerId: B, businessId: B, userId: B },
      params: { id: B, wholesalerId: B },
      body: { wholesalerId: B, id: B },
      headers: { "x-business-id": B },
    };
    const res = mk();
    await new Promise((done) => resolveBusiness(req, res, done));
    for (const s of layer.route.stack) {
      let carried = false;
      await new Promise((done) => {
        const out = s.handle(req, res, () => { carried = true; done(); });
        if (out && typeof out.then === "function") out.then(done, done);
        else if (!carried) done();
      });
      if (res.statusCode && res.statusCode !== 200) break;
    }
    return res;
  };

  resetStaffTable();
  const attacked = await drive(A);
  check(attacked.statusCode === 200, "the request was served", { s: attacked.statusCode });
  const attackedFiles = readZip(attacked.sent);
  const inAttack = (needle) =>
    [...attackedFiles.values()].some((f) => f.data.includes(needle));
  check(inAttack(`AAA-CUSTOMER-${stamp}`) && !inAttack(`BBB-CUSTOMER-${stamp}`),
    "and it is still A's book, with B's id set six ways at once");
  check(attacked.headers["content-type"] === "application/zip"
    && /attachment; filename=my-data-\d{4}-\d{2}-\d{2}\.zip/.test(
      attacked.headers["content-disposition"]),
    "the download is named and typed as a zip",
    attacked.headers["content-disposition"]);
  check(Number(attacked.headers["content-length"]) === attacked.sent.length,
    "the length header matches the bytes");

  console.log("\nAn employee cannot walk out with the whole book");
  const hire = async (name, status, permissions) => {
    const user = (await testPool.query(
      `INSERT INTO users (first_name, last_name, email, password_hash, phone, role)
       VALUES ($1,'Clerk',$2,'x',$3,'seller') RETURNING id`,
      [name, `${name}-${stamp}@example.com`, `6${stamp}${name.length}`],
    )).rows[0].id;
    await testPool.query(
      `INSERT INTO staff_members (wholesaler_id, user_id, name, permissions, status)
       VALUES ($1,$2,$3,$4,$5)`, [A, user, name, permissions, status]);
    resetStaffTable();
    return user;
  };

  const clerk = await hire("Munim", "active",
    ["customers", "sales", "purchases", "invoices", "products", "orders"]);
  const asClerk = await drive(clerk);
  check(asClerk.statusCode === 403, "staff holding every permission there is are refused",
    { s: asClerk.statusCode, code: asClerk.body?.code });
  check(!asClerk.sent, "and nothing was sent to them");
  check(/Only the owner/.test(asClerk.body?.message || ""),
    "and they are told who can do it", asClerk.body?.message);

  const sacked = await hire("Gone", "disabled", ["invoices"]);
  const asSacked = await drive(sacked);
  check(asSacked.statusCode === 403, "a turned off employee is refused too",
    { s: asSacked.statusCode, code: asSacked.body?.code });
  check(!asSacked.sent, "and nothing was sent to them either");
  resetStaffTable();

  console.log("\nAn export with no owner is refused rather than run wide open");
  for (const bad of [null, undefined, "", 0]) {
    let threw = null;
    await exportService.buildZip(bad).catch((e) => (threw = e));
    check(!!threw, `${JSON.stringify(bad)} is refused`, threw && threw.message);
  }

  console.log("\nEvery query in the service names the owner");
  for (const spec of exportService.TABLES) {
    check(/\$1/.test(spec.sql) && /WHERE/.test(spec.sql), `${spec.file} is scoped`);
  }

  console.log("\nThe spreadsheets open correctly on somebody else's machine");
  const customers = files.get("data/customers.csv").data.toString("utf8");
  const calcRow = customers.split("\n").find((l) => l.includes("calc"));
  const calcCell = calcRow.split(",")[2];
  check(calcCell.startsWith("'") && !calcCell.startsWith("="),
    "a name that a spreadsheet would run as a formula is defused", calcCell);

  const { cell } = exportService;
  check(cell(`He said "no"`) === `"He said ""no"""`, "a quote inside a cell is doubled");
  check(cell("Surat, Gujarat") === `"Surat, Gujarat"`, "a comma forces quoting");
  check(cell("a\nb") === `"a\nb"`, "a newline forces quoting");
  check(cell(new Date("2026-04-01T00:00:00Z")) === "2026-04-01", "a date goes out ISO");
  check(cell(null) === "" && cell(undefined) === "", "null is empty, not the word null");
  check(cell("-1+1") === "'-1+1", "a leading minus is defused");
  check(cell("@SUM(A1)") === "'@SUM(A1)", "so is a leading at sign");
  check(cell(1234.5) === "1234.5", "a plain number is left alone");
  // The order matters. Prefixing after quoting would leave the formula sitting
  // inside a quoted field, where Excel still evaluates it.
  check(cell("=1+1,x") === `"'=1+1,x"`,
    "a formula that also needs quoting is prefixed INSIDE the quotes", cell("=1+1,x"));

  console.log("\nThe readme says what is in it");
  const readme = files.get("readme.txt").data.toString("utf8");
  check(/customers\.csv\s+\d+ rows/.test(readme), "it counts the rows");
  check(/1 invoice included as a PDF/.test(readme), "it counts the bills");
  check(/apostrophe/.test(readme), "it explains the apostrophe");

  console.log("\nSkipping the bills is allowed, and is smaller");
  const light = await exportService.buildZip(A, { includePdfs: false });
  const lightFiles = readZip(light);
  check(![...lightFiles.keys()].some((n) => n.endsWith(".pdf")), "no PDFs in it");
  check(lightFiles.has("data/customers.csv"), "but the figures are all there");
  check(light.length < zipA.length, "and it is smaller", { light: light.length, full: zipA.length });

  console.log("\nA table this database does not have is skipped, not fatal");
  await testPool.query(`ALTER TABLE purchase_lines RENAME TO purchase_lines_gone`);
  try {
    const partial = await exportService.buildZip(A, { includePdfs: false });
    const partialFiles = readZip(partial);
    check(partial.length > 0, "the export still built");
    check(!partialFiles.has("data/purchase-lines.csv"), "the missing one is left out");
    check(/purchase-lines\.csv\s+not set up/.test(
      partialFiles.get("readme.txt").data.toString("utf8")),
      "and the readme says so rather than pretending");
  } finally {
    await testPool.query(`ALTER TABLE purchase_lines_gone RENAME TO purchase_lines`);
  }

  console.log("\nA book with more bills than the PDF cap");
  const original = (await testPool.query(
    `SELECT * FROM invoices WHERE id = $1`, [dataA.invoice.id])).rows[0];
  const cols = Object.keys(original).filter((c) => c !== "id");
  for (let n = 1; n <= exportService.PDF_LIMIT + 5; n++) {
    const values = cols.map((c) => {
      if (c === "invoice_number") return `K${stamp}/9${String(n).padStart(4, "0")}`;
      // One invoice per sale is enforced by a unique index, and rightly so.
      // These copies were not raised from a sale.
      if (c === "sale_id" || c === "order_id") return null;
      return original[c];
    });
    await testPool.query(
      `INSERT INTO invoices (${cols.join(",")})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")})`, values);
  }
  const total = (await testPool.query(
    `SELECT COUNT(*)::int n FROM invoices WHERE supplier_id = $1`, [A])).rows[0].n;
  const big = readZip(await exportService.buildZip(A));
  const bigPdfs = [...big.keys()].filter((n) => n.endsWith(".pdf"));
  check(bigPdfs.length === exportService.PDF_LIMIT, "the PDFs stop at the cap",
    { rendered: bigPdfs.length, bills: total });
  const bigCsv = big.get("data/invoices.csv").data.toString("utf8");
  check(records(bigCsv) - 1 === total, "but the spreadsheet still has every bill",
    { records: records(bigCsv) - 1, bills: total });
  check(records(bigCsv) < bigCsv.trim().split("\n").length,
    "a cell with a line break in it survived as one cell",
    { records: records(bigCsv), lines: bigCsv.trim().split("\n").length });
  const bigReadme = big.get("readme.txt").data.toString("utf8");
  check(new RegExp(`Only the most recent ${exportService.PDF_LIMIT} were rendered`).test(bigReadme)
    && /200 invoices included as PDFs/.test(bigReadme),
    "and the readme owns up rather than handing over a quiet partial set");
  check(!bigPdfs.some((n) => n.includes(`R${stamp}`)), "none of B's crept in with them");

  fs.rmSync(scratch, { recursive: true, force: true });
  console.log(fails ? `\n${fails} FAILED\n` : "\nall good\n");
  await testPool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("THREW", e); process.exit(1); });

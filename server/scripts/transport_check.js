/**
 * The transport block, and the empty box that refused a whole sale.
 *
 * A wholesaler reported that recording a sale failed with
 *
 *     invalid input syntax for type date: ""   on parameter $18
 *
 * $18 was `transport_doc_date`. The two dates in the block were the only
 * fields that skipped `clean`, on the reasoning that a date should reach
 * Postgres exactly as it was typed rather than being half parsed here. That
 * reasoning is right and the code did not follow it: an untouched date input
 * posts an empty string, `"" ?? null` is `""`, and an empty string is not a
 * date somebody typed. It is the absence of one.
 *
 * Nothing caught it because every suite either omitted the field, which
 * arrives as undefined and becomes null, or sent a real date. A browser form
 * sends neither. So this suite sends what a browser sends.
 *
 *     createdb qa_transport
 *     DATABASE_URL="postgres://postgres@127.0.0.1:5433/qa_transport?sslmode=disable" npm run migrate
 *     node scripts/transport_check.js qa_transport
 */
const Module = require("module");
const { Pool } = require("pg");

const DB = process.argv[2] || "qa_transport";
const dbPath = require.resolve("../src/config/db");
const testPool = new Pool({ connectionString: `postgres://postgres@127.0.0.1:5433/${DB}` });
const stub = new Module(dbPath, null);
stub.exports = testPool;
stub.loaded = true;
require.cache[dbPath] = stub;

const saleController = require("../src/controllers/saleController");
const saleInvoiceService = require("../src/services/saleInvoiceService");
const {
  parseTransport,
  hasAnyTransport,
  TRANSPORT_COLUMNS,
  TRANSPORT_MODES,
} = require("../src/services/transportDetails");

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
  const stamp = Date.now().toString(36).slice(-6);
  const dial = String(Date.now()).slice(-7);

  const seller = (await testPool.query(
    `INSERT INTO users (first_name, last_name, email, password_hash, phone, role)
     VALUES ('Trans','Seth',$1,'x',$2,'seller') RETURNING id`,
    [`t-${stamp}@example.com`, `7${dial}`],
  )).rows[0].id;
  await testPool.query(
    `INSERT INTO wholesaler_profiles (user_id, company_name, gstin, city, warehouse_state)
     VALUES ($1,$2,'27AAAPA1234A1Z5','Bhiwandi','Maharashtra')`,
    [seller, `Kamal Textiles ${stamp}`],
  );
  await testPool.query(
    `INSERT INTO invoice_settings (user_id, prefix) VALUES ($1,$2)`, [seller, `T${stamp}/`]);
  const party = (await testPool.query(
    `INSERT INTO parties (wholesaler_id, name, city, state)
     VALUES ($1,$2,'Surat','Gujarat') RETURNING id`, [seller, `Ramesh ${stamp}`],
  )).rows[0].id;

  const recordSale = async (extra) => {
    const res = mk();
    await saleController.createSale({
      user: { id: seller, role: "seller" },
      body: {
        partyId: party, amountPaid: 0, paymentMethod: "cash",
        lines: [{ itemName: "Cotton shirting", quantity: 2, rate: 100,
                  hsnCode: "52081110", gstPercent: 5 }],
        ...extra,
      },
    }, res);
    return res;
  };

  // ------------------------------------------------------------------
  console.log("\nAn untouched date box is not a date");
  // ------------------------------------------------------------------
  const blank = parseTransport({
    transporterName: "Gati", transporterId: "", transportMode: "road",
    vehicleNumber: "MH04AB1234", transportDocNumber: "",
    transportDocDate: "", grNumber: "", grDate: "",
  });
  check(blank.values.transport_doc_date === null,
    "an empty transport doc date becomes null", blank.values.transport_doc_date);
  check(blank.values.gr_date === null,
    "an empty GR date becomes null", blank.values.gr_date);
  check(blank.values.transporter_id === null,
    "and so do the empty text boxes beside them");

  // The whole point. This is the body a browser posts with the transport
  // section on the form and nothing typed into its dates.
  const fromForm = await recordSale({
    saleDate: "",
    transporterName: "Gati", transporterId: "", transportMode: "road",
    vehicleNumber: "MH04AB1234", transportDocNumber: "",
    transportDocDate: "", grNumber: "", grDate: "",
  });
  check(fromForm.statusCode === 201,
    "a sale with blank date boxes is RECORDED, not refused",
    fromForm.statusCode === 201 ? undefined : fromForm.body);

  const saved = (await testPool.query(
    `SELECT sale_date, transporter_name, vehicle_number, transport_mode,
            transport_doc_date, gr_date FROM sales WHERE id = $1`,
    [fromForm.body.id],
  )).rows[0];
  check(saved.transport_doc_date === null && saved.gr_date === null,
    "the blank dates are stored as nothing", saved);
  check(saved.transporter_name === "Gati" && saved.vehicle_number === "MH04AB1234",
    "and what WAS typed survived", saved.transporter_name);
  check(saved.sale_date !== null,
    "a blank sale date still means today", saved.sale_date);

  // ------------------------------------------------------------------
  console.log("\nA date that was typed reaches Postgres as it was typed");
  // ------------------------------------------------------------------
  const typed = await recordSale({
    transporterName: "VRL", transportMode: "road", vehicleNumber: "GJ01XY9999",
    transportDocNumber: "LR-4471", transportDocDate: "2026-04-03",
    grNumber: "GR-88", grDate: "2026-04-04",
  });
  check(typed.statusCode === 201, "recorded", typed.body?.message);
  const kept = (await testPool.query(
    `SELECT transport_doc_number, transport_doc_date, gr_number, gr_date
       FROM sales WHERE id = $1`, [typed.body.id])).rows[0];
  check(new Date(kept.transport_doc_date).toISOString().startsWith("2026-04-03"),
    "the doc date is the day that was typed", kept.transport_doc_date);
  check(new Date(kept.gr_date).toISOString().startsWith("2026-04-04"),
    "and so is the GR date", kept.gr_date);

  // ------------------------------------------------------------------
  console.log("\nNo transport at all is fine, and is not an empty lorry");
  // ------------------------------------------------------------------
  const none = await recordSale({});
  check(none.statusCode === 201, "a sale with no transport block is recorded");
  check(!hasAnyTransport(parseTransport({}).values),
    "and nothing counts as nothing, so no bill claims a transporter");
  check(!hasAnyTransport(blank.values) === false,
    "while a block with a lorry in it counts as something");
  check(hasAnyTransport(parseTransport({ transportDocDate: "", grDate: "" }).values) === false,
    "two empty date boxes on their own are still nothing");

  // ------------------------------------------------------------------
  console.log("\nThe mode is one of four, and the refusal is readable");
  // ------------------------------------------------------------------
  const wrong = parseTransport({ transportMode: "bullock cart" });
  check(!!wrong.error, "an invented mode is refused before the database sees it");
  check(TRANSPORT_MODES.every((m) => wrong.error.includes(m)),
    "and the four real ones are named", wrong.error);
  const refused = await recordSale({ transportMode: "teleport" });
  check(refused.statusCode === 400, "the sale screen gets a 400, not a 500",
    { s: refused.statusCode, body: refused.body?.message });
  check(parseTransport({ transportMode: "ROAD" }).values.transport_mode === "road",
    "the mode is not case sensitive");

  // ------------------------------------------------------------------
  console.log("\nThe lorry carries across to the bill raised from the sale");
  // ------------------------------------------------------------------
  const total = (await testPool.query(
    `SELECT total FROM sales WHERE id = $1`, [typed.body.id])).rows[0].total;
  await testPool.query(
    `INSERT INTO party_payments (wholesaler_id, party_id, sale_id, amount, method)
     VALUES ($1,$2,$3,$4,'cash')`, [seller, party, typed.body.id, total]);
  const raised = await saleInvoiceService.createInvoiceFromSale(typed.body.id, seller);
  check(!!raised.invoice, "a bill was raised", raised);
  check(raised.invoice?.transporter_name === "VRL"
    && raised.invoice?.vehicle_number === "GJ01XY9999",
    "and it carries the lorry without anybody typing it twice",
    { name: raised.invoice?.transporter_name, vehicle: raised.invoice?.vehicle_number });
  check(new Date(raised.invoice?.transport_doc_date).toISOString().startsWith("2026-04-03"),
    "dates included", raised.invoice?.transport_doc_date);

  // ------------------------------------------------------------------
  console.log("\nEvery column in the list is actually on both tables");
  // ------------------------------------------------------------------
  for (const table of ["sales", "invoices", "orders"]) {
    const { rows } = await testPool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = $1 AND column_name = ANY($2)`,
      [table, TRANSPORT_COLUMNS]);
    check(rows.length === TRANSPORT_COLUMNS.length,
      `${table} has all ${TRANSPORT_COLUMNS.length}`,
      { found: rows.length, missing: TRANSPORT_COLUMNS.filter(
        (c) => !rows.some((r) => r.column_name === c)) });
  }

  console.log(fails ? `\n${fails} FAILED\n` : "\nall good\n");
  await testPool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("THREW", e); process.exit(1); });

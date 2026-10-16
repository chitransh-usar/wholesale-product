const pool = require("../config/db");
const zipReader = require("./zipReader");
const csvReader = require("./csvReader");
const { KINDS, kindOfFile, readRow } = require("./importFormat");
const { minHsnDigits } = require("./hsnService");
const { stateCode, isIntraState } = require("./placeOfSupply");
const { seriesKeyFor, prefixFor, DEFAULT_CHANNEL } = require("./salesChannels");

/**
 * A book of accounts, coming in from a file.
 *
 * THE THREE RULES THIS FILE KEEPS.
 *
 * 1. NOTHING IS OVERWRITTEN. A row that matches something already in the book
 *    is skipped and counted, never updated. An import is somebody adding what
 *    they have; it is not a merge, and a merge done wrong silently replaces a
 *    figure a customer agreed to with one out of a spreadsheet. If they want a
 *    row changed, they change it on the screen for it, where one person is
 *    looking at one record.
 *
 * 2. IT IS ALL OR NOTHING. One transaction. A file that fails halfway leaves a
 *    book with half a year in it and no way to tell which half, which is worse
 *    than a file that failed.
 *
 * 3. YOU SEE IT BEFORE IT HAPPENS. `plan` does every read and every check and
 *    writes nothing. `apply` does the same work again and then writes. The
 *    person presses the button on a list of what will happen, not on a hope.
 *
 * Scoped throughout by the wholesaler id from the TOKEN, for the same reason
 * the export is: this one writes.
 */

/** The order things have to happen in. A sale needs a customer to belong to. */
const ORDER = [
  "customers",
  "suppliers",
  "purchases",
  "purchaseLines",
  "sales",
  "saleLines",
  "invoices",
  "invoiceLines",
];

/** How many of each kind of thing to show in the preview. */
const EXAMPLES = 5;
const MAX_PROBLEMS = 50;

/** A name reduced to something two spellings of it agree on. */
const nameKey = (name) =>
  String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[.,]/g, "");

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

class ImportService {
  // ------------------------------------------------------------------
  // Reading the upload
  // ------------------------------------------------------------------

  /**
   * The upload, as { kind -> { file, rows, problems } }.
   *
   * A zip, or a single CSV. A single CSV has to be named after the list it is,
   * because a file of rows with no name is a file we would have to guess at,
   * and guessing which list somebody's spreadsheet is would be the worst
   * possible place to start.
   */
  readUpload({ fileName, buffer }) {
    const name = String(fileName || "").toLowerCase();
    const files = new Map();

    /**
     * A workbook is checked for BEFORE anything else, by its name.
     *
     * An .xlsx IS a zip. So is an .ods. Left to the magic bytes they both go
     * down the zip path, unpack into xl/worksheets/sheet1.xml, and come back
     * with "nothing in that file is a list this recognises", which is true and
     * useless. The person who uploaded the most likely wrong file in the world
     * deserves to be told which button to press instead.
     */
    if (/\.(xlsx|xlsm|xls|ods|numbers)$/i.test(name)) {
      throw new Error(
        "A workbook cannot be read directly. Open it, then File, Save As, and pick CSV. One spreadsheet per list.",
      );
    }

    if (name.endsWith(".zip") || (buffer[0] === 0x50 && buffer[1] === 0x4b)) {
      for (const [path, data] of zipReader.read(buffer)) {
        if (!/\.(csv|txt)$/i.test(path)) continue;
        files.set(path, data.toString("utf8"));
      }
      if (files.size === 0) {
        throw new Error("That zip has no spreadsheets in it. It should hold .csv files.");
      }
    } else if (/\.(csv|txt)$/i.test(name)) {
      files.set(fileName, buffer.toString("utf8"));
    } else {
      throw new Error(
        "Send a .zip of spreadsheets, or one .csv. A .xlsx cannot be read directly: in Excel, use File then Save As and pick CSV.",
      );
    }

    const found = {};
    const unrecognised = [];
    for (const [path, text] of files) {
      const kind = kindOfFile(path);
      if (!kind) {
        unrecognised.push(path);
        continue;
      }
      const parsed = csvReader.toObjects(text);
      // Two files claiming the same list: the rows are added together rather
      // than one quietly winning.
      if (found[kind]) {
        found[kind].files.push(path);
        found[kind].rows.push(...parsed.rows);
        found[kind].problems.push(...parsed.problems.map((p) => ({ ...p, file: path })));
      } else {
        found[kind] = {
          files: [path],
          rows: parsed.rows,
          problems: parsed.problems.map((p) => ({ ...p, file: path })),
        };
      }
    }

    if (Object.keys(found).length === 0) {
      throw new Error(
        `Nothing in that file is a list this recognises. Name the spreadsheets customers.csv, suppliers.csv, purchases.csv, sales.csv or invoices.csv. Found: ${
          unrecognised.join(", ") || "nothing"
        }`,
      );
    }

    return { found, unrecognised };
  }

  // ------------------------------------------------------------------
  // What is already in the book
  // ------------------------------------------------------------------

  async existing(db, wholesalerId) {
    const has = async (table) => {
      const { rows } = await db.query("SELECT to_regclass($1) IS NOT NULL AS yes", [
        `public.${table}`,
      ]);
      return Boolean(rows[0]?.yes);
    };

    const book = {
      parties: new Map(),
      partyPhones: new Map(),
      suppliers: new Map(),
      supplierPhones: new Map(),
      purchaseBills: new Set(),
      purchaseBillNumbers: new Set(),
      saleNumbers: new Set(),
      invoiceNumbers: new Set(),
      tables: {},
    };

    book.tables.parties = await has("parties");
    if (book.tables.parties) {
      const { rows } = await db.query(
        `SELECT id, name, phone FROM parties WHERE wholesaler_id = $1`, [wholesalerId]);
      for (const r of rows) {
        book.parties.set(nameKey(r.name), r.id);
        if (r.phone) book.partyPhones.set(r.phone, r.id);
      }
    }

    book.tables.suppliers = await has("suppliers");
    if (book.tables.suppliers) {
      const { rows } = await db.query(
        `SELECT id, name, phone FROM suppliers WHERE wholesaler_id = $1`, [wholesalerId]);
      for (const r of rows) {
        book.suppliers.set(nameKey(r.name), r.id);
        if (r.phone) book.supplierPhones.set(r.phone, r.id);
      }
    }

    book.tables.purchases = await has("purchases");
    if (book.tables.purchases) {
      const { rows } = await db.query(
        `SELECT supplier_id, lower(supplier_invoice_number) AS bill, lower(purchase_number) AS ours
           FROM purchases
          WHERE wholesaler_id = $1 AND supplier_invoice_number IS NOT NULL`, [wholesalerId]);
      for (const r of rows) {
        book.purchaseBills.add(`${r.supplier_id}|${r.bill}`);
        // Without the supplier, for the line items: a line names the bill it
        // belongs to and not who it came from.
        book.purchaseBillNumbers.add(r.bill);
        if (r.ours) book.purchaseBillNumbers.add(`our:${r.ours}`);
      }
    }

    book.tables.sales = await has("sales");
    if (book.tables.sales) {
      const { rows } = await db.query(
        `SELECT sale_number FROM sales
          WHERE wholesaler_id = $1 AND sale_number IS NOT NULL`, [wholesalerId]);
      for (const r of rows) book.saleNumbers.add(r.sale_number.toLowerCase());
    }

    book.tables.invoices = await has("invoices");
    if (book.tables.invoices) {
      const { rows } = await db.query(
        `SELECT invoice_number FROM invoices WHERE supplier_id = $1`, [wholesalerId]);
      for (const r of rows) book.invoiceNumbers.add(r.invoice_number.toLowerCase());
    }

    return book;
  }

  // ------------------------------------------------------------------
  // The plan
  // ------------------------------------------------------------------

  /**
   * What this file would do, with nothing written.
   *
   * Every row lands in exactly one of three places. `create` is a new row.
   * `skip` already exists, matched on the natural key for its list. `reject`
   * cannot be read or cannot be placed, and carries the line number and the
   * reason in words, because the person fixing it is looking at a spreadsheet,
   * not at a stack trace.
   */
  async buildPlan(db, wholesalerId, upload) {
    const { found, unrecognised } = this.readUpload(upload);
    const book = await this.existing(db, wholesalerId);
    const minDigits = await minHsnDigits();

    const lists = [];
    // What this file will have created by the time it gets to the sales, so a
    // sale can find a customer the same file is bringing in.
    const newParties = new Map();
    const newSuppliers = new Map();
    const newSales = new Map();
    const newPurchases = new Map();
    const newInvoices = new Map();
    // Customers and suppliers named on a transaction but on no list of their
    // own. Created, and said out loud, because a silent new customer is a
    // surprise in somebody's khata.
    const impliedParties = new Map();
    const impliedSuppliers = new Map();

    const report = (kindKey) => {
      const list = {
        kind: kindKey,
        label: KINDS[kindKey].label,
        files: found[kindKey]?.files || [],
        create: 0,
        skip: 0,
        reject: 0,
        examples: [],
        problems: [],
      };
      lists.push(list);
      return list;
    };

    const problem = (list, line, message, file) => {
      list.reject++;
      if (list.problems.length < MAX_PROBLEMS) list.problems.push({ line, message, file });
    };

    for (const kindKey of ORDER) {
      const source = found[kindKey];
      if (!source) continue;
      const list = report(kindKey);

      // A file whose rows could not be split at all.
      for (const p of source.problems) problem(list, p.line, p.message, p.file);

      const seen = new Set();

      for (const record of source.rows) {
        const parsed = readRow(kindKey, record, { minHsnDigits: minDigits });
        if (!parsed.ok) {
          problem(list, parsed.line, parsed.errors.join(" "), source.files[0]);
          continue;
        }
        const row = parsed.value;
        const line = parsed.line;

        const place = this.placeRow(kindKey, row, {
          book, newParties, newSuppliers, newSales, newPurchases, newInvoices,
          impliedParties, impliedSuppliers, seen, wholesalerId,
        });

        if (place.reject) {
          problem(list, line, place.reject, source.files[0]);
        } else if (place.skip) {
          list.skip++;
          if (list.examples.length < EXAMPLES) {
            list.examples.push({ line, what: place.label, action: "already there" });
          }
        } else {
          list.create++;
          if (list.examples.length < EXAMPLES) {
            list.examples.push({ line, what: place.label, action: "new" });
          }
          place.keep();
        }
      }
    }

    // Customers and suppliers that only a transaction mentioned.
    const implied = [];
    if (impliedParties.size) {
      implied.push({
        label: "Customers",
        count: impliedParties.size,
        why: "named on a sale or a bill but not on any customers list in this file",
        names: [...impliedParties.values()].slice(0, EXAMPLES).map((p) => p.name),
      });
    }
    if (impliedSuppliers.size) {
      implied.push({
        label: "Suppliers",
        count: impliedSuppliers.size,
        why: "named on a purchase but not on any suppliers list in this file",
        names: [...impliedSuppliers.values()].slice(0, EXAMPLES).map((s) => s.name),
      });
    }

    const numbering = await this.numberingNote(db, wholesalerId, newInvoices);

    return {
      lists,
      implied,
      numbering,
      unrecognised,
      totals: lists.reduce(
        (acc, l) => ({
          create: acc.create + l.create,
          skip: acc.skip + l.skip,
          reject: acc.reject + l.reject,
        }),
        { create: 0, skip: 0, reject: 0 },
      ),
      // Everything the apply step needs, carried rather than worked out twice.
      staged: { newParties, newSuppliers, newSales, newPurchases, newInvoices,
                impliedParties, impliedSuppliers, found, book },
    };
  }

  /**
   * Where one row goes: new, already there, or refused.
   *
   * Pulled out of the loop because it is the only interesting part, and
   * because the same decision has to come out identical in the preview and in
   * the apply. Two copies of this logic is how a preview starts lying.
   */
  placeRow(kindKey, row, ctx) {
    const {
      book, newParties, newSuppliers, newSales, newPurchases, newInvoices,
      impliedParties, impliedSuppliers, seen,
    } = ctx;

    const findParty = (name, phone) => {
      if (phone && book.partyPhones.has(phone)) return book.partyPhones.get(phone);
      if (phone && newParties.has(`phone:${phone}`)) return newParties.get(`phone:${phone}`);
      const key = nameKey(name);
      if (key && book.parties.has(key)) return book.parties.get(key);
      if (key && newParties.has(`name:${key}`)) return newParties.get(`name:${key}`);
      return null;
    };
    const findSupplier = (name, phone) => {
      if (phone && book.supplierPhones.has(phone)) return book.supplierPhones.get(phone);
      if (phone && newSuppliers.has(`phone:${phone}`)) return newSuppliers.get(`phone:${phone}`);
      const key = nameKey(name);
      if (key && book.suppliers.has(key)) return book.suppliers.get(key);
      if (key && newSuppliers.has(`name:${key}`)) return newSuppliers.get(`name:${key}`);
      return null;
    };

    switch (kindKey) {
      case "customers": {
        const label = row.businessName ? `${row.name} (${row.businessName})` : row.name;
        if (findParty(row.name, row.phone)) return { skip: true, label };
        const key = row.phone ? `phone:${row.phone}` : `name:${nameKey(row.name)}`;
        if (seen.has(key)) {
          return { reject: `"${row.name}" appears more than once in this file.` };
        }
        return {
          label,
          keep: () => {
            seen.add(key);
            const token = `pending:${newParties.size}`;
            newParties.set(`name:${nameKey(row.name)}`, token);
            if (row.phone) newParties.set(`phone:${row.phone}`, token);
            newParties.set(token, row);
          },
        };
      }

      case "suppliers": {
        const label = row.businessName ? `${row.name} (${row.businessName})` : row.name;
        if (findSupplier(row.name, row.phone)) return { skip: true, label };
        const key = row.phone ? `phone:${row.phone}` : `name:${nameKey(row.name)}`;
        if (seen.has(key)) {
          return { reject: `"${row.name}" appears more than once in this file.` };
        }
        return {
          label,
          keep: () => {
            seen.add(key);
            const token = `pending:${newSuppliers.size}`;
            newSuppliers.set(`name:${nameKey(row.name)}`, token);
            if (row.phone) newSuppliers.set(`phone:${row.phone}`, token);
            newSuppliers.set(token, row);
          },
        };
      }

      case "purchases": {
        const label = `${row.supplierInvoiceNumber || row.purchaseNumber || "a bill"} from ${row.supplier}`;
        let supplier = findSupplier(row.supplier, row.supplierPhone);
        if (!supplier) {
          const key = nameKey(row.supplier);
          if (!impliedSuppliers.has(key)) {
            impliedSuppliers.set(key, { name: row.supplier, phone: row.supplierPhone });
          }
          supplier = `implied:${key}`;
        }
        if (row.supplierInvoiceNumber) {
          const dbKey = `${supplier}|${row.supplierInvoiceNumber.toLowerCase()}`;
          if (book.purchaseBills.has(dbKey)) return { skip: true, label };
          if (seen.has(dbKey)) {
            return {
              reject: `Bill "${row.supplierInvoiceNumber}" from ${row.supplier} appears twice in this file. Entering one supplier bill twice claims its input credit twice.`,
            };
          }
          return {
            label,
            keep: () => {
              seen.add(dbKey);
              newPurchases.set(row.supplierInvoiceNumber.toLowerCase(),
                { ...row, supplierToken: supplier });
              if (row.purchaseNumber) {
                newPurchases.set(`our:${row.purchaseNumber.toLowerCase()}`,
                  { ...row, supplierToken: supplier });
              }
            },
          };
        }
        // No supplier bill number means no way to tell this row from the same
        // row uploaded again, so a second upload would duplicate it.
        return {
          reject: `${label}: a purchase needs the supplier's own bill number. Without it the same bill cannot be told apart if this file is sent again, and entering a purchase twice claims its input credit twice.`,
        };
      }

      case "purchaseLines": {
        const key = (row.billNumber || "").toLowerCase();
        const ourKey = row.purchaseNumber ? `our:${row.purchaseNumber.toLowerCase()}` : null;
        if (newPurchases.has(key) || (ourKey && newPurchases.has(ourKey))) {
          return { label: row.itemName, keep: () => {} };
        }
        // The bill this line belongs to is already in the book, which is what
        // a second upload of the same file looks like. Its items came in with
        // it the first time, so this line is already there too. Calling it an
        // orphan would tell somebody their file was broken when it was not.
        if (book.purchaseBillNumbers.has(key) || (ourKey && book.purchaseBillNumbers.has(ourKey))) {
          return { skip: true, label: row.itemName };
        }
        return {
          reject: `${row.itemName}: there is no purchase "${row.billNumber || row.purchaseNumber}" in this file for it to belong to.`,
        };
      }

      case "sales": {
        const label = `${row.saleNumber || "a sale"} to ${row.customer}`;
        let party = findParty(row.customer, row.customerPhone);
        if (!party) {
          const key = nameKey(row.customer);
          if (!impliedParties.has(key)) {
            impliedParties.set(key, { name: row.customer, phone: row.customerPhone });
          }
          party = `implied:${key}`;
        }
        if (!row.saleNumber) {
          return {
            reject: `${label}: a sale needs its own number, so the same sale is not brought in twice if this file is sent again.`,
          };
        }
        const key = row.saleNumber.toLowerCase();
        if (book.saleNumbers.has(key)) return { skip: true, label };
        if (seen.has(key)) {
          return { reject: `Sale "${row.saleNumber}" appears more than once in this file.` };
        }
        return {
          label,
          keep: () => {
            seen.add(key);
            newSales.set(key, { ...row, partyToken: party });
          },
        };
      }

      case "saleLines": {
        const key = (row.saleNumber || "").toLowerCase();
        if (newSales.has(key)) return { label: row.itemName, keep: () => {} };
        if (book.saleNumbers.has(key)) return { skip: true, label: row.itemName };
        return {
          reject: `${row.itemName}: there is no sale "${row.saleNumber}" in this file for it to belong to.`,
        };
      }

      case "invoices": {
        const label = `${row.invoiceNumber}${row.customer ? ` to ${row.customer}` : ""}`;
        const key = row.invoiceNumber.toLowerCase();
        if (book.invoiceNumbers.has(key)) return { skip: true, label };
        if (seen.has(key)) {
          return {
            reject: `Bill "${row.invoiceNumber}" appears more than once in this file. An invoice number is issued once and once only.`,
          };
        }
        let party = null;
        if (row.customer) {
          party = findParty(row.customer, row.customerPhone);
          if (!party) {
            const nk = nameKey(row.customer);
            if (!impliedParties.has(nk)) {
              impliedParties.set(nk, { name: row.customer, phone: row.customerPhone });
            }
            party = `implied:${nk}`;
          }
        }
        return {
          label,
          keep: () => {
            seen.add(key);
            newInvoices.set(key, { ...row, partyToken: party });
          },
        };
      }

      case "invoiceLines": {
        const key = (row.invoiceNumber || "").toLowerCase();
        if (newInvoices.has(key)) return { label: row.productName, keep: () => {} };
        if (book.invoiceNumbers.has(key)) return { skip: true, label: row.productName };
        return {
          reject: `${row.productName}: there is no bill "${row.invoiceNumber}" in this file for it to belong to.`,
        };
      }

      default:
        return { reject: "Unknown list." };
    }
  }

  // ------------------------------------------------------------------
  // The invoice numbering note, which is the part people get wrong
  // ------------------------------------------------------------------

  /**
   * What importing these bills does to the run of invoice numbers.
   *
   * An imported bill keeps its own number and never takes one from the run.
   * But the run has to be moved PAST it, and this is the point everybody
   * misses: if a wholesaler brings in KT/000001 to KT/000400 while his counter
   * sits at zero, the next bill he raises here is numbered KT/000001, hits the
   * unique index on (supplier, invoice_number) and fails. He would not be able
   * to raise a bill at all, and the error would say nothing about the import.
   *
   * So the counter is advanced to the highest imported number in its own
   * series, and the preview says what the next bill will be called. That is
   * not renumbering anything: every imported bill keeps exactly the number it
   * was issued under, and the run simply carries on after them.
   *
   * A number that does not match this wholesaler's own format is left out of
   * the reckoning entirely, because his run can never produce it and therefore
   * can never collide with it.
   */
  async numberingNote(db, wholesalerId, newInvoices) {
    const bills = [...newInvoices.values()];
    if (bills.length === 0) return null;

    // number_suffix and number_pad_to arrive with the Rule 46(b) numbering
    // migration. On a database without them the format is the default one
    // invoiceNumberService falls back to, which is what the fallback select
    // reproduces rather than failing the whole preview over a missing column.
    const settingsOf = async () => {
      try {
        const { rows } = await db.query(
          `SELECT prefix, number_suffix, number_pad_to
             FROM invoice_settings WHERE user_id = $1`, [wholesalerId]);
        return rows[0] || {};
      } catch {
        const { rows } = await db
          .query(`SELECT prefix FROM invoice_settings WHERE user_id = $1`, [wholesalerId])
          .catch(() => ({ rows: [] }));
        return rows[0] || {};
      }
    };
    const settings = await settingsOf();

    const ownPrefix = settings.prefix || "INV";
    const suffix = settings.number_suffix || "";
    const highest = new Map();

    for (const bill of bills) {
      const series = seriesKeyFor(bill.channel || DEFAULT_CHANNEL);
      const head = String(prefixFor(series, ownPrefix) || "INV").trim();
      const withSeparator = head.endsWith("-") || head.endsWith("/") ? head : `${head}-`;
      const number = bill.invoiceNumber;

      if (!number.startsWith(withSeparator)) continue;
      let middle = number.slice(withSeparator.length);
      if (suffix) {
        if (!middle.endsWith(suffix)) continue;
        middle = middle.slice(0, middle.length - suffix.length);
      }
      if (!/^\d+$/.test(middle)) continue;

      const year = this.financialYearOf(bill.issueDate);
      const mapKey = `${series}|${year}`;
      const n = Number(middle);
      if (!highest.has(mapKey) || highest.get(mapKey).sequence < n) {
        highest.set(mapKey, { series, year, sequence: n, sample: number });
      }
    }

    if (highest.size === 0) {
      return {
        moved: [],
        note: "None of these bill numbers match the format you raise bills in, so your own run of numbers is untouched.",
      };
    }

    const moved = [];
    for (const [, entry] of highest) {
      const { rows } = await db.query(
        `SELECT last_number FROM invoice_sequences
          WHERE wholesaler_id = $1 AND series = $2 AND year = $3`,
        [wholesalerId, entry.series, entry.year],
      ).catch(() => ({ rows: [] }));
      const current = Number(rows[0]?.last_number || 0);
      if (current >= entry.sequence) continue;
      moved.push({ ...entry, from: current, to: entry.sequence });
    }

    return {
      moved,
      note: moved.length
        ? "Your bills keep the numbers they were issued under. Your counter moves past them, so the next bill you raise carries on after the last one here instead of colliding with it."
        : "Your counter is already past these numbers, so nothing changes.",
    };
  }

  /** The Indian financial year a date falls in, as the counter's key. */
  financialYearOf(isoDate) {
    const d = isoDate ? new Date(`${isoDate}T00:00:00Z`) : new Date();
    return d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  }

  // ------------------------------------------------------------------
  // The two public calls
  // ------------------------------------------------------------------

  /** What would happen. Writes nothing. */
  async preview(wholesalerId, upload) {
    if (!wholesalerId) throw new Error("An import needs the book it is for.");
    const plan = await this.buildPlan(pool, wholesalerId, upload);
    delete plan.staged;
    return plan;
  }

  /**
   * Do it, in one transaction.
   *
   * The plan is built again inside the transaction rather than carried over
   * from the preview. The book may have moved between the two calls, and a
   * plan made against a book that has since changed is exactly how an import
   * writes a duplicate.
   */
  async apply(wholesalerId, userId, upload) {
    if (!wholesalerId) throw new Error("An import needs the book it is for.");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const plan = await this.buildPlan(client, wholesalerId, upload);

      const batch = (await client.query(
        `INSERT INTO imports (wholesaler_id, done_by, file_name, file_bytes, summary)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [wholesalerId, userId || null, upload.fileName || null,
         upload.buffer.length, JSON.stringify({})],
      )).rows[0].id;

      const written = await this.write(client, wholesalerId, batch, plan);

      await client.query(
        `UPDATE imports SET summary = $2 WHERE id = $1`,
        [batch, JSON.stringify({ lists: plan.lists.map((l) => ({
          kind: l.kind, create: l.create, skip: l.skip, reject: l.reject })), written })],
      );

      await client.query("COMMIT");
      return { batchId: batch, ...plan, written };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // ------------------------------------------------------------------
  // The writing
  // ------------------------------------------------------------------

  async write(client, wholesalerId, batch, plan) {
    const s = plan.staged;
    const written = {};
    const partyIds = new Map();
    const supplierIds = new Map();

    // Customers, including the ones only a sale mentioned.
    const partyRows = [];
    for (const [key, value] of s.newParties) {
      if (key.startsWith("pending:")) partyRows.push({ token: key, row: value });
    }
    for (const [key, value] of s.impliedParties) {
      // Only if nothing in this file or the book already covers them.
      const existing = s.book.parties.get(key)
        || (value.phone && s.book.partyPhones.get(value.phone))
        || s.newParties.get(`name:${key}`)
        || (value.phone && s.newParties.get(`phone:${value.phone}`));
      if (existing) {
        partyIds.set(`implied:${key}`, existing);
        continue;
      }
      partyRows.push({ token: `implied:${key}`, row: { name: value.name, phone: value.phone } });
    }

    for (const { token, row } of partyRows) {
      const { rows } = await client.query(
        `INSERT INTO parties (wholesaler_id, name, business_name, phone, gstin, city,
           state, address, notes, opening_balance, opening_balance_on, credit_limit,
           credit_period_days, import_batch_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::numeric,0),$11,
           COALESCE($12::numeric,0),COALESCE($13::integer,30),$14)
         RETURNING id`,
        [wholesalerId, row.name, row.businessName || null, row.phone || null,
         row.gstin || null, row.city || null, row.state || null, row.address || null,
         row.notes || null, row.openingBalance, row.openingBalanceOn,
         row.creditLimit, row.creditPeriodDays, batch],
      );
      partyIds.set(token, rows[0].id);
    }
    written.customers = partyRows.length;

    // Suppliers, same shape.
    const supplierRows = [];
    for (const [key, value] of s.newSuppliers) {
      if (key.startsWith("pending:")) supplierRows.push({ token: key, row: value });
    }
    for (const [key, value] of s.impliedSuppliers) {
      const existing = s.book.suppliers.get(key)
        || (value.phone && s.book.supplierPhones.get(value.phone))
        || s.newSuppliers.get(`name:${key}`)
        || (value.phone && s.newSuppliers.get(`phone:${value.phone}`));
      if (existing) {
        supplierIds.set(`implied:${key}`, existing);
        continue;
      }
      supplierRows.push({ token: `implied:${key}`, row: { name: value.name, phone: value.phone } });
    }

    for (const { token, row } of supplierRows) {
      const { rows } = await client.query(
        `INSERT INTO suppliers (wholesaler_id, name, business_name, phone, gstin, city,
           address, notes, import_batch_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [wholesalerId, row.name, row.businessName || null, row.phone || null,
         row.gstin || null, row.city || null, row.address || null, row.notes || null, batch],
      );
      supplierIds.set(token, rows[0].id);
    }
    written.suppliers = supplierRows.length;

    // A token that may be a pending id, an implied one, or a real uuid.
    const resolveParty = (token) =>
      (token && partyIds.get(token)) || (token && !String(token).includes(":") ? token : null);
    const resolveSupplier = (token) =>
      (token && supplierIds.get(token)) || (token && !String(token).includes(":") ? token : null);

    written.purchases = await this.writePurchases(
      client, wholesalerId, batch, s, resolveSupplier);
    written.sales = await this.writeSales(client, wholesalerId, batch, s, resolveParty);
    written.invoices = await this.writeInvoices(
      client, wholesalerId, batch, s, resolveParty, plan.numbering);

    return written;
  }

  async writePurchases(client, wholesalerId, batch, s, resolveSupplier) {
    const lines = new Map();
    for (const record of s.found.purchaseLines?.rows || []) {
      const parsed = readRow("purchaseLines", record, {});
      if (!parsed.ok) continue;
      const key = (parsed.value.billNumber || "").toLowerCase();
      const ourKey = parsed.value.purchaseNumber
        ? `our:${parsed.value.purchaseNumber.toLowerCase()}` : null;
      const use = s.newPurchases.has(key) ? key : ourKey;
      if (!use) continue;
      if (!lines.has(use)) lines.set(use, []);
      lines.get(use).push(parsed.value);
    }

    let count = 0;
    const done = new Set();
    for (const [key, row] of s.newPurchases) {
      if (key.startsWith("our:")) continue;
      if (done.has(key)) continue;
      done.add(key);

      const mine = lines.get(key)
        || lines.get(row.purchaseNumber ? `our:${row.purchaseNumber.toLowerCase()}` : "")
        || [];
      const totals = this.totalsFrom(row, mine);

      const { rows } = await client.query(
        `INSERT INTO purchases (wholesaler_id, supplier_id, purchase_number, purchase_date,
           supplier_invoice_number, supplier_invoice_date, status, subtotal, discount,
           tax_amount, total, notes, import_batch_id)
         VALUES ($1,$2,$3,COALESCE($4, CURRENT_DATE),$5,$6,'received',$7,$8,$9,$10,$11,$12)
         RETURNING id`,
        [wholesalerId, resolveSupplier(row.supplierToken), row.purchaseNumber || null,
         row.purchaseDate, row.supplierInvoiceNumber, row.supplierInvoiceDate,
         totals.subtotal, totals.discount, totals.tax, totals.total, row.notes || null, batch],
      );

      for (const line of mine) {
        await client.query(
          `INSERT INTO purchase_lines (purchase_id, item_name, quantity, unit, rate, amount,
             hsn_code, gst_percent)
           VALUES ($1,$2,COALESCE($3::numeric,1),$4,COALESCE($5::numeric,0),
             COALESCE($6::numeric,0),$7,$8::numeric)`,
          [rows[0].id, line.itemName, line.quantity, line.unit, line.rate,
           line.amount ?? round2((line.quantity || 1) * (line.rate || 0)),
           line.hsnCode, line.gstPercent],
        );
      }
      count++;
    }
    return count;
  }

  async writeSales(client, wholesalerId, batch, s, resolveParty) {
    const lines = new Map();
    for (const record of s.found.saleLines?.rows || []) {
      const parsed = readRow("saleLines", record, {});
      if (!parsed.ok) continue;
      const key = (parsed.value.saleNumber || "").toLowerCase();
      if (!s.newSales.has(key)) continue;
      if (!lines.has(key)) lines.set(key, []);
      lines.get(key).push(parsed.value);
    }

    let count = 0;
    for (const [key, row] of s.newSales) {
      const mine = lines.get(key) || [];
      const totals = this.totalsFrom(row, mine);
      const cess = row.totalCess ?? round2(mine.reduce((a, l) => a + (l.cessAmount || 0), 0));

      const { rows } = await client.query(
        `INSERT INTO sales (wholesaler_id, party_id, sale_number, sale_date, source, status,
           subtotal, discount, tax_amount, total_cess, total, notes, channel, import_batch_id)
         VALUES ($1,$2,$3,COALESCE($4, CURRENT_DATE),'imported','confirmed',
           $5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id`,
        [wholesalerId, resolveParty(row.partyToken), row.saleNumber, row.saleDate,
         totals.subtotal, totals.discount, totals.tax, cess, totals.total,
         row.notes || null, row.channel || DEFAULT_CHANNEL, batch],
      );

      for (const line of mine) {
        await client.query(
          `INSERT INTO sale_lines (sale_id, item_name, quantity, unit, rate, amount,
             hsn_code, gst_percent, cess_percent, cess_amount)
           VALUES ($1,$2,COALESCE($3::numeric,1),$4,COALESCE($5::numeric,0),
             COALESCE($6::numeric,0),$7,$8::numeric,
             COALESCE($9::numeric,0),COALESCE($10::numeric,0))`,
          [rows[0].id, line.itemName, line.quantity, line.unit, line.rate,
           line.amount ?? round2((line.quantity || 1) * (line.rate || 0)),
           line.hsnCode, line.gstPercent, line.cessPercent, line.cessAmount],
        );
      }
      count++;
    }
    return count;
  }

  async writeInvoices(client, wholesalerId, batch, s, resolveParty, numbering) {
    const lines = new Map();
    for (const record of s.found.invoiceLines?.rows || []) {
      const parsed = readRow("invoiceLines", record, {});
      if (!parsed.ok) continue;
      const key = (parsed.value.invoiceNumber || "").toLowerCase();
      if (!s.newInvoices.has(key)) continue;
      if (!lines.has(key)) lines.set(key, []);
      lines.get(key).push(parsed.value);
    }

    // The seller's own details, as they are now. An old bill's own stationery
    // is not in the spreadsheet, and inventing one would be worse than
    // carrying today's.
    const { rows: seller } = await client.query(
      `SELECT u.first_name, u.last_name, wp.company_name, wp.gstin, wp.city,
              wp.warehouse_state
         FROM users u LEFT JOIN wholesaler_profiles wp ON wp.user_id = u.id
        WHERE u.id = $1`,
      [wholesalerId],
    );
    const me = seller[0] || {};
    const sellerState = me.warehouse_state || me.city || null;

    let count = 0;
    for (const [key, row] of s.newInvoices) {
      const mine = lines.get(key) || [];
      const tax = this.taxFrom(row, sellerState);
      const taxable = row.taxableAmount ?? row.subtotal
        ?? round2((row.grandTotal || 0) - tax.total - (row.totalCess || 0) - (row.roundOff || 0));

      const { rows } = await client.query(
        `INSERT INTO invoices (invoice_number, supplier_id, party_id, issue_date, due_date,
           subtotal, discount, taxable_amount, cgst, sgst, igst, total_tax, total_cess,
           round_off, grand_total, payment_status, invoice_status,
           recipient_name, recipient_gstin, recipient_city, recipient_state,
           recipient_state_code, recipient_address, place_of_supply, place_of_supply_code,
           seller_name, seller_gstin, seller_state, supplier_state, notes,
           einvoice_status, channel, import_batch_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'Generated',
           $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,'not_applicable',$30,$31)
         RETURNING id`,
        [
          row.invoiceNumber, wholesalerId, resolveParty(row.partyToken),
          row.issueDate, row.dueDate,
          row.subtotal ?? taxable, row.discount ?? 0, taxable,
          tax.cgst, tax.sgst, tax.igst, tax.total, row.totalCess ?? 0,
          row.roundOff ?? 0, row.grandTotal,
          row.paymentStatus || "Pending",
          row.customer || null, row.recipientGstin || null, row.recipientCity || null,
          row.recipientState || null, stateCode(row.recipientState) || null,
          row.recipientAddress || null,
          row.placeOfSupply || row.recipientState || null,
          stateCode(row.placeOfSupply || row.recipientState) || null,
          me.company_name || [me.first_name, me.last_name].filter(Boolean).join(" ") || null,
          me.gstin || null, sellerState, sellerState, row.notes || null,
          row.channel || null, batch,
        ],
      );

      for (const line of mine) {
        await client.query(
          `INSERT INTO invoice_items (invoice_id, product_name, hsn_code, quantity, unit_price,
             gst_percent, tax_amount, uqc, cess_percent, cess_amount, total)
           VALUES ($1,$2,$3,COALESCE($4::numeric,1),COALESCE($5::numeric,0),$6::numeric,
             COALESCE($7::numeric,0),$8,COALESCE($9::numeric,0),
             COALESCE($10::numeric,0),COALESCE($11::numeric,0))`,
          [rows[0].id, line.productName, line.hsnCode, line.quantity, line.unitPrice,
           line.gstPercent, line.taxAmount, line.uqc, line.cessPercent, line.cessAmount,
           line.total ?? round2((line.quantity || 1) * (line.unitPrice || 0))],
        );
      }
      count++;
    }

    // And move the counter past them, so the next bill raised here does not
    // collide with one of these. See numberingNote for why this is not
    // renumbering anything.
    for (const move of numbering?.moved || []) {
      await client.query(
        `INSERT INTO invoice_sequences (wholesaler_id, series, year, last_number)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (wholesaler_id, series, year)
         DO UPDATE SET last_number = GREATEST(invoice_sequences.last_number, EXCLUDED.last_number)`,
        [wholesalerId, move.series, move.year, move.to],
      );
    }

    return count;
  }

  /**
   * What a document is worth.
   *
   * THE FIGURE ON THE PAPER WINS. If the file says the total, that is the
   * total, even when the lines add up to something else. An old bill was
   * handed to a customer who paid what it said, and recomputing it here would
   * move the debt away from the figure he agreed. The same reasoning the sale
   * side already uses when a sale follows an order.
   *
   * Only when there is no total at all are the lines added up, because then
   * there is nothing else to go on.
   */
  totalsFrom(row, lines) {
    const fromLines = round2(
      lines.reduce((a, l) => a + (l.amount ?? (l.quantity || 1) * (l.rate || 0)), 0),
    );
    const subtotal = row.subtotal ?? (lines.length ? fromLines : null);
    const discount = row.discount ?? 0;
    const tax = row.taxAmount ?? 0;
    const total = row.total ?? round2((subtotal || 0) - discount + tax);
    return {
      subtotal: subtotal ?? round2(total - tax + discount),
      discount,
      tax,
      total,
    };
  }

  /**
   * The tax split on an imported bill.
   *
   * Taken from the file when the file says it. When the file gives only one
   * tax figure, which state the customer is in decides how it splits, and that
   * question is asked of placeOfSupply and of nothing else, the same as
   * everywhere else in this codebase. Same state is CGST plus SGST, a
   * different state is IGST, and it is a number on a legal document.
   */
  taxFrom(row, sellerState) {
    if (row.igst !== null && row.igst !== undefined) {
      return { cgst: 0, sgst: 0, igst: row.igst, total: row.igst };
    }
    if (row.cgst !== null && row.cgst !== undefined) {
      const total = round2((row.cgst || 0) + (row.sgst || 0));
      return { cgst: row.cgst, sgst: row.sgst, igst: 0, total };
    }
    const total = row.totalTax ?? 0;
    if (!total) return { cgst: 0, sgst: 0, igst: 0, total: 0 };

    const intra = isIntraState(
      { state: sellerState },
      { state: row.placeOfSupply || row.recipientState, gstin: row.recipientGstin,
        city: row.recipientCity },
    );
    if (intra) {
      const half = round2(total / 2);
      // The remainder goes to CGST so the two halves add back to the figure on
      // the bill, rather than losing a paisa on an odd total.
      return { cgst: round2(total - half), sgst: half, igst: 0, total };
    }
    return { cgst: 0, sgst: 0, igst: total, total };
  }
}

module.exports = new ImportService();
module.exports.ORDER = ORDER;
module.exports.nameKey = nameKey;

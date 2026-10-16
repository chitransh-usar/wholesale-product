const pool = require("../config/db");
const { ZipWriter } = require("./zipWriter");
const invoiceRepository = require("../repositories/invoiceRepository");

/**
 * A wholesaler's own book, out as a zip.
 *
 * THE ONE RULE THIS FILE EXISTS TO HOLD. Every query here is scoped by the
 * wholesaler id taken from the caller's TOKEN. Not from a query string, not
 * from the body, not from a path parameter. An export endpoint that takes an
 * id from the request is how one wholesaler reads another's entire book in a
 * single download, and it is the worst version of that bug because the whole
 * point of the feature is to hand over a file.
 *
 * So `wholesalerId` is a required argument with no default, every statement
 * names it, and the child tables are joined back to their parent rather than
 * queried on their own. A purchase line has no owner column of its own, so it
 * is reached through its purchase.
 *
 * WHAT IS IN IT. A CSV per table, and the invoice PDFs. CSV because it opens
 * in whatever the wholesaler's accountant uses without anybody installing
 * anything, and because this is their data leaving, so a format they can read
 * without us matters more than one that is convenient to re-import.
 */

/** A table missing from this database is skipped rather than failing the lot. */
const tableExists = async (name) => {
  const { rows } = await pool.query("SELECT to_regclass($1) IS NOT NULL AS yes", [
    `public.${name}`,
  ]);
  return Boolean(rows[0]?.yes);
};

/**
 * One CSV cell.
 *
 * Quoted when it has to be, and a quote inside is doubled, which is what the
 * format says. Dates go out as ISO so a spreadsheet in any locale reads them
 * the same way round: a statement exported here is opened by somebody who did
 * not choose the format.
 *
 * A leading =, +, - or @ is prefixed with a quote. A cell starting with one of
 * those is executed as a formula by Excel and by Sheets when the file is
 * opened, so a customer name somebody typed as "=cmd|..." becomes an attack on
 * whoever opens the export. This is the one place in the product where another
 * program runs our data.
 */
const cell = (value) => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") return JSON.stringify(value);

  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
};

/** Rows to a CSV, taking the header from the first row's own columns. */
const toCsv = (rows) => {
  if (!rows.length) return "";
  const columns = Object.keys(rows[0]);
  const lines = [columns.join(",")];
  for (const row of rows) lines.push(columns.map((c) => cell(row[c])).join(","));
  // A trailing newline, because a file without one reads as truncated to some
  // tools and every one of them accepts it.
  return `${lines.join("\n")}\n`;
};

/**
 * What goes in, in the order a person would look for it.
 *
 * Each query names the owner exactly once, as $1. Child tables join up to
 * their parent so they cannot be read on their own, which is what stops a
 * missing WHERE from leaking a table.
 */
const TABLES = [
  {
    file: "customers.csv",
    table: "parties",
    sql: `SELECT * FROM parties WHERE wholesaler_id = $1 ORDER BY created_at`,
  },
  {
    file: "sales.csv",
    table: "sales",
    sql: `SELECT * FROM sales WHERE wholesaler_id = $1 ORDER BY sale_date, created_at`,
  },
  {
    file: "sale-lines.csv",
    table: "sale_lines",
    sql: `SELECT l.* FROM sale_lines l
            JOIN sales s ON s.id = l.sale_id
           WHERE s.wholesaler_id = $1
           ORDER BY l.sale_id, l.created_at`,
  },
  {
    file: "payments-received.csv",
    table: "party_payments",
    sql: `SELECT * FROM party_payments WHERE wholesaler_id = $1 ORDER BY paid_on, created_at`,
  },
  {
    file: "suppliers.csv",
    table: "suppliers",
    sql: `SELECT * FROM suppliers WHERE wholesaler_id = $1 ORDER BY created_at`,
  },
  {
    file: "purchases.csv",
    table: "purchases",
    sql: `SELECT * FROM purchases WHERE wholesaler_id = $1 ORDER BY purchase_date, created_at`,
  },
  {
    file: "purchase-lines.csv",
    table: "purchase_lines",
    sql: `SELECT l.* FROM purchase_lines l
            JOIN purchases p ON p.id = l.purchase_id
           WHERE p.wholesaler_id = $1
           ORDER BY l.purchase_id`,
  },
  {
    file: "invoices.csv",
    table: "invoices",
    sql: `SELECT * FROM invoices WHERE supplier_id = $1 ORDER BY issue_date, invoice_number`,
  },
  {
    file: "invoice-lines.csv",
    table: "invoice_items",
    sql: `SELECT l.* FROM invoice_items l
            JOIN invoices i ON i.id = l.invoice_id
           WHERE i.supplier_id = $1
           ORDER BY l.invoice_id, l.id`,
  },
];

/**
 * How many bills to render as PDFs.
 *
 * Each one is a document generated on the spot, so a wholesaler with four
 * thousand invoices would otherwise wait several minutes on a request that
 * holds a connection the whole time, and the archive is built in memory.
 * Capped, newest first, and the readme says plainly how many were included and
 * how many were not, rather than quietly handing over a partial set.
 */
const PDF_LIMIT = 200;

class ExportService {
  /**
   * @param {string} wholesalerId  from the TOKEN, never from the request
   * @param {object} [options]     { includePdfs }
   */
  async buildZip(wholesalerId, options = {}) {
    if (!wholesalerId) {
      throw new Error("An export needs the wholesaler it is for.");
    }

    const zip = new ZipWriter();
    const summary = [];

    for (const spec of TABLES) {
      if (!(await tableExists(spec.table))) {
        summary.push(`${spec.file.padEnd(24)} not set up on this database`);
        continue;
      }
      const { rows } = await pool.query(spec.sql, [wholesalerId]);
      // An empty table still gets its file, with nothing in it. A missing file
      // reads as "the export broke"; an empty one reads as "you have none".
      zip.add(`data/${spec.file}`, toCsv(rows));
      summary.push(`${spec.file.padEnd(24)} ${rows.length} row${rows.length === 1 ? "" : "s"}`);
    }

    let pdfNote = "No invoice PDFs were asked for.";
    if (options.includePdfs !== false && (await tableExists("invoices"))) {
      pdfNote = await this.addInvoicePdfs(zip, wholesalerId);
    }

    zip.add("readme.txt", this.readme(summary, pdfNote));
    return zip.end();
  }

  /**
   * The bills themselves, as they would print.
   *
   * Rendered one at a time rather than in parallel: the PDF service reads the
   * platform's number format through a module level value, and forty of them
   * at once is forty connections held for the sake of a download nobody is
   * watching.
   *
   * A bill that will not render is skipped and named in the readme. One broken
   * document must not cost the wholesaler the other hundred and ninety nine.
   */
  async addInvoicePdfs(zip, wholesalerId) {
    const pdfService = require("./pdfService");

    const { rows } = await pool.query(
      `SELECT id, invoice_number FROM invoices
        WHERE supplier_id = $1
        ORDER BY issue_date DESC NULLS LAST, invoice_number DESC
        LIMIT ${PDF_LIMIT + 1}`,
      [wholesalerId],
    );

    const more = rows.length > PDF_LIMIT;
    const wanted = rows.slice(0, PDF_LIMIT);
    const failed = [];

    for (const row of wanted) {
      try {
        const invoice = await invoiceRepository.findInvoiceById(row.id);
        // Scoped again on the way out. findInvoiceById takes an id alone, and
        // this is the one place a stray id would become a file in somebody
        // else's download.
        if (!invoice || String(invoice.supplier_id) !== String(wholesalerId)) continue;
        const buffer = await pdfService.generateInvoicePDF(invoice);
        const safe = String(row.invoice_number || row.id).replace(/[^A-Za-z0-9._-]/g, "-");
        zip.add(`invoices/${safe}.pdf`, buffer);
      } catch (err) {
        failed.push(`${row.invoice_number || row.id}: ${err.message}`);
      }
    }

    const kept = wanted.length - failed.length;
    const lines = [`${kept} invoice${kept === 1 ? "" : "s"} included as ${
      kept === 1 ? "a PDF" : "PDFs"}.`];
    if (more) {
      lines.push(
        `Only the most recent ${PDF_LIMIT} were rendered. The CSVs above cover every`,
        `invoice you have; this limit applies to the PDFs only.`,
      );
    }
    if (failed.length) {
      lines.push("", "These would not render and are missing from this file:");
      for (const f of failed) lines.push(`  ${f}`);
    }
    return lines.join("\n");
  }

  /** Plain English, because the person opening this is a trader, not a DBA. */
  readme(summary, pdfNote) {
    // Stamped in Indian time, because the person reading it keeps his books in
    // Indian time and a UTC stamp reads five and a half hours wrong to him.
    // The server may be anywhere, so the offset is applied rather than assumed.
    const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000)
      .toISOString().slice(0, 16).replace("T", " ");

    return [
      "YOUR DATA",
      "",
      `Taken ${ist} IST.`,
      "",
      "This is everything in your own book and nothing from anybody else's.",
      "",
      "data/       one spreadsheet per list. They are .csv files, which Excel",
      "            and Google Sheets both open.",
      "invoices/   your bills, exactly as they print.",
      "",
      "WHAT IS IN THE SPREADSHEETS",
      "",
      ...summary.map((line) => `  ${line}`),
      "",
      "INVOICE PDFs",
      "",
      pdfNote,
      "",
      "A NOTE ON OPENING THESE",
      "",
      "A few cells may start with an apostrophe. That is deliberate. A cell",
      "beginning with =, + or - is run as a formula by Excel and by Sheets, so",
      "the apostrophe stops text somebody typed into a name field from being",
      "executed on the machine that opens this. Delete it if it bothers you.",
      "",
    ].join("\n");
  }
}

module.exports = new ExportService();
module.exports.toCsv = toCsv;
module.exports.cell = cell;
module.exports.TABLES = TABLES;
module.exports.PDF_LIMIT = PDF_LIMIT;

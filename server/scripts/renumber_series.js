/**
 * Renumber documents already issued into the new scheme.
 *
 * On 12 Sept all three series moved to prefix / serial / financial year:
 * INV/1/26-27, S/1/26-27, DC/1/26-27, restarting each 1 April. That changed
 * what NEW documents get. Everything already written kept the number printed
 * on it: INV-000001, S-0001, DC-0001.
 *
 * This brings the old ones across, for a database where that is the right
 * thing to do.
 *
 * ---------------------------------------------------------------------------
 * READ THIS BEFORE POINTING IT AT ANYTHING REAL
 * ---------------------------------------------------------------------------
 *
 * Sales and challans are the wholesaler's own records. Renumbering them
 * changes nothing outside their own book and is safe.
 *
 * A TAX INVOICE IS NOT. Its number is what the customer's books reference and
 * what their input tax credit is claimed against. Renumbering one that has
 * already gone out means their records point at a number that no longer exists,
 * and under Rule 46(b) the serial is supposed to be fixed for the financial
 * year. This script will do it because it was asked for against test data, and
 * it says so every time it runs. Use --skip-invoices to leave them alone.
 *
 * ---------------------------------------------------------------------------
 * HOW IT NUMBERS
 * ---------------------------------------------------------------------------
 *
 * Documents are ordered by their own date, then by when the row was written,
 * and numbered 1, 2, 3 within each financial year they fall in. So a sale
 * dated March 2026 lands in 25-26 and one dated April 2026 in 26-27, each with
 * its own run starting at 1. That is what the live counters now do, so the
 * renumbered history and everything issued afterwards form one series.
 *
 * Invoices use the wholesaler's OWN saved prefix and suffix, through the same
 * compose() the live code uses, so a wholesaler who set OM/ and /{FY} gets
 * OM/1/26-27 rather than whatever this script would have picked. The result is
 * checked against Rule 46(b) before it is written; an illegal one stops the
 * whole run rather than being quietly truncated.
 *
 * Renaming happens in two passes inside one transaction, because going
 * straight from S-0002 to S/1/26-27 can collide with a row this run has not
 * reached yet. Pass one moves every row to a temporary number, pass two puts
 * the real one on. Both numbers are unique per wholesaler, so nothing outside
 * their book can be disturbed.
 *
 * The counters are then set to the highest number in each year, so the next
 * document continues the run rather than colliding with it.
 *
 *     node scripts/renumber_series.js <DATABASE_URL> <email>                 # dry run
 *     node scripts/renumber_series.js <DATABASE_URL> <email> --write
 *     node scripts/renumber_series.js <DATABASE_URL> <email> --write --skip-invoices
 */
const { Pool } = require("pg");
const path = require("path");

const url = process.argv[2];
const email = process.argv[3];
const write = process.argv.includes("--write");
const skipInvoices = process.argv.includes("--skip-invoices");

if (!url || !email) {
  console.error(
    "\nUsage: node scripts/renumber_series.js <DATABASE_URL> <email> [--write] [--skip-invoices]\n" +
    "\nWithout --write nothing is changed and you get the full before and after.\n",
  );
  process.exit(1);
}

const local = /127\.0\.0\.1|localhost/.test(url);
const pool = new Pool({
  connectionString: url,
  ...(local ? {} : { ssl: { rejectUnauthorized: false } }),
});

// The live code, so this cannot drift from what the product itself produces.
process.env.DATABASE_URL = url;
const numberService = require(path.join(__dirname, "../src/services/invoiceNumberService"));

/** The financial year a date falls in: 1 April to 31 March. */
const fyOf = (value) => {
  const d = value ? new Date(value) : new Date();
  const year = d.getFullYear();
  const start = d.getMonth() >= 3 ? year : year - 1;
  const two = (n) => String(n % 100).padStart(2, "0");
  return `${two(start)}-${two(start + 1)}`;
};

/**
 * One document type, renumbered.
 *
 * `shape` is given the sequence and the financial year and returns the number.
 * It is a function rather than a format string so invoices can go through
 * compose() and be checked against Rule 46(b), while sales and challans use
 * the plain form.
 */
const renumber = async (client, spec) => {
  const { table, column, dateColumn, ownerColumn, ownerId, label, shape } = spec;

  const rows = (await client.query(
    `SELECT id, ${column} AS number, ${dateColumn} AS on_date
       FROM ${table}
      WHERE ${ownerColumn} = $1
      ORDER BY ${dateColumn} ASC, created_at ASC`,
    [ownerId],
  )).rows;

  if (rows.length === 0) {
    console.log(`\n  ${label}: none`);
    return { changed: 0, counters: new Map() };
  }

  const counters = new Map();
  const plan = [];
  for (const row of rows) {
    const fy = fyOf(row.on_date);
    const next = (counters.get(fy) || 0) + 1;
    counters.set(fy, next);
    const built = shape(next, fy);
    if (built.error) {
      throw new Error(
        `${label} ${row.number} would become "${built.number}", which is not allowed: ${built.error}`,
      );
    }
    plan.push({ id: row.id, from: row.number, to: built.number });
  }

  const changed = plan.filter((p) => p.from !== p.to);
  console.log(`\n  ${label}: ${rows.length} document(s), ${changed.length} to renumber`);
  for (const p of plan.slice(0, 12)) {
    console.log(`    ${String(p.from).padEnd(18)} ${p.from === p.to ? "unchanged" : "->  " + p.to}`);
  }
  if (plan.length > 12) console.log(`    ... and ${plan.length - 12} more`);

  if (write && changed.length > 0) {
    // Two passes. Going straight to the final number can collide with a row
    // this run has not reached yet.
    for (const p of changed) {
      await client.query(
        `UPDATE ${table} SET ${column} = $2 WHERE id = $1`,
        [p.id, `~R${String(p.id).slice(0, 12)}`],
      );
    }
    for (const p of changed) {
      await client.query(`UPDATE ${table} SET ${column} = $2 WHERE id = $1`, [p.id, p.to]);
    }
  }

  return { changed: changed.length, counters };
};

/** Point a counter at the highest number used in each year. */
const resetCounter = async (client, table, ownerId, counters, hasFy) => {
  if (!write) return;
  if (hasFy) {
    for (const [fy, last] of counters) {
      await client.query(
        `INSERT INTO ${table} (wholesaler_id, financial_year, last_number)
         VALUES ($1, $2, $3)
         ON CONFLICT (wholesaler_id, financial_year)
         DO UPDATE SET last_number = GREATEST(${table}.last_number, EXCLUDED.last_number)`,
        [ownerId, fy, last],
      );
    }
  }
};

(async () => {
  const who = (await pool.query(
    `SELECT u.id, u.email, wp.company_name
       FROM users u LEFT JOIN wholesaler_profiles wp ON wp.user_id = u.id
      WHERE lower(u.email) = lower($1)`,
    [email],
  )).rows;
  if (who.length !== 1) {
    console.error(`\n${who.length === 0 ? "No account with" : "More than one account shares"} the email ${email}.\n`);
    process.exit(1);
  }
  const seller = who[0];

  // Does this database have the financial year on its counters yet? Without
  // it the live code still produces S-0001, and renumbering the history into a
  // shape the product will not continue would leave a worse mess than it found.
  const ready = (await pool.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'sale_sequences'
                       AND column_name = 'financial_year') AS yes`,
  )).rows[0].yes;
  if (!ready) {
    console.error(
      "\nwholesale3_series_financial_year.sql has not been run against this database.\n" +
      "Until it is, new sales and challans are still numbered S-0001 and DC-0001,\n" +
      "so renumbering the old ones would leave two schemes side by side.\n" +
      "Run the migration first.\n",
    );
    process.exit(1);
  }

  console.log(`\n${write ? "RENUMBERING" : "Dry run, nothing will be changed"}`);
  console.log(`Wholesaler: ${seller.company_name || seller.email} <${seller.email}>`);

  if (!skipInvoices) {
    console.log(
      "\n  A tax invoice number is what your customer's books reference and what\n" +
      "  their input tax credit is claimed against. Renumbering one that has gone\n" +
      "  out leaves their records pointing at a number that no longer exists. This\n" +
      "  is fine for test data and is not fine for real trading history.\n" +
      "  Use --skip-invoices to leave invoices alone.",
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const sales = await renumber(client, {
      table: "sales", column: "sale_number", dateColumn: "sale_date",
      ownerColumn: "wholesaler_id", ownerId: seller.id, label: "Sales",
      shape: (n, fy) => ({ number: `S/${n}/${fy}` }),
    });
    await resetCounter(client, "sale_sequences", seller.id, sales.counters, true);

    let challans = { changed: 0, counters: new Map() };
    const hasChallans = (await client.query(
      "SELECT to_regclass('public.delivery_challans') IS NOT NULL AS yes")).rows[0].yes;
    if (hasChallans) {
      challans = await renumber(client, {
        table: "delivery_challans", column: "challan_number", dateColumn: "issue_date",
        ownerColumn: "wholesaler_id", ownerId: seller.id, label: "Delivery challans",
        shape: (n, fy) => ({ number: `DC/${n}/${fy}` }),
      });
      await resetCounter(client, "delivery_challan_sequences", seller.id, challans.counters, true);
    }

    let invoices = { changed: 0, counters: new Map() };
    if (!skipInvoices) {
      // Their own saved format, so a wholesaler who set OM/ and /{FY} keeps it.
      const settings = (await client.query(
        `SELECT prefix, number_suffix, number_pad_to FROM invoice_settings WHERE user_id = $1`,
        [seller.id],
      )).rows[0] || {};
      const prefix = settings.prefix || "INV/";
      const suffix = settings.number_suffix ?? "/{FY}";
      const padTo = Number(settings.number_pad_to ?? 0);
      console.log(`\n  Using their own format: prefix "${prefix}", ends with "${suffix}", ${padTo} leading zeros`);

      invoices = await renumber(client, {
        table: "invoices", column: "invoice_number", dateColumn: "issue_date",
        ownerColumn: "supplier_id", ownerId: seller.id, label: "Invoices",
        shape: (n, fy) => {
          // Composed through the live function and checked against Rule 46(b),
          // with the year forced to this document's own year rather than today's.
          const built = numberService.compose({
            prefix: String(prefix).replace(/\{FY\}/g, fy),
            suffix: String(suffix).replace(/\{FY\}/g, fy),
            padTo, sequence: n,
          });
          return built.ok ? { number: built.number } : { number: built.number, error: built.reason };
        },
      });

      if (write && invoices.changed > 0) {
        // The cached PDF is named after the old number, so it is now wrong.
        // pdf_url is a route and regenerates itself; pdf_path points at a file.
        // Clearing it makes the next request rebuild the document.
        const cleared = await client.query(
          `UPDATE invoices SET pdf_path = NULL
            WHERE supplier_id = $1 AND pdf_path IS NOT NULL`,
          [seller.id],
        );
        console.log(`\n  Cleared ${cleared.rowCount} cached PDF path(s) so they rebuild with the new number.`);
      }

      /**
       * The invoice counter is keyed on the financial year already, but as an
       * INTEGER start year rather than the "26-27" label the number prints.
       * financialYearKey is what the live code counts against, so this uses it
       * rather than passing the label and getting a type error.
       */
      if (write) {
        for (const [fy, last] of invoices.counters) {
          const startYear = 2000 + Number(String(fy).split("-")[0]);
          await client.query(
            `INSERT INTO invoice_sequences (wholesaler_id, year, last_number)
             VALUES ($1, $2, $3)
             ON CONFLICT (wholesaler_id, year)
             DO UPDATE SET last_number = GREATEST(invoice_sequences.last_number, EXCLUDED.last_number)`,
            [seller.id, startYear, last],
          );
        }
      }
    } else {
      console.log("\n  Invoices: skipped, as asked.");
    }

    const total = sales.changed + challans.changed + invoices.changed;
    if (write) {
      await client.query("COMMIT");
      console.log(`\n${total} document(s) renumbered, and the counters now continue the run.\n`);
    } else {
      await client.query("ROLLBACK");
      console.log(`\n${total} document(s) would be renumbered. Nothing has been touched.`);
      console.log("Run it again with --write to apply.\n");
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(
      "\nNothing was changed. The whole run is one transaction, so a failure part\n" +
      "way through leaves every number exactly as it was.\n",
    );
    console.error(err.message);
    process.exit(1);
  } finally {
    client.release();
  }

  await pool.end();
})().catch((err) => {
  console.error("THREW", err.message);
  process.exit(1);
});

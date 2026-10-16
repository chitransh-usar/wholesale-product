/**
 * Clear the books and start fresh, keeping the shop.
 *
 * Asked for on 11 Sept 2026, before production, after a run of balances that
 * could not be reconciled because the code that made them has since changed.
 * The quickest honest answer to inconsistent test data is to stop trying to
 * repair it and begin again with the rules that are now in place.
 *
 * WHAT IT DELETES
 *   every order, and everything hanging off one: items, status history,
 *   payment transactions, shipments, tracking links, checkpoints, reviews
 *   every sale and its lines
 *   every invoice, its items, its logs and its payments
 *   every credit note and delivery challan, and their numbering counters
 *   every customer in the khata and every payment recorded against one
 *
 * WHAT IT KEEPS
 *   login accounts, the business profile, staff and their permissions
 *   products and shop listings
 *   invoice settings: prefix, due days, default tax rate, terms
 *   notification preferences and device tokens
 *
 * STOCK IS NOT PUT BACK. Ordering reserves stock off a listing, and nothing
 * records what the figure was before. Deleting the orders cannot undo the
 * reservation without inventing a number, so it does not try: after running
 * this, go through Products and set the stock figures to what is actually on
 * the shelf. The script prints every listing and its current figure so there
 * is a list to work from.
 *
 * It is scoped to ONE wholesaler, by email, so a shared database is not
 * emptied by a wholesaler clearing their own books.
 *
 *     node scripts/reset_books.js <DATABASE_URL> <email>            # dry run
 *     node scripts/reset_books.js <DATABASE_URL> <email> --write    # do it
 *
 * The dry run is the default and changes nothing. It prints exactly what the
 * real run would delete, counted from the database rather than guessed.
 */
const { Pool } = require("pg");

const url = process.argv[2];
const email = process.argv[3];
const write = process.argv.includes("--write");

if (!url || !email) {
  console.error(
    "\nUsage: node scripts/reset_books.js <DATABASE_URL> <email> [--write]\n" +
    "\nThe email is the wholesaler whose books are cleared. Without --write\n" +
    "nothing is deleted and you get a count of what would be.\n",
  );
  process.exit(1);
}

// Neon needs TLS; a local Postgres started for a rehearsal does not offer it.
const local = /127\.0\.0\.1|localhost/.test(url);
const pool = new Pool({
  connectionString: url,
  ...(local ? {} : { ssl: { rejectUnauthorized: false } }),
});

/**
 * Deletes, in an order that never leaves a row pointing at a missing one.
 *
 * Children before parents, every time. Written out rather than done with
 * TRUNCATE CASCADE on purpose: cascade would follow a foreign key into a table
 * nobody listed here and empty that too, and finding out afterwards which ones
 * it took is not a position to be in.
 *
 * Each entry is [table, SQL that selects the ids to delete]. `$1` is the
 * wholesaler's user id throughout.
 */
const ORDER_IDS = `SELECT id FROM orders WHERE supplier_id = $1`;
const PARTY_IDS = `SELECT id FROM parties WHERE wholesaler_id = $1`;
const SALE_IDS = `SELECT id FROM sales WHERE wholesaler_id = $1`;
const INVOICE_IDS = `SELECT id FROM invoices WHERE supplier_id = $1`;
const CN_IDS = `SELECT id FROM credit_notes WHERE wholesaler_id = $1`;
const DC_IDS = `SELECT id FROM delivery_challans WHERE wholesaler_id = $1`;

const STEPS = [
  // Documents, deepest first.
  ["credit_note_items", `credit_note_id IN (${CN_IDS})`],
  ["credit_notes", `wholesaler_id = $1`],
  ["delivery_challan_items", `challan_id IN (${DC_IDS})`],
  ["delivery_challans", `wholesaler_id = $1`],
  ["payments", `invoice_id IN (${INVOICE_IDS})`],
  ["invoice_items", `invoice_id IN (${INVOICE_IDS})`],
  ["invoice_logs", `invoice_id IN (${INVOICE_IDS})`],
  ["invoices", `supplier_id = $1`],

  // The khata.
  ["party_payments", `wholesaler_id = $1`],

  // The sales book.
  ["sale_lines", `sale_id IN (${SALE_IDS})`],
  ["sales", `wholesaler_id = $1`],

  // Anything hanging off an order.
  ["credit_transactions", `order_id IN (${ORDER_IDS})`],
  ["credit_account_audit", `party_id IN (${PARTY_IDS})`],
  ["product_reviews", `order_id IN (${ORDER_IDS})`],
  ["seller_reviews", `order_id IN (${ORDER_IDS})`],
  ["reviews", `order_id IN (${ORDER_IDS})`],
  ["shipment_checkpoints", `order_id IN (${ORDER_IDS})`],
  ["shipment_tracking_links", `order_id IN (${ORDER_IDS})`],
  ["shipments", `order_id IN (${ORDER_IDS})`],
  ["return_requests", `order_id IN (${ORDER_IDS})`],
  ["payment_transactions", `order_id IN (${ORDER_IDS})`],
  ["order_status_history", `order_id IN (${ORDER_IDS})`],
  ["order_analytics", `order_id IN (${ORDER_IDS})`],
  ["order_items", `order_id IN (${ORDER_IDS})`],
  ["orders", `supplier_id = $1`],

  // The customers themselves, once nothing points at them.
  ["parties", `wholesaler_id = $1`],

  // Stock movement history, which only described orders that are now gone.
  ["inventory_log", `inventory_id IN (SELECT id FROM supplier_inventory WHERE supplier_id = $1)`],

  // The numbering counters, so the fresh books start at 1 rather than
  // carrying on from a run of documents that no longer exist.
  ["invoice_sequences", `wholesaler_id = $1`],
  ["sale_sequences", `wholesaler_id = $1`],
  ["credit_note_sequences", `wholesaler_id = $1`],
  ["delivery_challan_sequences", `wholesaler_id = $1`],
];

const exists = async (table) => {
  const probe = await pool.query("SELECT to_regclass($1) IS NOT NULL AS yes", [`public.${table}`]);
  return Boolean(probe.rows[0].yes);
};

(async () => {
  const who = await pool.query(
    `SELECT u.id, u.first_name, u.last_name, u.email, wp.company_name
       FROM users u
       LEFT JOIN wholesaler_profiles wp ON wp.user_id = u.id
      WHERE lower(u.email) = lower($1)`,
    [email],
  );
  if (who.rows.length === 0) {
    console.error(`\nNo account with the email ${email}.\n`);
    process.exit(1);
  }
  if (who.rows.length > 1) {
    console.error(`\n${who.rows.length} accounts share that email. Refusing to guess.\n`);
    process.exit(1);
  }
  const seller = who.rows[0];

  console.log(`\n${write ? "CLEARING" : "Dry run, nothing will be deleted"}`);
  console.log(`Wholesaler: ${seller.company_name || `${seller.first_name} ${seller.last_name}`} <${seller.email}>\n`);

  const client = await pool.connect();
  let total = 0;
  try {
    await client.query("BEGIN");

    for (const [table, where] of STEPS) {
      if (!(await exists(table))) {
        console.log(`  skip  ${table.padEnd(28)} (no such table here)`);
        continue;
      }
      const counted = await client.query(
        `SELECT COUNT(*)::int AS n FROM ${table} WHERE ${where}`,
        [seller.id],
      );
      const n = counted.rows[0].n;
      total += n;
      if (n === 0) continue;

      if (write) {
        await client.query(`DELETE FROM ${table} WHERE ${where}`, [seller.id]);
        console.log(`  gone  ${table.padEnd(28)} ${n}`);
      } else {
        console.log(`  would ${table.padEnd(28)} ${n}`);
      }
    }

    if (write) {
      await client.query("COMMIT");
      console.log(`\n${total} rows deleted. The books are empty.`);
    } else {
      // The counts above were read inside this transaction; rolling back is
      // what makes the dry run a dry run even though nothing wrote.
      await client.query("ROLLBACK");
      console.log(`\n${total} rows would be deleted. Nothing has been touched.`);
      console.log("Run it again with --write to actually clear them.");
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\nNothing was deleted. The whole thing is one transaction, so a\n" +
                  "failure part way through leaves the books exactly as they were.\n");
    console.error(err.message);
    process.exit(1);
  } finally {
    client.release();
  }

  // What is kept, and the one thing that needs a human afterwards.
  const kept = await pool.query(
    `SELECT si.id, p.name, si.stock, si.price, si.status
       FROM supplier_inventory si
       JOIN products p ON p.id = si.product_id
      WHERE si.supplier_id = $1
      ORDER BY p.name`,
    [seller.id],
  );
  if (kept.rows.length > 0) {
    console.log(`\nYour ${kept.rows.length} listing(s) are untouched. Stock figures as they stand:\n`);
    for (const row of kept.rows) {
      console.log(`    ${String(row.name).slice(0, 40).padEnd(42)} ${String(row.stock).padStart(8)}  (${row.status})`);
    }
    console.log(
      "\nOrdering reserves stock, and deleting those orders cannot put it back\n" +
      "without inventing a number. Check these against what is on the shelf\n" +
      "and correct them on the Products screen.",
    );
  }

  const staff = await pool.query(
    "SELECT COUNT(*)::int AS n FROM staff_members WHERE owner_id = $1",
    [seller.id],
  ).catch(() => ({ rows: [{ n: 0 }] }));
  console.log(`\nKept: your login, your business profile, ${kept.rows.length} listing(s), ` +
              `${staff.rows[0].n} staff member(s), and your invoice settings.\n`);

  await pool.end();
})().catch((err) => {
  console.error("THREW", err.message);
  process.exit(1);
});

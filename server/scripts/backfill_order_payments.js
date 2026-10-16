/**
 * Bring marketplace payments that already happened into the khata.
 *
 * Every settled payment_transactions row becomes a party_payments row against
 * the customer its order belongs to, so the customer page and the statement
 * account for money taken before the two ledgers were joined.
 *
 * Safe to run more than once: the unique index on payment_transaction_id
 * refuses a second row for the same payment, so a repeat run reports
 * everything as already done rather than doubling anyone's credit.
 *
 * Run scripts/backfill_order_parties.js first. A payment can only be filed
 * under a customer once its order knows which customer it belongs to.
 *
 *     node scripts/backfill_order_payments.js --dry    report, change nothing
 *     node scripts/backfill_order_payments.js          do it
 */
require("dotenv").config();
const pool = require("../src/config/db");
const { hasLedgerLink, recordOrderPayment } = require("../src/services/partyService");

const DRY = process.argv.includes("--dry");

(async () => {
  const client = await pool.connect();
  let written = 0;
  let already = 0;
  let noParty = 0;

  try {
    if (!(await hasLedgerLink(client))) {
      console.error(
        "This database has not had the latest migrations run.\n" +
          "  Run this first, from the server folder:\n" +
          "      npm run migrate\n" +
          "  then try this again.",
      );
      process.exitCode = 1;
      return;
    }

    // Only money that actually settled. A pending or superseded attempt is not
    // a payment, and counting one would hand a customer credit they never paid.
    const settled = await client.query(
      `SELECT pt.id, pt.order_id, pt.amount, pt.payment_method,
              pt.payment_date, o.party_id, o.supplier_id, o.order_number
         FROM payment_transactions pt
         JOIN orders o ON o.id = pt.order_id
        WHERE pt.payment_status IN ('completed', 'paid')
          AND pt.amount > 0
        ORDER BY pt.payment_date ASC NULLS LAST, pt.id ASC`,
    );

    console.log(`${settled.rows.length} settled payment(s) to consider.`);
    if (DRY) await client.query("BEGIN");

    for (const row of settled.rows) {
      // An order with no customer cannot be filed. Running the parties
      // backfill first is what fixes this, so say so rather than guessing.
      if (!row.party_id) {
        noParty++;
        continue;
      }

      const wrote = await recordOrderPayment(client, {
        orderId: row.order_id,
        partyId: row.party_id,
        wholesalerId: row.supplier_id,
        amount: row.amount,
        method: row.payment_method,
        transactionId: row.id,
        paidOn: row.payment_date ? new Date(row.payment_date).toISOString().slice(0, 10) : null,
        note: `Order ${row.order_number || row.order_id}`,
      });
      if (wrote) written++;
      else already++;
    }

    if (DRY) await client.query("ROLLBACK");

    console.log(
      `${DRY ? "Would add" : "Added"} ${written} payment(s) to the khata, ` +
        `${already} already there, ${noParty} skipped for having no customer.`,
    );
    if (noParty > 0) {
      console.log(
        "Run scripts/backfill_order_parties.js first, then this again, to file those.",
      );
    }
    if (DRY) console.log("Dry run: nothing was saved.");
  } finally {
    client.release();
    await pool.end();
  }
})();

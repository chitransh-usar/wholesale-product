/**
 * Write the orders already accepted into the sales book.
 *
 * From now on an order writes its sale the moment a wholesaler accepts it.
 * Orders accepted before that existed never did, so they are in the customer
 * book as orders but not as sales, and the invoice and credit note flows
 * cannot see them. This catches them up.
 *
 * Only orders that are genuinely business: accepted or further along, and not
 * cancelled, refunded or returned. An order still waiting for payment is a
 * request, not a sale, and writing one for it would put goods in the book that
 * were never sold.
 *
 * Safe to run more than once. One sale per order is enforced by a unique
 * index, and this asks first, so a repeat run reports everything as already
 * done rather than doubling anybody's balance.
 *
 * Run scripts/backfill_order_parties.js first. A sale needs a customer.
 *
 *     node scripts/backfill_order_sales.js --dry    report, change nothing
 *     node scripts/backfill_order_sales.js          do it
 */
require("dotenv").config();
const pool = require("../src/config/db");
const { createSaleFromOrder, hasSaleLink } = require("../src/services/orderSaleService");

const DRY = process.argv.includes("--dry");

// The states that mean the wholesaler took the order on. Deliberately not
// "anything not dead": an order at payment_completed has been paid but not yet
// accepted, and accepting is the moment it becomes a sale.
const ACCEPTED = [
  "supplier_accepted",
  "processing",
  "packed",
  "ready_for_pickup",
  "shipped",
  "in_transit",
  "out_for_delivery",
  "failed_delivery",
  "delivered",
  "completed",
  "return_requested",
  "return_approved",
  "return_rejected",
];

(async () => {
  const client = await pool.connect();
  let written = 0;
  let already = 0;
  let skipped = 0;

  try {
    if (!(await hasSaleLink(client))) {
      console.error(
        "This database has not had the latest migrations run.\n" +
          "  Run this first, from the server folder:\n" +
          "      npm run migrate\n" +
          "  then try this again.",
      );
      process.exitCode = 1;
      return;
    }

    const pending = await client.query(
      `SELECT o.id, o.order_number, o.status, o.total_amount, o.party_id
         FROM orders o
        WHERE o.status = ANY($1)
          AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.order_id = o.id)
        ORDER BY o.created_at ASC`,
      [ACCEPTED],
    );

    console.log(`${pending.rows.length} accepted order(s) with no sale yet.`);
    if (DRY) await client.query("BEGIN");

    for (const order of pending.rows) {
      // An order with no customer cannot become a sale, because a sale is
      // always to somebody. The parties backfill is what fixes this.
      if (!order.party_id) {
        skipped++;
        continue;
      }

      if (!DRY) await client.query("BEGIN");
      try {
        const sale = await createSaleFromOrder(client, order.id);
        if (sale) written++;
        else already++;
        if (!DRY) await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`  order ${order.order_number || order.id}: ${err.message}`);
        skipped++;
        // In a dry run the rollback killed the one wrapping transaction, so
        // the figures after this point would be nonsense.
        if (DRY) throw err;
      }
    }

    if (DRY) await client.query("ROLLBACK");

    console.log(
      `${DRY ? "Would write" : "Wrote"} ${written} sale(s), ` +
        `${already} already there, ${skipped} skipped.`,
    );
    if (skipped > 0) {
      console.log(
        "Skipped orders have no customer yet. Run scripts/backfill_order_parties.js, then this again.",
      );
    }
    if (written > 0) {
      console.log(
        "Balances are unchanged: an order that becomes a sale stops being counted " +
          "on its own, so the same goods are never billed twice.",
      );
    }
    if (DRY) console.log("Dry run: nothing was saved.");
  } finally {
    client.release();
    await pool.end();
  }
})();

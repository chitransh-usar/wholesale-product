/**
 * Put every existing order into its wholesaler's customer book.
 *
 * Orders placed before the book existed have no party. This walks them oldest
 * first and assigns one, using exactly the same matching a new checkout uses,
 * so a buyer who already appears in the diary by phone number lands on that
 * row rather than getting a second one.
 *
 * Safe to run more than once: it only touches orders where party_id is null.
 *
 *     node scripts/backfill_order_parties.js          against DATABASE_URL
 *     node scripts/backfill_order_parties.js --dry    report, change nothing
 */
require("dotenv").config();
const pool = require("../src/config/db");
const { clean, fullName } = require("../src/utils/money");
const { findOrCreateParty, hasPartyLink } = require("../src/services/partyService");

const DRY = process.argv.includes("--dry");

const addressPart = (raw, key) => {
  if (!raw) return null;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return clean(parsed?.[key]);
  } catch {
    return null;
  }
};

(async () => {
  const client = await pool.connect();
  let matched = 0;
  let created = 0;
  let skipped = 0;

  try {
    if (!(await hasPartyLink(client))) {
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
      `SELECT o.id, o.buyer_id, o.supplier_id, o.delivery_address, o.contact_phone,
              u.first_name, u.last_name, u.phone
       FROM orders o
       LEFT JOIN users u ON u.id = o.buyer_id
       WHERE o.party_id IS NULL
       ORDER BY o.created_at ASC`,
    );

    console.log(`${pending.rows.length} order(s) without a customer.`);

    // A dry run does the whole job inside one transaction and throws it away,
    // so the counts it reports are the counts a real run would produce.
    if (DRY) await client.query("BEGIN");

    for (const order of pending.rows) {
      // A self dealing order, or one whose buyer account is gone, has no
      // customer to record. Leaving party_id null is the honest answer.
      if (!order.supplier_id || !order.buyer_id || order.supplier_id === order.buyer_id) {
        skipped++;
        continue;
      }

      // One order at a time, so a single bad row does not undo the whole run.
      // A dry run is one transaction instead, opened once below and rolled
      // back at the end: rolling back per order would forget each customer as
      // soon as it was added and report the same man as new again and again.
      if (!DRY) await client.query("BEGIN");
      try {
        const before = await client.query(
          "SELECT count(*)::int AS n FROM parties WHERE wholesaler_id = $1",
          [order.supplier_id],
        );

        const party = await findOrCreateParty(client, {
          wholesalerId: order.supplier_id,
          userId: order.buyer_id,
          name:
            addressPart(order.delivery_address, "name") ||
            fullName(order.first_name, order.last_name),
          phone:
            addressPart(order.delivery_address, "phone") ||
            clean(order.contact_phone) ||
            clean(order.phone),
          city: addressPart(order.delivery_address, "city"),
          address:
            addressPart(order.delivery_address, "street") ||
            addressPart(order.delivery_address, "address"),
        });

        const after = await client.query(
          "SELECT count(*)::int AS n FROM parties WHERE wholesaler_id = $1",
          [order.supplier_id],
        );
        if (after.rows[0].n > before.rows[0].n) created++;
        else matched++;

        await client.query("UPDATE orders SET party_id = $1 WHERE id = $2", [
          party.id,
          order.id,
        ]);
        if (!DRY) await client.query("COMMIT");
      } catch (err) {
        // In a dry run this aborts the single wrapping transaction, so the
        // run cannot continue truthfully. Stop rather than report figures
        // gathered from a dead transaction.
        await client.query("ROLLBACK");
        console.error(`  order ${order.id}: ${err.message}`);
        skipped++;
        if (DRY) throw err;
      }
    }

    if (DRY) await client.query("ROLLBACK");

    console.log(
      `${DRY ? "Would add" : "Added"} ${created} new customer(s), ` +
        `matched ${matched} to someone already in the book, skipped ${skipped}.`,
    );
    if (DRY) console.log("Dry run: nothing was saved.");
  } finally {
    client.release();
    await pool.end();
  }
})();

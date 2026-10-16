/**
 * Move the rate list into the shop listings, so there is one product list.
 *
 * For every row in a wholesaler's rate list this either fills in an existing
 * listing of the same product, or creates one. It never creates a second
 * listing for something they already sells, and it never overwrites a value they
 * has already set in the shop.
 *
 * Two decisions worth knowing before running it:
 *
 *   New listings are created PRIVATE. A rate list is not a shop window. A
 *   wholesaler who has been keeping private prices would otherwise find their
 *   whole book public the moment this ran, which is the exact leak
 *   supplier_inventory.visibility exists to prevent. They turns on the ones they
 *   wants to sell publicly, product by product.
 *
 *   Nothing is deleted. The items rows stay exactly where they are, so this
 *   can be checked afterwards and reversed by clearing source_item_id.
 *
 * Safe to run more than once: matching is on source_item_id first, and a
 * unique index backs that up.
 *
 *     node scripts/merge_items_into_listings.js --dry    report, change nothing
 *     node scripts/merge_items_into_listings.js          do it
 */
require("dotenv").config();
const pool = require("../src/config/db");
const { clean } = require("../src/utils/money");

const DRY = process.argv.includes("--dry");

// The columns this script writes only exist once the migration has run.
const ready = async (client) => {
  const probe = await client.query(
    `SELECT
       to_regclass('public.items') IS NOT NULL AS has_items,
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='supplier_inventory'
                 AND column_name='source_item_id') AS has_source,
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='items'
                 AND column_name='gst_percent') AS has_item_gst`,
  );
  return probe.rows[0];
};

(async () => {
  const client = await pool.connect();
  let created = 0;
  let filled = 0;
  let already = 0;
  let skipped = 0;

  try {
    const schema = await ready(client);
    if (!schema.has_items) {
      console.log("No rate list on this database. Nothing to move.");
      return;
    }
    if (!schema.has_source) {
      console.error(
        "This database has not had the latest migrations run.\n" +
          "  Run this first, from the server folder:\n" +
          "      npm run migrate\n" +
          "  then try this again.",
      );
      process.exitCode = 1;
      return;
    }

    const gst = schema.has_item_gst ? "i.gst_percent" : "NULL::numeric";
    const items = await client.query(
      `SELECT i.id, i.wholesaler_id, i.name, i.category, i.unit, i.pack_size,
              i.rate, i.moq, i.hsn_code, i.notes, i.status, ${gst} AS gst_percent
       FROM items i
       ORDER BY i.wholesaler_id, i.name`,
    );
    console.log(`${items.rows.length} rate list row(s) to consider.`);

    // A dry run does the whole job in one transaction and throws it away, so
    // the figures it reports are the figures a real run would produce.
    if (DRY) await client.query("BEGIN");

    for (const item of items.rows) {
      if (!DRY) await client.query("BEGIN");
      try {
        // 1. Already moved. The unique index on source_item_id guarantees at
        // most one, so a repeat run lands here and does nothing.
        const done = await client.query(
          "SELECT id FROM supplier_inventory WHERE source_item_id = $1",
          [item.id],
        );
        if (done.rows.length > 0) {
          already++;
          if (!DRY) await client.query("COMMIT");
          continue;
        }

        // 2. They may already sell this product in the shop under the same
        // name. Fill that listing in rather than giving them the same product
        // twice in one list.
        const match = await client.query(
          `SELECT si.id, si.unit, si.pack_size, si.hsn_code, si.gst_percent, si.notes, si.moq
           FROM supplier_inventory si
           JOIN products p ON p.id = si.product_id
           WHERE si.supplier_id = $1
             AND si.source_item_id IS NULL
             AND lower(btrim(p.name)) = lower(btrim($2))
           ORDER BY si.id
           LIMIT 1`,
          [item.wholesaler_id, item.name],
        );

        if (match.rows.length > 0) {
          const listing = match.rows[0];
          // COALESCE in the query, not here: a value the wholesaler has
          // already set in the shop is their current answer and outranks the
          // rate list. This only fills blanks.
          await client.query(
            `UPDATE supplier_inventory SET
               unit        = COALESCE(NULLIF(unit, 'pcs'), $2, unit),
               pack_size   = COALESCE(pack_size, $3),
               hsn_code    = COALESCE(hsn_code, $4),
               gst_percent = COALESCE(gst_percent, $5),
               notes       = COALESCE(notes, $6),
               moq         = COALESCE(moq, $7),
               source_item_id = $8
             WHERE id = $1`,
            [
              listing.id,
              clean(item.unit),
              item.pack_size,
              clean(item.hsn_code),
              item.gst_percent,
              clean(item.notes),
              item.moq,
              item.id,
            ],
          );
          filled++;
        } else {
          // 3. Not in the shop at all. Give it a catalogue entry and a
          // listing, private until they say otherwise.
          const product = await client.query(
            `INSERT INTO products (name, category) VALUES ($1, $2) RETURNING id`,
            [clean(item.name), clean(item.category)],
          );
          await client.query(
            `INSERT INTO supplier_inventory
               (supplier_id, product_id, price, moq, stock, shipping_days,
                status, visibility, unit, pack_size, hsn_code, gst_percent,
                notes, source_item_id)
             VALUES ($1,$2,$3,$4,0,7,$5,'private',$6,$7,$8,$9,$10,$11)`,
            [
              item.wholesaler_id,
              product.rows[0].id,
              item.rate || 0,
              item.moq,
              // An inactive rate list row becomes an inactive listing rather
              // than quietly coming back to life.
              item.status === "inactive" ? "Inactive" : "Active",
              clean(item.unit) || "pcs",
              item.pack_size,
              clean(item.hsn_code),
              item.gst_percent,
              clean(item.notes),
              item.id,
            ],
          );
          created++;
        }

        if (!DRY) await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`  item ${item.id} (${item.name}): ${err.message}`);
        skipped++;
        // In a dry run the rollback killed the single wrapping transaction,
        // so the run cannot continue truthfully.
        if (DRY) throw err;
      }
    }

    if (DRY) await client.query("ROLLBACK");

    console.log(
      `${DRY ? "Would create" : "Created"} ${created} new listing(s), ` +
        `${DRY ? "fill in" : "filled in"} ${filled} existing one(s), ` +
        `${already} already moved, ${skipped} skipped.`,
    );
    if (created > 0) {
      console.log(
        `New listings are private. They appear in the product list, and in ` +
          `the shop only once shown there deliberately.`,
      );
    }
    if (DRY) console.log("Dry run: nothing was saved.");
  } finally {
    client.release();
    await pool.end();
  }
})();

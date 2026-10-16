const pool = require("../config/db");

/**
 * The stock ledger: every physical movement of goods, signed.
 *
 * THE RULE THIS FILE EXISTS TO KEEP. Quantity on hand is the SUM of the rows,
 * never a stored counter. A counter written from six documents is how a figure
 * drifts with nothing to say which write was wrong, and this product already
 * has one of those in supplier_inventory.stock.
 *
 * Those two numbers are different things and this file does not merge them:
 *
 *   supplier_inventory.stock   what he OFFERS on the shop page. The
 *                              marketplace decrements it when an order is
 *                              placed, as a reservation.
 *   the ledger                 his own BOOK stock, from his own documents.
 *
 * WHO WRITES HERE, and who deliberately does not:
 *
 *   sale                  out, for lines that did not come from a challan
 *   purchase              in,  for lines that did not come from a challan
 *   sale challan          out
 *   purchase challan      in
 *   cancelling any of the above    a reversing row, never a delete
 *
 * A sale raised FROM a challan moves nothing, because the goods left when the
 * challan was written. That is the whole reason sale_lines.from_challan_id
 * exists. Tally does the same thing with a Tracking Number. Without it the
 * goods leave twice and both rows look correct on their own.
 *
 * Accepting a shop order writes a sale too, but NOT through saleController:
 * orderSaleService writes its own SQL, so it calls record() itself. This
 * header used to say orders needed no hook because they went "through the
 * ordinary sale path", which was never true, and the result was that every
 * marketplace order moved no stock at all.
 *
 * EVERY WRITE TAKES A CLIENT, never the pool. These rows belong to the same
 * transaction as the document that caused them: a sale that rolls back must
 * not leave its stock movement behind.
 */

/**
 * Only a TRUE answer is cached.
 *
 * Migrations here are pasted by hand into a database the server is already
 * connected to. Caching a false would pin "the table is not there" for the
 * life of the process, so running the migration would appear to do nothing
 * until somebody restarted the server, with no screen saying so. That exact
 * trap was found in challanService on 18 Sept.
 */
let ready = false;
const ledgerExists = async (db = pool) => {
  if (ready) return true;
  try {
    const { rows } = await db.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'stock_ledger'`);
    ready = rows.length > 0;
  } catch {
    return false;
  }
  return ready;
};

/**
 * Does a line table carry product_id and from_challan_id yet?
 *
 * Kept apart from the table probe because the two halves of the migration can
 * land separately in practice: somebody pastes the CREATE TABLE, gets
 * interrupted, and comes back to the ALTERs. Same rule, only a true is cached.
 */
const lineColumnsReady = { sale_lines: false, purchase_lines: false };
const hasLineColumns = async (table, db = pool) => {
  if (lineColumnsReady[table]) return true;
  try {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int n FROM information_schema.columns
        WHERE table_name = $1 AND column_name IN ('product_id', 'from_challan_id')`,
      [table]);
    lineColumnsReady[table] = rows[0].n === 2;
  } catch {
    return false;
  }
  return lineColumnsReady[table];
};

/** Only meaningful in tests, where one process talks to several databases. */
const resetStockLedger = () => {
  ready = false;
  lineColumnsReady.sale_lines = false;
  lineColumnsReady.purchase_lines = false;
};

/**
 * Stamp the product and the challan onto a line that has just been inserted.
 *
 * A separate UPDATE rather than two more columns on the INSERT, because both
 * line inserts already build their column list conditionally from schema
 * probes and threading a fourth optional pair through those positional
 * arguments is how the rate lands in the HSN column. The row id comes back
 * from the insert, so there is nothing to match on and nothing to get wrong.
 */
const stampLine = async (client, table, lineId, line) => {
  if (!lineId) return false;
  if (!(await hasLineColumns(table, client))) return false;
  if (!line.productId && !line.fromChallanId) return false;
  await client.query(
    `UPDATE ${table} SET product_id = $2, from_challan_id = $3 WHERE id = $1`,
    [lineId, line.productId || null, line.fromChallanId || null],
  );
  return true;
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Write one document's movements.
 *
 * `direction` is "in" or "out" and is applied to every line, because a single
 * document never moves goods both ways. A sale return is a credit note, which
 * is its own document with its own direction.
 *
 * Lines with no quantity are skipped rather than written as zero: a zero row
 * is noise in a register somebody is reading to find out what happened.
 *
 * A line with no product is still recorded, under its typed name. Dropping it
 * would make the register quietly short of movements that really happened,
 * which is worse than a row that cannot be attributed to a listing.
 */
const record = async (client, wholesalerId, {
  kind, documentId, documentNumber, movedOn, direction, lines, note = null,
}) => {
  if (!(await ledgerExists(client))) return 0;
  if (direction !== "in" && direction !== "out") {
    throw new Error(`stockLedger: direction must be "in" or "out", got "${direction}"`);
  }
  const sign = direction === "in" ? 1 : -1;

  let written = 0;
  for (const line of lines || []) {
    // Goods that already moved on a challan. The challan wrote the row.
    if (line.fromChallanId) continue;
    const qty = Math.abs(num(line.quantity));
    if (qty === 0) continue;
    const name = String(line.itemName ?? "").trim();
    if (!name) continue;

    await client.query(
      `INSERT INTO stock_ledger
         (wholesaler_id, product_id, item_name, quantity, unit,
          document_kind, document_id, document_number, moved_on, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::date, CURRENT_DATE),$10)`,
      [wholesalerId, line.productId || null, name, sign * qty,
       line.unit || null, kind, documentId || null, documentNumber || null,
       movedOn || null, note],
    );
    written += 1;
  }
  return written;
};

/**
 * Undo a document's movements by writing their opposites.
 *
 * Never a delete. A cancelled sale has to stay visible in the register, the
 * same way this product refuses to erase money. `reverses_id` points at the
 * row being undone so the pair can be read together.
 *
 * Rows that are themselves reversals are skipped, and so are rows already
 * reversed, so calling this twice on the same document is safe. Cancelling is
 * exactly the kind of button somebody presses twice on a slow connection.
 */
const reverse = async (client, wholesalerId, kind, documentId, note = null) => {
  if (!(await ledgerExists(client))) return 0;
  if (!documentId) return 0;

  const { rows } = await client.query(
    `SELECT l.id, l.product_id, l.item_name, l.quantity, l.unit, l.document_number
       FROM stock_ledger l
      WHERE l.wholesaler_id = $1 AND l.document_kind = $2 AND l.document_id = $3
        AND l.reverses_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM stock_ledger r WHERE r.reverses_id = l.id)`,
    [wholesalerId, kind, documentId],
  );

  for (const row of rows) {
    await client.query(
      `INSERT INTO stock_ledger
         (wholesaler_id, product_id, item_name, quantity, unit,
          document_kind, document_id, document_number, reverses_id, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [wholesalerId, row.product_id, row.item_name, -Number(row.quantity),
       row.unit, kind, documentId, row.document_number, row.id, note],
    );
  }
  return rows.length;
};

/**
 * What is on hand, per product, for every product that has ever moved.
 *
 * Joined out to the listing so a caller gets the name he sees on the Products
 * screen rather than whatever was typed on the last document. Lines with no
 * product are grouped under their TYPED NAME, and say so, rather than being
 * added together into one meaningless total.
 *
 * That last sentence described the intent and not the code until 18 Sept: the
 * GROUP BY named only product_id, so every free typed item in the book,
 * however many different things they were, collapsed into a single row whose
 * name was whichever sorted first and whose quantity was all of them added
 * up. Free typed lines are common here, because a wholesaler trading an
 * uncatalogued lot types the name, so this was not a corner case.
 */
const balances = async (wholesalerId, db = pool) => {
  if (!(await ledgerExists(db))) return [];
  const { rows } = await db.query(
    `SELECT l.product_id,
            COALESCE(p.name, MIN(l.item_name)) AS name,
            MIN(l.item_name) AS typed_name,
            COALESCE(SUM(l.quantity), 0) AS on_hand,
            MAX(l.unit) AS unit,
            si.stock AS offered_on_shop,
            COUNT(*)::int AS movements,
            MAX(l.moved_on) AS last_moved
       FROM stock_ledger l
       LEFT JOIN supplier_inventory si ON si.id = l.product_id
       LEFT JOIN products p ON p.id = si.product_id
      WHERE l.wholesaler_id = $1
      GROUP BY l.product_id, p.name, si.stock,
               CASE WHEN l.product_id IS NULL THEN l.item_name END
      ORDER BY COALESCE(p.name, MIN(l.item_name))`,
    [wholesalerId],
  );
  return rows;
};

/**
 * The register for one product: every movement, oldest first, with the running
 * balance beside it. This is the screen a wholesaler opens when the figure
 * looks wrong, so the answer has to be readable line by line rather than a
 * total he has to trust.
 */
const register = async (wholesalerId, productId, { from = null, to = null } = {}, db = pool) => {
  if (!(await ledgerExists(db))) return [];
  const { rows } = await db.query(
    `SELECT id, item_name, quantity, unit, document_kind, document_id,
            document_number, moved_on, reverses_id, note,
            SUM(quantity) OVER (ORDER BY moved_on, created_at, id) AS running
       FROM stock_ledger
      WHERE wholesaler_id = $1
        AND product_id IS NOT DISTINCT FROM $2
        AND ($3::date IS NULL OR moved_on >= $3::date)
        AND ($4::date IS NULL OR moved_on <= $4::date)
      ORDER BY moved_on, created_at, id`,
    [wholesalerId, productId || null, from, to],
  );
  return rows;
};

module.exports = {
  record,
  reverse,
  stampLine,
  hasLineColumns,
  balances,
  register,
  ledgerExists,
  resetStockLedger,
};

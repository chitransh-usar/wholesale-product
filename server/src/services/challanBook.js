const pool = require("../config/db");
const { nextChallanNumber } = require("./seriesNumbers");
const { clean, optionalNumber } = require("../utils/money");
const { checkHsn, minHsnDigits } = require("./hsnService");
const stockLedger = require("./stockLedger");

/**
 * The challan as a document in its own right, in two directions.
 *
 * WHAT THIS REPLACES. The first challan, built 10 Sept, was PAYMENT driven:
 * it was raised because a sale was not fully paid, and it held the tax
 * invoice back until the money came in. That is not what a challan is
 * anywhere else in Indian trade, and it conflated two different documents.
 *
 * In Marg the pair is Sale Challan and Purchase Challan, entered under
 * Transactions and converted into a Sale Bill or Purchase Bill afterwards. In
 * Tally the same pair is Delivery Note and Receipt Note, linked to the
 * invoice by a Tracking Number. In Busy it is Material Issued to Party and
 * Material Received from Party. In all three the challan is MOVEMENT driven:
 * it exists because goods moved, before any bill, and it does not care
 * whether anybody has paid.
 *
 * THE ACCOUNTING RULE THIS FILE EXISTS TO KEEP. A challan NEVER touches the
 * party's balance and carries no GST. The money starts existing when the bill
 * is raised from it. A challan that also moved the ledger would have every
 * sale counted twice in the khata, once when the goods left and again when
 * the bill went out, and the error would be invisible because both entries
 * would look correct on their own.
 *
 * IT DOES MOVE STOCK, since 18 Sept, and that is the only thing besides the
 * document itself that it moves. For most of this file's life the header
 * claimed this and the code did not do it: nothing in the khata moved stock at
 * all. `services/stockLedger.js` is the ledger it writes to now, and the
 * quantity on hand is the SUM of those rows rather than a stored counter.
 *
 * WHICH IS NOT `supplier_inventory.stock`. That column is the marketplace
 * reservation counter, decremented when a shop order is placed, and it is left
 * alone here. The two numbers answer different questions and the screens that
 * show both say which is which.
 *
 * A BILL RAISED FROM A CHALLAN MOVES NOTHING. The goods left when the challan
 * was written, so the sale line carries `from_challan_id` and the ledger skips
 * those lines. Without that the goods leave twice and both rows look correct
 * on their own. Tally ties the two together the same way, with a Tracking
 * Number.
 *
 * HOW A BILL COMES OUT OF ONE, and why it is not done here. The challan is
 * loaded INTO the sale or purchase form, where the wholesaler can adjust it,
 * and the ordinary sale or purchase path prices it. That is what Marg does:
 * modify the challan, press F7, and it loads into the bill screen. Converting
 * server-side would mean a second copy of the GST, cess, channel and
 * transport logic that `saleController` already holds, and two copies of
 * money arithmetic in this codebase is how the khata and the bill start
 * disagreeing. The form posts back the challan ids it used, and `stampBilled`
 * closes them in the same transaction that writes the sale.
 */

/** Goods out to a customer, goods in from a supplier. */
const KINDS = ["sale", "purchase"];

/**
 * Why goods moved without a bill.
 *
 * Written for a person rather than for Rule 55, because the wholesaler
 * picking one is describing what happened, not classifying a statutory
 * movement. `payment_pending` is kept because rows already carry it; it is no
 * longer how a challan comes about.
 */
const REASONS = [
  { code: "bill_to_follow", label: "Bill to follow", forKind: "both",
    hint: "The ordinary case. Goods have gone, the bill comes after." },
  { code: "job_work", label: "Job work", forKind: "both",
    hint: "Sent for processing and coming back. Not a sale." },
  { code: "on_approval", label: "On approval", forKind: "sale",
    hint: "The customer may keep them or send them back." },
  { code: "sample", label: "Sample", forKind: "both",
    hint: "Nothing is being charged for these." },
  { code: "quantity_unknown", label: "Quantity not final", forKind: "both",
    hint: "Weighed or counted at the other end." },
  { code: "branch_transfer", label: "Branch transfer", forKind: "both",
    hint: "Moving your own stock between your own places." },
  { code: "payment_pending", label: "Payment pending", forKind: "both",
    hint: "Kept for challans raised before this screen existed." },
  { code: "other", label: "Something else", forKind: "both", hint: "" },
];

const REASON_CODES = new Set(REASONS.map((r) => r.code));

/**
 * ONLY A TRUE RESULT IS CACHED, and that is the point.
 *
 * Migrations here are run by hand against a live database. Caching a false
 * would mean a wholesaler runs wholesale3_challans_two_kinds.sql, comes back
 * to the screen, and is still told to run the migration until somebody
 * restarts the server. Once it is true it can never become false without a
 * deploy, so the cache still does its job of keeping this off the hot path.
 */
let ready = false;
const tablesExist = async (db = pool) => {
  if (ready) return true;
  try {
    const { rows } = await db.query(
      `SELECT to_regclass('public.delivery_challans') IS NOT NULL AS yes`);
    ready = Boolean(rows[0]?.yes);
  } catch {
    ready = false;
  }
  return ready;
};
const resetTables = () => { ready = false; };

/** Does this database have the two-kind columns yet? Cached, like every probe. */
let twoKinds = false;
const hasTwoKinds = async (db = pool) => {
  // Same rule as above: a false is never cached, so running the migration
  // takes effect without a restart.
  if (twoKinds) return true;
  try {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int n FROM information_schema.columns
        WHERE table_name = 'delivery_challans'
          AND column_name IN ('kind', 'supplier_id', 'purchase_id', 'status')`);
    twoKinds = rows[0].n === 4;
  } catch {
    twoKinds = false;
  }
  return twoKinds;
};
const resetTwoKinds = () => { twoKinds = false; };

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * The lines on a challan, read off a request body.
 *
 * Quantity and rate are both optional in principle, because a challan can go
 * out with the quantity not final, but an item with no name is not a line and
 * is refused rather than written as a blank row somebody has to explain
 * later.
 */
const readLines = async (rawLines) => {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    return { error: "A challan needs at least one item." };
  }
  const minDigits = await minHsnDigits();
  const lines = [];

  for (const [i, raw] of rawLines.entries()) {
    const name = clean(raw.itemName ?? raw.item_name);
    if (!name) return { error: `Line ${i + 1} has no item name.` };

    const hsnRaw = clean(raw.hsnCode ?? raw.hsn_code);
    let hsn = null;
    if (hsnRaw) {
      const checked = checkHsn(hsnRaw, { minDigits });
      if (!checked.ok) return { error: `Line ${i + 1}: ${checked.reason}` };
      hsn = checked.hsn;
    }

    const quantity = optionalNumber(raw.quantity) ?? 1;
    const rate = optionalNumber(raw.rate ?? raw.unitPrice ?? raw.unit_price) ?? 0;
    if (quantity < 0) return { error: `Line ${i + 1} has a negative quantity.` };
    if (rate < 0) return { error: `Line ${i + 1} has a negative rate.` };

    lines.push({
      itemName: name,
      hsnCode: hsn,
      quantity,
      unit: clean(raw.unit),
      rate,
      // The value of the goods. No tax, on purpose: see the header.
      amount: raw.amount !== undefined && raw.amount !== null && raw.amount !== ""
        ? round2(optionalNumber(raw.amount) ?? 0)
        : round2(quantity * rate),
      // What the line WILL be billed at. Carried so the sale form does not
      // have to be retyped, and totalled nowhere on this document.
      gstPercent: optionalNumber(raw.gstPercent ?? raw.gst_percent),
      cessPercent: optionalNumber(raw.cessPercent ?? raw.cess_percent) ?? 0,
      productId: clean(raw.productId ?? raw.product_id),
    });
  }
  return { lines };
};

class ChallanBook {
  /**
   * Record a challan. Goods moved, no bill yet.
   *
   * Nothing here asks whether anybody has paid, which is the whole point of
   * the rewrite.
   */
  async create(wholesalerId, body = {}) {
    if (!(await tablesExist())) return { error: "The challan tables are not set up yet." };
    if (!(await hasTwoKinds())) {
      return { error: "Run wholesale3_challans_two_kinds.sql before recording challans." };
    }

    const kind = KINDS.includes(body.kind) ? body.kind : null;
    if (!kind) return { error: `A challan is for a sale or a purchase, not "${body.kind}".` };

    const reason = clean(body.reason) || "bill_to_follow";
    if (!REASON_CODES.has(reason)) {
      return { error: `"${reason}" is not a reason this knows.` };
    }

    const partyId = kind === "sale" ? clean(body.partyId ?? body.party_id) : null;
    const supplierId = kind === "purchase" ? clean(body.supplierId ?? body.supplier_id) : null;
    if (kind === "sale" && !partyId) return { error: "Choose the customer the goods went to." };
    if (kind === "purchase" && !supplierId) {
      return { error: "Choose the supplier the goods came from." };
    }

    const read = await readLines(body.lines);
    if (read.error) return { error: read.error };

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // The other party, frozen onto the document the way an invoice freezes
      // its recipient. A customer renamed next year must not rename a challan
      // that went out with the goods last year.
      const who = kind === "sale"
        ? (await client.query(
            `SELECT name, business_name, gstin, city, address, phone
               FROM parties WHERE id = $1 AND wholesaler_id = $2`,
            [partyId, wholesalerId])).rows[0]
        : (await client.query(
            `SELECT name, business_name, gstin, city, address, phone
               FROM suppliers WHERE id = $1 AND wholesaler_id = $2`,
            [supplierId, wholesalerId])).rows[0];

      if (!who) {
        await client.query("ROLLBACK");
        return { error: kind === "sale" ? "That customer is not in your book."
                                        : "That supplier is not in your book." };
      }

      const total = round2(read.lines.reduce((sum, l) => sum + l.amount, 0));
      const challanNumber = await nextChallanNumber(client, wholesalerId, kind);

      const created = await client.query(
        `INSERT INTO delivery_challans
           (wholesaler_id, kind, party_id, supplier_id, challan_number,
            supplier_challan_number, reason, reason_note, is_rule_55,
            total_value, amount_paid, status,
            recipient_name, recipient_gstin, recipient_city, recipient_address,
            recipient_phone, issue_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,FALSE,$9,0,'pending',$10,$11,$12,$13,$14,
                 COALESCE($15::date, CURRENT_DATE))
         RETURNING *`,
        [
          wholesalerId, kind, partyId, supplierId, challanNumber,
          clean(body.supplierChallanNumber ?? body.supplier_challan_number),
          reason, clean(body.reasonNote ?? body.reason_note),
          total,
          who.business_name || who.name, who.gstin, who.city, who.address, who.phone,
          clean(body.issueDate ?? body.issue_date),
        ],
      );
      const challan = created.rows[0];

      for (const line of read.lines) {
        await client.query(
          `INSERT INTO delivery_challan_items
             (challan_id, item_name, hsn_code, quantity, unit, unit_price, total,
              gst_percent, cess_percent, product_id)
           VALUES ($1,$2,$3,$4::numeric,$5,$6::numeric,$7::numeric,$8::numeric,
                   COALESCE($9::numeric,0),$10)`,
          [challan.id, line.itemName, line.hsnCode, line.quantity, line.unit,
           line.rate, line.amount, line.gstPercent, line.cessPercent, line.productId],
        );
      }

      // The goods moved, so the stock moved. This is the point the challan
      // exists to record. The bill raised from it later moves nothing, because
      // the sale line carries from_challan_id and the ledger skips those.
      await stockLedger.record(client, wholesalerId, {
        kind: kind === "sale" ? "sale_challan" : "purchase_challan",
        documentId: challan.id,
        documentNumber: challan.challan_number,
        movedOn: challan.issue_date,
        direction: kind === "sale" ? "out" : "in",
        lines: read.lines,
      });

      await client.query("COMMIT");
      return { challan };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Change a challan that has not been billed yet.
   *
   * Once a bill has been raised from it the document is closed: it went out
   * with the goods, a bill now stands on it, and editing it would make the
   * two disagree with nothing to say which is right. The number, the kind and
   * the other party are fixed even while pending, because those are what the
   * document IS.
   */
  async update(challanId, wholesalerId, body = {}) {
    if (!(await hasTwoKinds())) return { error: "Run the challan migration first." };

    const existing = (await pool.query(
      `SELECT id, kind, status, challan_number FROM delivery_challans
        WHERE id = $1 AND wholesaler_id = $2`, [challanId, wholesalerId])).rows[0];
    if (!existing) return { error: "notFound" };
    if (existing.status === "billed") {
      return { error: "This challan has been billed, so it cannot be changed. Change the bill instead." };
    }
    if (existing.status === "cancelled") {
      return { error: "This challan was cancelled." };
    }
    // The document kind the ledger files this under. Taken from the row, not
    // from the body: the kind is what the document IS and cannot be edited.
    const kindOf = existing.kind === "purchase" ? "purchase_challan" : "sale_challan";

    const read = await readLines(body.lines);
    if (read.error) return { error: read.error };

    const reason = clean(body.reason) || "bill_to_follow";
    if (!REASON_CODES.has(reason)) return { error: `"${reason}" is not a reason this knows.` };

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const total = round2(read.lines.reduce((sum, l) => sum + l.amount, 0));

      await client.query(
        `UPDATE delivery_challans
            SET reason = $2, reason_note = $3, total_value = $4::numeric,
                supplier_challan_number = $5,
                issue_date = COALESCE($6::date, issue_date),
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [challanId, reason, clean(body.reasonNote ?? body.reason_note), total,
         clean(body.supplierChallanNumber ?? body.supplier_challan_number),
         clean(body.issueDate ?? body.issue_date)],
      );

      // Replaced wholesale rather than diffed. The lines on a challan are one
      // list, a person editing it is retyping the list, and matching rows up
      // by position is how line three's rate lands on line four.
      await client.query(`DELETE FROM delivery_challan_items WHERE challan_id = $1`, [challanId]);
      for (const line of read.lines) {
        await client.query(
          `INSERT INTO delivery_challan_items
             (challan_id, item_name, hsn_code, quantity, unit, unit_price, total,
              gst_percent, cess_percent, product_id)
           VALUES ($1,$2,$3,$4::numeric,$5,$6::numeric,$7::numeric,$8::numeric,
                   COALESCE($9::numeric,0),$10)`,
          [challanId, line.itemName, line.hsnCode, line.quantity, line.unit,
           line.rate, line.amount, line.gstPercent, line.cessPercent, line.productId],
        );
      }

      // The lines were replaced wholesale, so the movements are too: reverse
      // what this challan moved before, then record what it moves now. Editing
      // 20 metres down to 15 has to give 5 back, and a diff that tried to work
      // out the difference per line would have to solve the same matching
      // problem the line replacement above deliberately refuses to solve.
      await stockLedger.reverse(client, wholesalerId, kindOf, challanId,
        "Challan edited");
      await stockLedger.record(client, wholesalerId, {
        kind: kindOf,
        documentId: challanId,
        documentNumber: existing.challan_number,
        movedOn: clean(body.issueDate ?? body.issue_date),
        direction: existing.kind === "sale" ? "out" : "in",
        lines: read.lines,
      });

      await client.query("COMMIT");
      const fresh = (await pool.query(
        `SELECT * FROM delivery_challans WHERE id = $1`, [challanId])).rows[0];
      return { challan: fresh };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Close a challan that should not have been raised.
   *
   * Cancelled, never deleted. The paper went out of the gate and somebody may
   * still be holding it, so the record of what was sent has to survive being
   * wrong. A billed challan cannot be cancelled: cancel the bill first, or the
   * bill would stand on a document that says it never happened.
   */
  async cancel(challanId, wholesalerId, reason) {
    if (!(await hasTwoKinds())) return { error: "Run the challan migration first." };
    const found = (await pool.query(
      `SELECT status, kind FROM delivery_challans WHERE id = $1 AND wholesaler_id = $2`,
      [challanId, wholesalerId])).rows[0];
    if (!found) return { error: "notFound" };
    if (found.status === "billed") {
      return { error: "A challan that has been billed cannot be cancelled. Deal with the bill first." };
    }
    // The status change and the stock coming back are one act. A cancel that
    // committed the status and then failed on the ledger would leave goods
    // permanently out of the book with no document accounting for them, so
    // this took a transaction the moment it started touching stock.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE delivery_challans
            SET status = 'cancelled', cancelled_reason = $3, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND wholesaler_id = $2`,
        [challanId, wholesalerId, clean(reason)],
      );
      await stockLedger.reverse(
        client, wholesalerId,
        found.kind === "purchase" ? "purchase_challan" : "sale_challan",
        challanId, "Challan cancelled");
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    return { cancelled: true };
  }

  /**
   * What is still waiting to be billed for one customer or supplier.
   *
   * This is the query the sale and purchase forms run the moment somebody
   * picks a party, and the whole reason the feature is useful: a wholesaler
   * who sent goods out three times last week should not have to remember
   * that when he comes to bill them.
   */
  async pendingFor(wholesalerId, kind, otherId) {
    if (!(await hasTwoKinds())) return [];
    if (!KINDS.includes(kind) || !otherId) return [];
    const column = kind === "sale" ? "party_id" : "supplier_id";
    const { rows } = await pool.query(
      `SELECT dc.id, dc.challan_number, dc.issue_date, dc.total_value, dc.reason,
              dc.supplier_challan_number,
              COALESCE(json_agg(json_build_object(
                'itemName', i.item_name, 'hsnCode', i.hsn_code,
                'quantity', i.quantity, 'unit', i.unit, 'rate', i.unit_price,
                'amount', i.total, 'gstPercent', i.gst_percent,
                'cessPercent', i.cess_percent, 'productId', i.product_id
              ) ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL), '[]') AS lines
         FROM delivery_challans dc
         LEFT JOIN delivery_challan_items i ON i.challan_id = dc.id
        WHERE dc.wholesaler_id = $1 AND dc.kind = $2 AND dc.${column} = $3
          AND dc.status = 'pending'
        GROUP BY dc.id
        ORDER BY dc.issue_date ASC, dc.created_at ASC`,
      [wholesalerId, kind, otherId],
    );
    return rows;
  }

  /** One kind's challans, newest first, optionally filtered by status. */
  async list(wholesalerId, kind = "sale", status = null, limit = 200) {
    if (!(await tablesExist())) return [];
    const two = await hasTwoKinds();
    if (!two) {
      // Before the migration there is one undifferentiated list, which is what
      // the product had. Returning it under 'sale' keeps the screen working.
      if (kind !== "sale") return [];
      const { rows } = await pool.query(
        `SELECT dc.id, dc.challan_number, dc.issue_date, dc.total_value,
                dc.amount_paid, dc.invoice_id, dc.recipient_name, s.sale_number
           FROM delivery_challans dc
           LEFT JOIN sales s ON s.id = dc.sale_id
          WHERE dc.wholesaler_id = $1
          ORDER BY dc.created_at DESC LIMIT $2`,
        [wholesalerId, limit],
      );
      return rows;
    }

    const { rows } = await pool.query(
      `SELECT dc.id, dc.kind, dc.challan_number, dc.supplier_challan_number,
              dc.issue_date, dc.total_value, dc.amount_paid, dc.status, dc.reason,
              dc.invoice_id, dc.purchase_id, dc.recipient_name,
              s.sale_number, p.purchase_number, o.order_number
         FROM delivery_challans dc
         LEFT JOIN sales s ON s.id = dc.sale_id
         LEFT JOIN purchases p ON p.id = dc.purchase_id
         LEFT JOIN orders o ON o.id = dc.order_id
        WHERE dc.wholesaler_id = $1 AND dc.kind = $2
          AND ($3::text IS NULL OR dc.status = $3)
        ORDER BY dc.created_at DESC
        LIMIT $4`,
      [wholesalerId, kind, status, limit],
    );
    return rows;
  }

  /**
   * Close the challans a bill was just raised from.
   *
   * Called inside the transaction that writes the sale or the purchase, so a
   * bill and the challans it came from land together or not at all. Scoped by
   * wholesaler and by pending status, so a challan cannot be attached twice
   * and cannot be attached by somebody else.
   *
   * Returns how many were actually closed, which the caller checks: a request
   * naming four challans that closes three has had one taken by another
   * screen in between, and quietly billing three is worse than refusing.
   */
  async stampBilled(client, wholesalerId, kind, challanIds, documentId) {
    if (!Array.isArray(challanIds) || challanIds.length === 0) return 0;
    if (!(await hasTwoKinds(client))) return 0;
    const column = kind === "sale" ? "sale_id" : "purchase_id";
    const done = await client.query(
      `UPDATE delivery_challans
          SET ${column} = $3, status = 'billed', updated_at = CURRENT_TIMESTAMP
        WHERE wholesaler_id = $1 AND id = ANY($2::uuid[])
          AND kind = $4 AND status = 'pending'`,
      [wholesalerId, challanIds, documentId, kind],
    );
    return done.rowCount;
  }
}

module.exports = new ChallanBook();
module.exports.KINDS = KINDS;
module.exports.REASONS = REASONS;
module.exports.tablesExist = tablesExist;
module.exports.hasTwoKinds = hasTwoKinds;
module.exports.resetProbes = () => { resetTables(); resetTwoKinds(); };

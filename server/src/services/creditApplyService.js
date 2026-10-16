const pool = require("../config/db");
const { toPaise, fromPaise } = require("../utils/money");
const { hasSaleLink } = require("./orderSaleService");
const { NOT_OWED_SQL } = require("./khataBalance");
const { receivedOn } = require("./saleSettlement");

/**
 * Setting a customer's credit against something they have ordered.
 *
 * A customer ends up in credit whenever money stays with the wholesaler after
 * the goods stop being owed: an order cancelled after payment, a return
 * completed before the refund goes out, an overpayment. The Overview has
 * always told the wholesaler what to do about it, in these words:
 *
 *     "They paid for something that was cancelled or came back.
 *      Refund it, or set it against their next order."
 *
 * Nothing implemented the second half. The credit could only sit there, and
 * because the khata is one running balance per customer it was netted against
 * whatever was billed next, which made it look spent when it was not:
 *
 *     they return a 2 lakh order, unrefunded   you owe them 2,00,000
 *     they orders 4 lakh and pays half          they owe 0        <- looks square
 *     they pay the other half                  you owe them 2,00,000
 *
 * Every one of those figures is arithmetically right. The trouble is the
 * middle one: they were asked to pay the whole 4 lakh while 2 lakh of their money
 * was already in the till, so the credit was never spent, only hidden, and it
 * came back the moment the bill was settled. A wholesaler reading that says
 * "they owed me nothing, then they paid me, and now I owe them 2 lakh".
 *
 * WHAT THIS DOES, AND WHAT IT REFUSES TO DO
 *
 * It does not invent a payment. Writing a fresh party_payments row for the
 * credited amount would count the same rupees twice: they are already in
 * `received` for this customer, which is the whole reason they are in credit. The
 * balance would swing further into their favour and the problem would double
 * rather than close.
 *
 * What it does is re-address money that is already there. The rows behind the
 * credit are payments no live sale is standing against any more, and they are
 * pointed at the sale the wholesaler chooses. Same rupees, same customer, same
 * total received; only the goods they are set against change. So:
 *
 *   - the customer's balance does not move, which is right, because nothing
 *     has happened between the two of them
 *   - the chosen sale reads as paid, because it now is
 *   - the credit is spent, and cannot come back
 *
 * The order behind the sale is told as well, because every downstream rule
 * reads orders.amount_paid to decide whether goods may go out on a challan and
 * whether the bill may be raised. An order settled from credit is settled: the
 * customer handed the money over, just earlier and for something else.
 */

/** Money is compared in paise. A rupee of float is a paisa lost on a split. */
const EPS = 1;

/**
 * What this customer is owed, in paise, and the payment rows behind it.
 *
 * A payment is "loose" when nothing live is standing against it: its sale was
 * cancelled, or its order was, or it never named either. Those are the rows
 * the credit is made of, and the only ones this will move. A payment sitting
 * against a live sale is doing its job and is left alone.
 */
const looseRows = async (client, partyId, wholesalerId) => {
  const rows = await client.query(
    `SELECT pp.id, pp.amount, pp.paid_on, pp.method
       FROM party_payments pp
       LEFT JOIN sales s ON s.id = pp.sale_id
       LEFT JOIN orders o ON o.id = pp.order_id
      WHERE pp.party_id = $1
        AND pp.wholesaler_id = $2
        AND (pp.sale_id IS NULL OR s.status = 'cancelled')
        -- The same list khataBalance uses for an order that is no longer a
        -- debt, not a fourth opinion about it. A returned order sits at
        -- return_completed, not cancelled, and reading only for "cancelled"
        -- found no credit at all on exactly the case this exists for.
        AND (pp.order_id IS NULL OR o.status IN (${NOT_OWED_SQL}))
      ORDER BY pp.paid_on ASC, pp.created_at ASC`,
    [partyId, wholesalerId],
  );
  return rows.rows;
};

/**
 * How much of this customer's money is the wholesaler holding loose?
 *
 * NOT the balance on their page. That balance is one netted number, billed less
 * received, and netting is what hid the problem in the first place: the moment
 * they ordered again, their 2 lakh of credit was cancelled out by the 2 lakh they
 * now owed and their page read zero. Asking the balance "how much credit does they
 * have" answers "none", while 2 lakh of their money is plainly still in the till.
 *
 * So the credit is measured as what it actually is: the payments no live goods
 * are standing against. Those are real rows with real dates, they add up to
 * real money, and billing them for something else does not make them go away.
 *
 * This can understate and never overstates. Money overpaid against a sale that
 * is still live is credit too, in principle, and is not counted here: it is
 * doing a job against that sale, and taking it away would unsettle a bill that
 * reads as paid. If that case ever needs handling it is a different button.
 */
const creditOf = async (client, partyId, wholesalerId) => {
  const rows = await looseRows(client, partyId, wholesalerId);
  return rows.reduce((sum, row) => sum + toPaise(row.amount), 0);
};

/**
 * What is still owed on one sale, in paise.
 *
 * The received figure comes from services/saleSettlement.js, the one rule, so
 * this cannot drift from what the sale page and the challan rule say.
 */
const outstandingOnSale = async (client, sale) =>
  toPaise(sale.total) - (await receivedOn(client, sale));

class CreditApplyService {
  /**
   * How much credit this customer has, and what it could be set against.
   *
   * Used by the customer page to decide whether to offer the button at all,
   * and to fill the list of things to set it against.
   */
  async offer(partyId, wholesalerId) {
    const client = await pool.connect();
    try {
      const bridge = await hasSaleLink(client);
      const creditPaise = await creditOf(client, partyId, wholesalerId);
      if (creditPaise <= EPS) {
        return { credit: 0, targets: [] };
      }

      const open = await client.query(
        `SELECT s.id, s.sale_number, s.sale_date, s.total, s.status
              ${bridge ? ", s.order_id, o.order_number" : ""}
           FROM sales s
           ${bridge ? "LEFT JOIN orders o ON o.id = s.order_id" : ""}
          WHERE s.party_id = $1 AND s.wholesaler_id = $2
            AND s.status IN ('confirmed', 'delivered')
          ORDER BY s.sale_date ASC, s.created_at ASC`,
        [partyId, wholesalerId],
      );

      const targets = [];
      for (const sale of open.rows) {
        const owed = await outstandingOnSale(client, sale);
        if (owed > EPS) {
          targets.push({
            saleId: sale.id,
            saleNumber: sale.sale_number,
            orderNumber: sale.order_number || null,
            saleDate: sale.sale_date,
            total: Number(fromPaise(toPaise(sale.total))),
            outstanding: Number(fromPaise(owed)),
            canApply: Number(fromPaise(Math.min(owed, creditPaise))),
          });
        }
      }

      return { credit: Number(fromPaise(creditPaise)), targets };
    } finally {
      client.release();
    }
  }

  /**
   * Set some of the credit against one sale.
   *
   * Returns { applied, saleNumber, creditLeft } or { error } with one of:
   *   notFound   the sale is not this wholesaler's, or not this customer's
   *   noCredit   they are not in credit
   *   settled    that sale owes nothing
   *   dead       that sale is cancelled or still a draft
   *   nothing    the two overlap by nothing worth writing down
   */
  async apply(partyId, wholesalerId, saleId, requested = null) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // One customer's money at a time. Two of these running together would
      // both read the same credit and both spend it.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
        [`credit:${partyId}`],
      );

      const bridge = await hasSaleLink(client);
      const found = await client.query(
        `SELECT id, sale_number, total, status${bridge ? ", order_id" : ""}
           FROM sales
          WHERE id = $1 AND wholesaler_id = $2 AND party_id = $3`,
        [saleId, wholesalerId, partyId],
      );
      const sale = found.rows[0];
      if (!sale) {
        await client.query("ROLLBACK");
        return { error: "notFound" };
      }
      if (sale.status === "cancelled" || sale.status === "draft") {
        await client.query("ROLLBACK");
        return { error: "dead" };
      }

      const creditPaise = await creditOf(client, partyId, wholesalerId);
      if (creditPaise <= EPS) {
        await client.query("ROLLBACK");
        return { error: "noCredit" };
      }

      const owedPaise = await outstandingOnSale(client, sale);
      if (owedPaise <= EPS) {
        await client.query("ROLLBACK");
        return { error: "settled" };
      }

      const askedPaise = requested === null ? creditPaise : toPaise(requested);
      const applyPaise = Math.min(creditPaise, owedPaise, Math.max(askedPaise, 0));
      if (applyPaise <= EPS) {
        await client.query("ROLLBACK");
        return { error: "nothing" };
      }

      /**
       * Move the money, row by row, oldest first.
       *
       * A row is re-addressed whole where it fits and split where it does not,
       * because a 2 lakh payment set against a 50,000 bill has to leave 1.5
       * lakh still loose. Splitting writes a second row rather than editing the
       * amount away, so the customer's statement still shows what they actually
       * handed over and when.
       */
      const loose = await looseRows(client, partyId, wholesalerId);
      let left = applyPaise;
      const note = `Set against ${sale.sale_number} from money already held`;

      for (const row of loose) {
        if (left <= 0) break;
        const rowPaise = toPaise(row.amount);
        if (rowPaise <= left) {
          // order_id follows the sale: the order this money is now set
          // against, or NULL when the sale has no order behind it. That is
          // not bookkeeping neatness, it is what stops the money being
          // counted twice. saleSettlement adds up only the khata rows with no
          // order_id, on top of orders.amount_paid, and the bump below puts
          // the applied amount into amount_paid. Leaving these rows order-less
          // made a 4 lakh sale read 6 lakh received.
          await client.query(
            `UPDATE party_payments
                SET sale_id = $2, order_id = $3, note = $4
              WHERE id = $1`,
            [row.id, sale.id, sale.order_id || null, note],
          );
          left -= rowPaise;
        } else {
          await client.query(
            "UPDATE party_payments SET amount = $2 WHERE id = $1",
            [row.id, fromPaise(rowPaise - left)],
          );
          await client.query(
            // The split half, carrying the same order_id as the whole would
            // have, for the same double counting reason.
            `INSERT INTO party_payments
               (wholesaler_id, party_id, sale_id, order_id, amount, method, paid_on, note)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [wholesalerId, partyId, sale.id, sale.order_id || null,
             fromPaise(left), row.method, row.paid_on, note],
          );
          left = 0;
        }
      }

      if (left > EPS) {
        // The credit the sums reported is not backed by rows this can move.
        // Better to change nothing and say so than to half apply it.
        await client.query("ROLLBACK");
        return { error: "nothing" };
      }

      /**
       * Tell the order too.
       *
       * Whether goods may go out on a challan, and whether the bill may be
       * raised, are both decided from orders.amount_paid. An order settled
       * from credit is settled: the customer handed the money over, only
       * earlier and for something else. The timeline entry says where it came
       * from, so nobody reading it later thinks fresh money arrived.
       */
      if (sale.order_id) {
        const bumped = await client.query(
          `UPDATE orders
              SET amount_paid = LEAST(COALESCE(amount_paid, 0) + $2, total_amount),
                  payment_status = CASE
                    WHEN COALESCE(amount_paid, 0) + $2 >= total_amount - 0.01 THEN 'paid'
                    ELSE 'partially_paid' END,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING status, amount_paid, total_amount`,
          [sale.order_id, fromPaise(applyPaise)],
        );
        const order = bumped.rows[0];
        if (order) {
          await client.query(
            `INSERT INTO order_status_history
               (order_id, status, previous_status, updated_by, updated_by_role, remarks)
             VALUES ($1, $2, $2, $3, 'supplier', $4)`,
            [
              sale.order_id,
              order.status,
              wholesalerId,
              `₹${fromPaise(applyPaise)} set against this order from money already held for the customer.`,
            ],
          );
        }
      }

      await client.query("COMMIT");

      return {
        applied: Number(fromPaise(applyPaise)),
        saleNumber: sale.sale_number,
        orderId: sale.order_id || null,
        creditLeft: Number(fromPaise(creditPaise - applyPaise)),
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = new CreditApplyService();

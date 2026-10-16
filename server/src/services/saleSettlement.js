/**
 * How much has actually come in against one sale.
 *
 * One rule, in one place, because three screens were each keeping their own
 * copy of it and no two agreed.
 *
 * THE PROBLEM. A sale written from a shop order has money in two places:
 *
 *   orders.amount_paid    what the buyer paid at checkout
 *   party_payments        rows in the wholesaler's khata
 *
 * and the khata holds two KINDS of row, which is the part that was missed:
 *
 *   a mirror of the shop payment, written by partyService with order_id and
 *   payment_transaction_id set, so the customer's balance is right
 *
 *   money the wholesaler took themselves and typed in, written by recordPayment
 *   with a sale_id and neither of those
 *
 * Adding the khata rows to orders.amount_paid counts the shop payment twice,
 * because the mirror IS that payment. That is the fault this rule was written
 * to avoid, and it was avoided by taking the GREATER of the two instead.
 *
 * But GREATEST has the opposite fault, and it is worse. A wholesaler who takes
 * the second instalment in cash and records it in the khata adds a row that
 * never exceeds orders.amount_paid on its own, so the greater of the two is
 * still the order's figure and the cash is swallowed whole. The sale never
 * settles, the bill is never raised, and the customer's page says they are square
 * while the sale page says they still owes. That is the same complaint a
 * wholesaler made on 11 Sept about the other direction, arriving by the other
 * road.
 *
 * THE RULE. Take the order's figure, and add only the khata rows that did not
 * come from the shop:
 *
 *   received = orders.amount_paid
 *            + SUM(party_payments for this sale that carry no order_id and no
 *              payment_transaction_id)
 *
 * Neither kind is counted twice and neither is dropped. A sale with no order
 * behind it has no orders.amount_paid, so it is simply the sum of its rows.
 *
 * Capped at the sale total by the callers that need a balance, not here: this
 * answers what came in, and a genuine overpayment is a fact worth seeing.
 */

const { toPaise } = require("../utils/money");

/**
 * The khata rows that are NOT a mirror of a shop payment.
 *
 * order_id is what tells them apart. Every mirror is written with it set, by
 * partyService on a live payment and by backfill_order_payments.js on the old
 * ones; a row the wholesaler typed in themselves has a sale_id and no order_id.
 *
 * payment_transaction_id is deliberately NOT part of this test. Setting a
 * customer's credit against a bill re-addresses a mirror row to a different
 * sale and clears its order_id, because it no longer represents that order's
 * payment, but it keeps the transaction id so the trail back to the original
 * money survives. Testing both columns would have read those rows as mirrors
 * for ever and the applied credit would have counted for nothing.
 */
const HAND_ENTERED = `
  pp.sale_id = %SALE%
  AND pp.order_id IS NULL`;

/**
 * SQL for the received figure, for a query that already has `sales s` in
 * scope. `hasOrderId` says whether sales.order_id exists yet, because the
 * bridge migration is run by hand and naming the column before then takes the
 * whole screen down with a 500.
 */
const receivedExpression = ({ hasOrderId, saleRef = "s.id", orderRef = "s.order_id" }) => {
  const hand = `COALESCE((SELECT SUM(pp.amount) FROM party_payments pp
                           WHERE ${HAND_ENTERED.replace("%SALE%", saleRef)}), 0)`;
  if (!hasOrderId) return hand;
  return `(${hand}
           + COALESCE((SELECT o.amount_paid FROM orders o WHERE o.id = ${orderRef}), 0))`;
};

/**
 * The same, for a sale row already loaded. Returns paise.
 *
 * `sale` needs `id`, and `order_id` when it has one.
 */
const receivedOn = async (db, sale) => {
  const hand = await db.query(
    `SELECT COALESCE(SUM(pp.amount), 0) AS n
       FROM party_payments pp
      WHERE ${HAND_ENTERED.replace("%SALE%", "$1")}`,
    [sale.id],
  );
  let received = toPaise(hand.rows[0].n);

  if (sale.order_id) {
    const order = await db.query(
      "SELECT COALESCE(amount_paid, 0) AS n FROM orders WHERE id = $1",
      [sale.order_id],
    );
    received += toPaise(order.rows[0]?.n || 0);
  }
  return received;
};

module.exports = { receivedExpression, receivedOn };

const pool = require("../config/db");

/**
 * How long an order stays open to being undone.
 *
 * Three doors, and they close in order.
 *
 *   1. Cancel. Open until the goods are boxed. Handled by the cancellable
 *      status lists in orderStatusService, because "has it been packed yet" is
 *      a question about status, not about the clock.
 *   2. Return. Open for seven days after delivery. That is this file: the
 *      lifecycle alone cannot answer it, because `delivered` is `delivered`
 *      whether the goods arrived this morning or last February.
 *   3. Nothing. After that the order is closed and stays closed.
 *
 * Before this, door two never shut. An order delivered a year ago could still
 * be sent back, and the wholesaler had no ground to stand on when they said no.
 */

const RETURN_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When the goods actually arrived.
 *
 * orders.actual_delivery_date is the obvious column and nothing has ever
 * written to it, so the history is the only honest record. It is now written
 * as well, going forward, and read first because a date column beats scanning
 * history rows.
 *
 * The earliest `delivered` row wins. An order can be marked delivered, sent
 * back, replaced and delivered again, and the window belongs to the first
 * arrival, not to whichever one is newest.
 */
const deliveredAt = async (orderId, client = pool) => {
  const stamped = await client.query(
    `SELECT actual_delivery_date FROM orders WHERE id = $1`,
    [orderId],
  );
  if (stamped.rows[0]?.actual_delivery_date) {
    return new Date(stamped.rows[0].actual_delivery_date);
  }

  const history = await client.query(
    `SELECT MIN(created_at) AS at
       FROM order_status_history
      WHERE order_id = $1 AND status = 'delivered'`,
    [orderId],
  );
  return history.rows[0]?.at ? new Date(history.rows[0].at) : null;
};

/**
 * Is the return door still open, and how long for.
 *
 * An order whose delivery date cannot be established is treated as open, and
 * says so. Orders placed before delivery was recorded have no date to read,
 * and refusing those would lock a buyer out of a return they are entitled to on
 * the strength of a gap in our own records. The wholesaler still decides;
 * this only decides whether they are asked.
 */
const returnWindow = (deliveredOn, now = new Date()) => {
  if (!deliveredOn) {
    return {
      open: true,
      knownDelivery: false,
      closesAt: null,
      daysLeft: null,
      reason: "We have no delivery date for this order, so the return is open.",
    };
  }

  const closesAt = new Date(deliveredOn.getTime() + RETURN_WINDOW_DAYS * DAY_MS);
  const msLeft = closesAt.getTime() - now.getTime();
  const open = msLeft > 0;

  return {
    open,
    knownDelivery: true,
    closesAt,
    // Rounded up, so the last part day still reads as "1 day left" rather
    // than "0 days left" on a door that is genuinely still open.
    daysLeft: open ? Math.ceil(msLeft / DAY_MS) : 0,
    reason: open
      ? `Goods can be sent back within ${RETURN_WINDOW_DAYS} days of delivery.`
      : `This order was delivered more than ${RETURN_WINDOW_DAYS} days ago, so it can no longer be sent back.`,
  };
};

const returnWindowForOrder = async (orderId, client = pool) =>
  returnWindow(await deliveredAt(orderId, client));

module.exports = {
  RETURN_WINDOW_DAYS,
  deliveredAt,
  returnWindow,
  returnWindowForOrder,
};

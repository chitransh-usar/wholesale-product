/**
 * Server side feature flags. The mirror of client/src/config/features.js.
 */
const FEATURES = {
  /**
   * Whether stock counts are believed.
   *
   * Off for now, by decision: stock comes off the screens until it is
   * properly implemented, because a hand written sale does not decrement it
   * and a count nobody maintains is worse than no count.
   *
   * What "off" changes, and what it deliberately does not:
   *
   *   - An order is NOT refused for insufficient stock. With the number
   *     hidden, a buyer told "only 3 left" cannot act on it, and a listing
   *     created since stock was hidden has a count of zero, so every one of
   *     them would be unorderable.
   *   - Orders DO still decrement, but the subtraction is floored at zero
   *     rather than refused, because supplier_inventory.stock carries a
   *     CHECK (stock >= 0) and every listing created since stock was hidden
   *     starts at zero. Without the floor, ordering any recent listing
   *     failed outright.
   *   - Cancelling does NOT credit stock back while this is off. The floor
   *     means a listing at zero gave nothing up, so adding the quantity back
   *     would invent stock. Turn this on and cancelling credits back again,
   *     because checkout then takes the full quantity or refuses.
   */
  STOCK_TRACKING: false,
};

module.exports = { FEATURES };

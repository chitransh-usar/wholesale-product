/**
 * Feature flags.
 *
 * The marketplace was switched off while the sales book was built, on the
 * understanding that it would come back. It is back on now: the two halves
 * are being merged, and a wholesaler gets both a shop their retailers can order
 * from and a book to manage what they sell.
 *
 * The flag stays rather than being deleted, because it is still the switch
 * for a wholesaler who does not want a public shop at all, and because
 * turning the browsing surface off is how the B2C phase will be staged.
 *
 * What the flag does NOT control any more: the seller dashboard. That is the
 * 3.0 one in both states. The marketplace-era dashboard is gone.
 */
export const FEATURES = {
  // Browsing, search, cross seller comparison, cart, checkout, wishlist.
  MARKETPLACE: true,

  // The wholesaler's customer book, sales records and khata. The new trunk.
  SALES_MANAGEMENT: true,

  /**
   * Whether a buyer can ask to send goods back from their own orders page.
   *
   * Off by deliberate choice, not because it is unfinished. The whole round
   * trip is built and tested: the buyer asks with a reason, the wholesaler
   * accepts or refuses, and completing it cancels the sale and raises a
   * credit note so the customer stops owing for goods that came back.
   *
   * What is off is only the buyer's way in. The seller side stays visible,
   * because an order can still reach return_requested another way and a
   * wholesaler who cannot answer one would be stuck.
   *
   * The endpoint stays live, so turning this on is the only change needed.
   */
  BUYER_RETURNS: false,

  /**
   * Flash sales and coupons on the seller dashboard.
   *
   * Switched off 10 Sept at the wholesaler's request, not deleted. The screen,
   * its route and its controller all stay compiled, so turning this back on is
   * the only change needed and the code cannot quietly rot in the meantime.
   *
   * It was never usable anyway: creating a flash sale is admin only and there
   * is no admin console, so the page could show a wholesaler what was running
   * and offer them nothing to do about it.
   */
  PROMOTIONS: false,

  // Wholesaler only, and intended to sit behind a subscription plan later.
  // Off until there is real data to report on, because an analytics screen
  // with nothing in it teaches a wholesaler the product is empty.
  ANALYTICS: false,
};

export default FEATURES;

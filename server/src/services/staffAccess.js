/**
 * Who is acting, and whose book they are acting on.
 *
 * A wholesaler does not sit at the counter all day. Their nephew takes orders,
 * their munim writes the sales and their driver marks deliveries, and until now
 * every one of them had to use the owner's own login. That is not a small
 * inconvenience: nothing in the history could say who did what, and the owner
 * could not take the login back from somebody who had left.
 *
 * Two ideas, kept apart on purpose.
 *
 *   the person    who is signed in. Owns the history entries, receives the
 *                 notifications, is the name against a dispatch.
 *   the business  whose customers, sales, stock and money are being worked on.
 *
 * For an owner these are the same id, which is why the difference was never
 * visible and why `req.user.id` was used for both. For an employee they are
 * different, and every query that means "the business" and reads the person
 * instead will either show them an empty book or, worse, somebody else's.
 */

/**
 * What an employee can be allowed to do.
 *
 * Named for the job rather than the screen, because permissions outlive
 * layouts. The labels are what the owner reads on the staff page, so they are
 * plain: a man deciding what their nephew may touch should not have to work out
 * what "manage inventory entities" means.
 */
const PERMISSIONS = [
  {
    key: "orders",
    label: "Handle orders",
    detail: "Accept, pack, send out and refuse orders from the shop.",
  },
  {
    key: "sales",
    label: "Write sales in the book",
    detail: "Record what was sold across the counter, and edit it.",
  },
  {
    key: "customers",
    label: "Add and change customers",
    detail: "Add a new customer, correct a phone number or an address.",
  },
  {
    key: "purchases",
    label: "Keep the purchase book",
    detail:
      "Enter bills from suppliers, add a supplier, and record money paid out to one. Turn this off for somebody who should not see what stock costs you.",
  },
  {
    key: "products",
    label: "Add and change products",
    detail: "List new stock and change prices.",
  },
  {
    key: "payments",
    label: "Record money received",
    detail: "Write down a payment a customer has made.",
  },
  {
    key: "refunds",
    label: "Give money back",
    detail:
      "Record a refund or raise a credit note. Kept separate from taking money because this is money leaving.",
  },
  {
    key: "invoices",
    label: "Raise and send bills",
    detail: "Make a GST invoice and send it to the customer.",
  },
  {
    key: "money",
    label: "See the money figures",
    detail:
      "The totals on the home screen, who owes what, and the statements. Turn this off for somebody who should pack orders without seeing the books.",
  },
];

const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

/**
 * What a new employee starts with.
 *
 * Everything. The rule agreed was that staff may do everything except change
 * the business settings and the GST details, and those are not on the list at
 * all. Starting generous and taking away is also the safer default of the two:
 * an owner who forgets to grant something finds out when their man cannot work,
 * which is annoying. An owner who forgets to revoke something finds out
 * differently.
 *
 * This applies to a permission ADDED LATER too. An employee taken on before
 * "purchases" existed has a stored list that does not contain it, so they cannot
 * open the purchase book until the owner ticks it. Backfilling every existing
 * employee into a new permission would be the other kind of mistake, and this
 * one in particular shows a man what their stock costs.
 */
const DEFAULT_PERMISSIONS = [...PERMISSION_KEYS];

/**
 * What nobody but the owner may ever do, whatever is ticked.
 *
 * Not a permission, because it is not grantable. Business settings carry the
 * GSTIN that goes on every invoice and the UPI id that money is paid into, and
 * staff management is on the list for the obvious reason: an employee who
 * could edit permissions could give themselves the rest of them.
 */
const OWNER_ONLY = ["settings", "staff", "gst", "upi"];

const validPermissions = (raw) => {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  for (const value of raw) {
    const key = String(value || "").trim().toLowerCase();
    if (PERMISSION_KEYS.includes(key)) seen.add(key);
  }
  // Ordered by the catalogue rather than by however they arrived, so two
  // equivalent sets compare and read the same.
  return PERMISSION_KEYS.filter((key) => seen.has(key));
};

/**
 * Does this request carry the right to do `permission`?
 *
 * An owner always may. An employee may when it is ticked. Anyone else, which
 * is to say a buyer who has wandered onto a seller route, never may.
 */
const can = (business, permission) => {
  if (!business) return false;
  if (business.isOwner) return true;
  return Array.isArray(business.permissions) && business.permissions.includes(permission);
};

module.exports = {
  PERMISSIONS,
  PERMISSION_KEYS,
  DEFAULT_PERMISSIONS,
  OWNER_ONLY,
  validPermissions,
  can,
};

/**
 * Single source of truth for how order statuses are labelled and coloured.
 *
 * The backend stores the lifecycle values from orderStatusService
 * ("payment_pending", "shipped", ...). The dashboard pages used to compare
 * against capitalised names like "Delivered", so badges always fell through to
 * the default style and the Orders tabs matched nothing. Both pages now share
 * these helpers so they cannot drift apart again.
 */

const LABELS = {
  pending: "Pending",
  payment_pending: "Payment Pending",
  partially_paid: "Partially Paid",
  partial: "Partially Paid",
  payment_completed: "Payment Received",
  payment_failed: "Payment Failed",
  supplier_accepted: "Accepted",
  processing: "Processing",
  packed: "Packed",
  ready_for_pickup: "Ready for Pickup",
  shipped: "Shipped",
  in_transit: "In Transit",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  failed_delivery: "Delivery Failed",
  completed: "Completed",
  return_requested: "Return Requested",
  return_approved: "Return Approved",
  return_rejected: "Return Rejected",
  return_completed: "Return Completed",
  replacement_requested: "Replacement Requested",
  replacement_issued: "Replacement Issued",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

// Groups drive both the badge colour and the Orders page tabs.
const GROUPS = {
  awaiting: [
    "pending",
    "payment_pending",
    "partially_paid",
    "partial",
    "payment_completed",
    "supplier_accepted",
  ],
  processing: ["processing", "packed", "ready_for_pickup"],
  shipped: ["shipped", "in_transit", "out_for_delivery"],
  delivered: ["delivered", "completed"],
  // A return in progress is live work, not a dead order, so it does not
  // belong under Cancelled where it used to sit unread. Rejected and
  // completed returns are finished and stay there.
  returns: ["return_requested", "return_approved", "replacement_requested", "replacement_issued"],
  cancelled: [
    "cancelled",
    "payment_failed",
    "failed_delivery",
    "refunded",
    "return_rejected",
    "return_completed",
  ],
};

// Per-status overrides where the group colour would be misleading - a
// received payment is a success and should read green, not "still pending".
const STATUS_STYLES = {
  partially_paid: "bg-amber-100 text-amber-800 border-amber-300 font-bold",
  partial: "bg-amber-100 text-amber-800 border-amber-300 font-bold",
  payment_completed: "bg-emerald-100 text-emerald-700 border-emerald-200",
  supplier_accepted: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

const GROUP_STYLES = {
  awaiting: "bg-amber-100 text-amber-700 border-amber-200",
  processing: "bg-indigo-100 text-indigo-700 border-indigo-200",
  shipped: "bg-blue-100 text-blue-700 border-blue-200",
  delivered: "bg-emerald-100 text-emerald-700 border-emerald-200",
  returns: "bg-orange-100 text-orange-700 border-orange-200",
  cancelled: "bg-rose-100 text-rose-700 border-rose-200",
};

const normalize = (status) => String(status || "").trim().toLowerCase();

export const getOrderStatusGroup = (status) => {
  const value = normalize(status);
  return (
    Object.keys(GROUPS).find((group) => GROUPS[group].includes(value)) || null
  );
};

/** Human-readable label, tolerant of unknown values. */
export const formatOrderStatus = (status) => {
  const value = normalize(status);
  if (!value) return "Unknown";
  if (LABELS[value]) return LABELS[value];
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

/** Tailwind classes for a status badge. */
export const getOrderStatusStyle = (status) => {
  const value = normalize(status);
  if (STATUS_STYLES[value]) return STATUS_STYLES[value];
  const group = getOrderStatusGroup(value);
  return GROUP_STYLES[group] || "bg-slate-100 text-slate-700 border-slate-200";
};

/** Tabs for the Orders page, in lifecycle order. */
export const ORDER_TABS = [
  { label: "All Orders", group: null },
  { label: "Awaiting", group: "awaiting" },
  { label: "Processing", group: "processing" },
  { label: "Shipped", group: "shipped" },
  { label: "Delivered", group: "delivered" },
  { label: "Returns", group: "returns" },
  { label: "Cancelled", group: "cancelled" },
];

/** Whether an order belongs under the given tab label. */
export const matchesOrderTab = (status, tabLabel) => {
  const tab = ORDER_TABS.find((t) => t.label === tabLabel);
  if (!tab || !tab.group) return true;
  return getOrderStatusGroup(status) === tab.group;
};

/**
 * The one thing the wholesaler does next to this order.
 *
 * The lifecycle has 22 states and orderStatusService is the authority on what
 * may follow what. Showing a wholesaler 22 buttons would be useless, so this
 * names the single next step of the ordinary path: they took the money, they
 * accepts, they pack, they send it, it arrives.
 *
 * Every `to` here has to be a move orderStatusService already allows. The
 * server validates it again and refuses anything else, so this list can only
 * ever offer less than the lifecycle, never more.
 *
 * Labels are what a trader would say out loud. "Ready for pickup" is what the
 * database calls it; "Ready to send" is what they call it.
 */
const NEXT_STEP = {
  // An order sitting at pending with no step offered is an order nobody can
  // move. Orders taken by hand are written in as accepted now, so this is
  // mostly for ones created before that, but it is a real move either way:
  // taking on an order before the money is ordinary credit trade.
  pending: { to: "supplier_accepted", label: "Accept order" },
  payment_completed: { to: "supplier_accepted", label: "Accept order" },
  supplier_accepted: { to: "processing", label: "Start packing" },
  processing: { to: "packed", label: "Mark packed" },
  packed: { to: "ready_for_pickup", label: "Ready to send" },
  // The dispatch step. The screen asks for driver details here rather than
  // moving straight on, because this is the moment the goods leave the godown
  // and the buyer starts asking where they are.
  ready_for_pickup: { to: "shipped", label: "Send out", dispatch: true },
  shipped: { to: "in_transit", label: "On the way" },
  in_transit: { to: "out_for_delivery", label: "Out for delivery" },
  out_for_delivery: { to: "delivered", label: "Mark delivered" },
  delivered: { to: "completed", label: "Close this order" },
  // A return the buyer has asked for. Two answers rather than one next step,
  // so the Orders page offers a pair of buttons here instead of the usual
  // single one: see RETURN_ANSWERS below.
  return_approved: { to: "return_completed", label: "Goods came back" },
};

/**
 * A return the buyer has asked for, and the two answers to it.
 *
 * Kept apart from NEXT_STEP because this is the one point in the lifecycle
 * with a genuine choice rather than a next step. Everywhere else the
 * wholesaler is moving an order along; here they are deciding.
 *
 * Rejecting is not a dead end for the money: partyController leaves a
 * rejected return owed on purpose, because the customer still has the goods.
 */
export const RETURN_ANSWERS = [
  { to: "return_approved", label: "Accept return", tone: "primary" },
  { to: "return_rejected", label: "Refuse return", tone: "quiet" },
];

/** Whether this order is waiting on the wholesaler to answer a return. */
export const isReturnRequested = (status) => normalize(status) === "return_requested";

/**
 * Whether the buyer can ask to send this order back.
 *
 * Two doors, and both have to be open. The lifecycle says the goods have
 * arrived; the clock says they arrived recently enough. The server checks
 * both again and is the authority.
 *
 * `deliveredOn` missing means open, matching the server: an order with no
 * delivery date on record is one of ours from before the date was written
 * down, and locking a buyer out on the strength of a gap in our own records
 * would be the wrong way round.
 */
export const canRequestReturn = (status, deliveredOn = undefined) => {
  if (!["delivered", "completed"].includes(normalize(status))) return false;
  return returnDaysLeft(deliveredOn) !== 0;
};

/**
 * Days left to send goods back, or null when there is no delivery date and
 * so no countdown to show. Never returns 0 while the door is still open, so
 * a screen can treat 0 as closed.
 */
export const returnDaysLeft = (deliveredOn) => {
  if (!deliveredOn) return null;
  const at = new Date(deliveredOn);
  if (Number.isNaN(at.getTime())) return null;
  const closesAt = at.getTime() + RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const msLeft = closesAt - Date.now();
  return msLeft > 0 ? Math.ceil(msLeft / (24 * 60 * 60 * 1000)) : 0;
};

/**
 * What to offer on this order, or null when there is nothing to do.
 *
 * Null covers both ends: an order still waiting for the buyer to pay is their
 * move, not the wholesaler's, and a cancelled or refunded one is finished.
 */
export const getNextStep = (status) => NEXT_STEP[normalize(status)] || null;

/**
 * Orders that need the wholesaler to do something, newest first.
 *
 * This is the count worth putting in front of them: not how many orders exist,
 * but how many are waiting on them.
 */
export const needsAction = (status) =>
  Boolean(getNextStep(status)) || isReturnRequested(status);

/**
 * Whether this order is far enough along to hand to a driver.
 *
 * A tracking link on an order still at "payment received" is wrong twice
 * over: nothing has been packed so there is nothing to follow, and the link is
 * a working key that lets whoever holds it report a phone as the vehicle. It
 * also expires on a timer, so one made days early is dead by the time the
 * goods move.
 *
 * The server enforces this and refuses anything else. This copy exists so the
 * screen can explain rather than let them press a button and be told no.
 */
const DISPATCHABLE = [
  "packed",
  "ready_for_pickup",
  "shipped",
  "in_transit",
  "out_for_delivery",
  // A second attempt after a failed delivery needs a fresh link.
  "failed_delivery",
];

export const canSendOut = (status) => DISPATCHABLE.includes(normalize(status));

/**
 * Whether the wholesaler can still refuse this order.
 *
 * The mirror of SUPPLIER_CANCELLABLE_STATUSES on the server, which is the
 * authority and checks again. The line is drawn at packed: once the goods are
 * boxed and a driver may already have them, the way out is a return, not a
 * cancellation.
 *
 * payment_pending is on the list deliberately. That is where a brand new
 * order sits, and refusing one they have only just received is the commonest
 * case there is: the colour is finished, the lot is sold, the buyer is too
 * far to deliver to.
 */
const REFUSABLE = [
  "pending",
  "payment_pending",
  "payment_completed",
  "supplier_accepted",
  "processing",
  // Not a late refusal. The goods went out and came straight back, so there
  // is nothing for the buyer to return and this is the only way to close it.
  "failed_delivery",
];

export const canRefuse = (status) => REFUSABLE.includes(normalize(status));

/**
 * Whether the wholesaler still owes this customer their money back.
 *
 * The last step of a return, and the one nothing ever called. Until it is
 * done the goods are back on the shelf and the customer's money is still in
 * the till, which the Overview correctly reports as owed back to them.
 */
export const canRefund = (status) => normalize(status) === "return_completed";

/**
 * How long goods can be sent back after they arrive.
 *
 * The server counts this from the delivery date and is the authority. The
 * number is here so a screen can say "3 days left" instead of leaving a
 * buyer to find out by being refused.
 */
export const RETURN_WINDOW_DAYS = 7;

/**
 * Whether the buyer can still call their own order off.
 *
 * Shorter than the wholesaler's list on purpose: once they have accepted it and
 * started packing, the buyer walking away is the seller's loss, so from there
 * it is a conversation rather than a button.
 */
const BUYER_CANCELLABLE = [
  "pending",
  "payment_pending",
  "payment_completed",
  "supplier_accepted",
];

export const canBuyerCancel = (status) => BUYER_CANCELLABLE.includes(normalize(status));

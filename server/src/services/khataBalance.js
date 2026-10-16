/**
 * What a customer owes, defined once.
 *
 * This used to live in partyController alone, and overviewController answered
 * the same question its own way. The two disagreed, and not harmlessly: the
 * Overview billed from sales but subtracted every payment including the ones
 * taken through the shop, so a wholesaler whose customers had paid through
 * the marketplace was shown a NEGATIVE amount still to collect. The money was
 * taken off the total and the debt behind it was never added on.
 *
 * So the rule lives here now and both screens read it. If a third screen ever
 * needs a balance, it reads it from here too.
 *
 * The rule itself:
 *
 *   billed   confirmed and delivered sales,
 *            plus marketplace orders that are genuinely owed and have not
 *            yet produced a sale of their own
 *   less     every payment in party_payments, whichever way it came in
 *
 * An accepted order writes itself a sale, and from that moment the sale is
 * the commercial record. Counting both would bill the same goods twice, so an
 * order that has produced a sale is skipped on the orders side.
 */

/**
 * The order statuses that do NOT mean money is owed.
 *
 * An order is a request before it is a debt. A basket abandoned at the payment
 * screen must not appear in a customer's khata, and neither must one that was
 * cancelled, refunded, or whose goods have come back.
 *
 * return_rejected is deliberately absent: the wholesaler refused the return,
 * so the customer still has the goods and still owes for them.
 *
 * Kept as a list of what is NOT owed rather than what is, because a status
 * added later is far more likely to be another step of a live order than
 * another way for one to die, and the safer default is to count it.
 */
const ORDER_NOT_OWED = [
  "pending",
  "payment_pending",
  "payment_failed",
  "cancelled",
  "refunded",
  "return_completed",
];

const NOT_OWED_SQL = ORDER_NOT_OWED.map((s) => `'${s}'`).join(", ");

// A sale counts as a debt once it is confirmed. Drafts are not debts and
// cancelled sales are not either.
const BILLED_SALE_STATUSES = "('confirmed', 'delivered')";

/**
 * sales.order_id only exists once the bridge migration has run, and
 * orders.party_id only once the customer book migration has. Naming either
 * before then takes a whole screen down with a 500, which is how this has
 * broken more than once. Callers pass what the schema actually has.
 */
const bridgedGuard = (hasBridge) =>
  hasBridge
    ? "AND NOT EXISTS (SELECT 1 FROM sales s2 WHERE s2.order_id = o.id)"
    : "";

/**
 * Money handed back to the customer.
 *
 * A refund is a payment in reverse, and party_payments cannot hold one: the
 * table has a CHECK that every amount is greater than zero, which is right,
 * because a receipt for minus two thousand rupees is not a receipt.
 *
 * So it is added back here instead. Follow one order through: the customer
 * pays 2,000, which lands in party_payments and is subtracted. The goods come
 * back, the order reaches return_completed, and it stops counting as owed, so
 * customer balance is now minus 2,000 and the Overview correctly reports 2,000 of
 * their money sitting in the till. The wholesaler hands it back, and this term
 * adds the 2,000 on again, which cancels the payment exactly and returns them
 * to zero.
 *
 * Only refunds actually paid out count. refund_status is written at the moment
 * the money leaves, and refund_amount is capped at what was received, so this
 * can never add back more than was taken.
 */
const REFUNDED_BACK_SQL = `
    SELECT SUM(o.refund_amount) FROM orders o
     WHERE o.party_id = %REF% AND o.refund_status = 'processed'
       AND o.refund_amount IS NOT NULL`;

const refundedBack = (partyRef) => REFUNDED_BACK_SQL.replace("%REF%", partyRef);

/**
 * The balance for one party, as a SQL expression.
 *
 * `partyRef` is how the surrounding query names the party's id column, so the
 * same fragment works whether the caller wrote `pt` or `p`.
 */
/**
 * What was already owed before this product.
 *
 * A wholesaler who has traded for twenty years does not start with an empty
 * khata, and until this column existed their only ways to say so were entering a
 * fake sale, which puts goods in their books they never sold and tax on a bill they
 * never raised, or not using the product. Taken from Busy's Account master,
 * which carries Op. Bal on every party.
 *
 * Signed rather than a Dr/Cr flag: positive means they owed you. See the
 * migration for why one column beats a number and a flag.
 *
 * Guarded, because the column arrives with wholesale3_opening_balance.sql and
 * naming it before that has been run takes down the customer list, the
 * overview and every statement at once. Zero is the honest answer meanwhile,
 * and it is what every one of those screens showed before.
 */
// TRAILING plus, not leading. It is the first term in the expression, so a
// leading one produced "+ X  Y" and every balance query died on a syntax error.
const openingTerm = (hasOpening, ref) =>
  hasOpening
    ? `COALESCE((SELECT p2.opening_balance FROM parties p2 WHERE p2.id = ${ref}), 0) +`
    : "";

/**
 * CREDIT NOTES COME OFF, and until 18 Sept they did not.
 *
 * A credit note is raised when goods come back, a rate is cut, or a sale is
 * cancelled after billing. It is the instrument that reverses a bill. Nothing
 * here subtracted it, so a customer who returned fifty thousand rupees of
 * cloth went on showing as owing that fifty thousand, on his page, on the
 * dashboard total, and on the statement the wholesaler sent him asking to be
 * paid. The note existed, had its own number and its own PDF, and changed no
 * figure anywhere.
 *
 * ONLY WHERE THE BILL IT REVERSES IS STILL STANDING. A cancelled sale has
 * already left the billed sum above, so subtracting its note as well takes
 * the same money off twice. flow_check caught exactly that.
 */
const balanceExpression = ({ hasOrderParty, hasBridge, hasOpening = false, partyRef = "pt.id" }) => `
  ${openingTerm(hasOpening, partyRef)}
  COALESCE((
    SELECT SUM(s.total) FROM sales s
     WHERE s.party_id = ${partyRef} AND s.status IN ${BILLED_SALE_STATUSES}
  ), 0)
  ${
    hasOrderParty
      ? `+ COALESCE((
    SELECT SUM(o.total_amount) FROM orders o
     WHERE o.party_id = ${partyRef} AND o.status NOT IN (${NOT_OWED_SQL})
       ${bridgedGuard(hasBridge)}
  ), 0)`
      : ""
  }
  -
  COALESCE((
    SELECT SUM(pp.amount) FROM party_payments pp WHERE pp.party_id = ${partyRef}
  ), 0)
  -
  COALESCE((
    SELECT SUM(cn.grand_total) FROM credit_notes cn
     WHERE cn.party_id = ${partyRef}
       AND (cn.sale_id IS NULL
            OR EXISTS (SELECT 1 FROM sales s2
                        WHERE s2.id = cn.sale_id
                          AND s2.status IN ${BILLED_SALE_STATUSES}))
  ), 0)
  ${hasOrderParty ? `+ COALESCE((${refundedBack(partyRef)}), 0)` : ""}
`;

/**
 * What is billed and what has come in, over a window, for the Overview.
 *
 * These two are plain sums and cannot go wrong on their own. It is the
 * difference between them that used to be reported as "still to collect", and
 * that is the thing that could go negative. See collectionTotals below.
 */
const totalsExpression = ({ hasOrderParty, hasBridge, since = null }) => {
  const salesWindow = since ? `AND s.sale_date >= ${since}` : "";
  const ordersWindow = since ? `AND o.created_at >= ${since}` : "";
  const paymentsWindow = since ? `AND pp.paid_on >= ${since}` : "";

  return {
    billed: `
      COALESCE((SELECT SUM(s.total) FROM sales s
         WHERE s.wholesaler_id = $1
           AND s.status IN ${BILLED_SALE_STATUSES} ${salesWindow}), 0)
      ${
        hasOrderParty
          ? `+ COALESCE((SELECT SUM(o.total_amount) FROM orders o
         WHERE o.supplier_id = $1
           AND o.party_id IS NOT NULL
           AND o.status NOT IN (${NOT_OWED_SQL})
           ${bridgedGuard(hasBridge)} ${ordersWindow}), 0)`
          : ""
      }`,
    received: `
      COALESCE((SELECT SUM(pp.amount) FROM party_payments pp
         WHERE pp.wholesaler_id = $1 ${paymentsWindow}), 0)`,
  };
};

/**
 * How much is actually still to collect, and how much is owed back.
 *
 * Everything before this asked one subtraction of the whole business: total
 * billed, less total received. That is the wrong sum, and it is wrong in a way
 * that shows a large minus sign on a card headed "still to collect".
 *
 * Two customers make the point. Ramesh owes 5,000. Suresh paid for an order
 * that was later cancelled and is 2,000 in credit. The old figure said 3,000,
 * which is not a real quantity: there is no 3,000 to go and collect, and
 * nobody is going to hand Ramesh's debt to Suresh. What is true is that 5,000
 * is out there to collect, and 2,000 of somebody else's money is sitting in
 * the till.
 *
 * Netting them also lets one customer's credit hide another's debt, which is
 * the failure that matters: a wholesaler chasing 5,000 is shown 3,000 and
 * stops chasing early.
 *
 * So each customer's balance is worked out on its own and only then added up,
 * the debts into one figure and the credits into another. "Still to collect"
 * becomes structurally incapable of going negative, and the money owed back is
 * reported rather than quietly cancelled out. Neither number is invented and
 * neither is hidden.
 *
 * Scoped by wholesaler_id. Takes $1 as the wholesaler.
 */
const collectionTotals = ({ hasOrderParty, hasBridge, hasOpening = false }) => `
  SELECT
    COALESCE(SUM(GREATEST(dues.balance, 0)), 0) AS owed_to_you,
    COALESCE(SUM(GREATEST(-dues.balance, 0)), 0) AS owed_by_you
  FROM parties p
  JOIN LATERAL (
    SELECT ${balanceExpression({ hasOrderParty, hasBridge, hasOpening, partyRef: "p.id" })} AS balance
  ) dues ON TRUE
  WHERE p.wholesaler_id = $1
`;

/**
 * Does this database carry the opening balance column yet?
 *
 * Probed once and cached, like every other schema check here. Every caller of
 * balanceExpression has to pass the answer through, because a balance that
 * includes the opening figure on one screen and not on another is exactly the
 * disagreement this file exists to prevent.
 */
let openingReady = null;
const hasOpeningBalance = async (db) => {
  if (openingReady !== null) return openingReady;
  try {
    const { rows } = await db.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns
         WHERE table_name = 'parties' AND column_name = 'opening_balance') AS yes`,
    );
    openingReady = rows[0].yes === true;
  } catch {
    openingReady = false;
  }
  return openingReady;
};

// Tests build a fresh database per run, so they need to forget.
const resetOpeningBalance = () => { openingReady = null; };

module.exports = {
  hasOpeningBalance,
  resetOpeningBalance,
  ORDER_NOT_OWED,
  NOT_OWED_SQL,
  BILLED_SALE_STATUSES,
  bridgedGuard,
  refundedBack,
  balanceExpression,
  totalsExpression,
  collectionTotals,
};

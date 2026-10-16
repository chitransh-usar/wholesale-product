const pool = require("../config/db");
const { hasPartyLink } = require("../services/partyService");
const { hasSaleLink } = require("../services/orderSaleService");
const { businessId } = require("../middlewares/businessContext");
const { can } = require("../services/staffAccess");
const {
  BILLED_SALE_STATUSES,
  NOT_OWED_SQL,
  bridgedGuard,
  refundedBack,
  balanceExpression,
  totalsExpression,
  collectionTotals,
  hasOpeningBalance,
} = require("../services/khataBalance");

/**
 * The first screen a wholesaler sees. Everything here is computed from their own
 * rows, so a new account shows zeroes and empty lists rather than a plausible
 * looking number. The marketplace dashboard this replaces reported a buyer
 * rating and a listing count, neither of which means anything now.
 *
 * Deliberately built around what needs doing rather than what has happened.
 * Totals are there, but the lists are the point: who owes you, what has not
 * gone out yet, and who has gone quiet.
 */

// What counts as billed, and what counts as owed, is defined once in
// services/khataBalance and read by both this screen and the customer page.
//
// This screen used to compute it here instead, billing from sales alone while
// subtracting every payment including money taken through the shop. A
// wholesaler whose customers paid through the marketplace was therefore shown
// a NEGATIVE amount still to collect: the payment came off the total and the
// order behind it was never added on. The two screens disagreed about the
// same question, and this was the one that was wrong.
const BILLED_STATUSES = BILLED_SALE_STATUSES;

// How long without a sale before a customer is worth chasing. Nothing hangs
// on the exact number, it is a prompt rather than a rule.
const QUIET_AFTER_DAYS = 60;

exports.getOverview = async (req, res) => {
  const wholesalerId = businessId(req);

  try {
    // Asked once, so the query below can name orders.party_id and sales.order_id
    // only when the migrations that add them have actually been run.
    const hasOrderParty = await hasPartyLink(pool);
    const hasBridge = await hasSaleLink(pool);
    const hasOpening = await hasOpeningBalance(pool);
    const allTime = totalsExpression({ hasOrderParty, hasBridge });
    const thisMonth = totalsExpression({
      hasOrderParty,
      hasBridge,
      since: "date_trunc('month', CURRENT_DATE)",
    });

    const [collect, money, counts, toDeliver, topDues, quiet, recentSales] =
      await Promise.all([
        pool.query(collectionTotals({ hasOrderParty, hasBridge, hasOpening }), [wholesalerId]),
        pool.query(
          `SELECT
             ${allTime.billed} AS billed_all_time,
             ${allTime.received} AS received_all_time,
             ${thisMonth.billed} AS billed_this_month,
             ${thisMonth.received} AS received_this_month`,
          [wholesalerId],
        ),

        pool.query(
          `SELECT
             (SELECT COUNT(*) FROM parties
               WHERE wholesaler_id = $1 AND status = 'active') AS parties,
             -- Their products, counted off their shop listings. This used to count
             -- the rate list, which is retired: the two lists were merged into
             -- one and the rate list screen is gone, so counting it would have
             -- frozen at whatever was in it on the day of the merge.
             (SELECT COUNT(*) FROM supplier_inventory
               WHERE supplier_id = $1 AND status = 'Active') AS items,
             (SELECT COUNT(*) FROM sales
               WHERE wholesaler_id = $1
                 AND status <> 'cancelled'
                 AND sale_date >= date_trunc('month', CURRENT_DATE))
               AS sales_this_month`,
          [wholesalerId],
        ),

        // Confirmed but not yet marked delivered: goods they still owes someone.
        pool.query(
          `SELECT s.id, s.sale_number, s.sale_date, s.total, p.name AS party_name
             FROM sales s
             JOIN parties p ON p.id = s.party_id
            WHERE s.wholesaler_id = $1 AND s.status = 'confirmed'
            ORDER BY s.sale_date ASC
            LIMIT 6`,
          [wholesalerId],
        ),

        // Who owes the most. Only rows that actually owe something.
        pool.query(
          `SELECT p.id, p.name, p.business_name, p.phone, dues.outstanding
             FROM parties p
             JOIN LATERAL (
               SELECT ${balanceExpression({ hasOrderParty, hasBridge, hasOpening, partyRef: "p.id" })}
                 AS outstanding
             ) dues ON TRUE
            WHERE p.wholesaler_id = $1 AND dues.outstanding > 0
            ORDER BY dues.outstanding DESC
            LIMIT 5`,
          [wholesalerId],
        ),

        // Customers who used to buy and have stopped. A party who has never
        // bought is not quiet, they are new, so MAX(sale_date) must exist.
        pool.query(
          `SELECT p.id, p.name, p.business_name, p.phone, last.sale_date
             FROM parties p
             JOIN LATERAL (
               SELECT MAX(s.sale_date) AS sale_date FROM sales s
                WHERE s.party_id = p.id AND s.status <> 'cancelled'
             ) last ON TRUE
            WHERE p.wholesaler_id = $1
              AND p.status = 'active'
              AND last.sale_date IS NOT NULL
              AND last.sale_date < CURRENT_DATE - $2::int
            ORDER BY last.sale_date ASC
            LIMIT 5`,
          [wholesalerId, QUIET_AFTER_DAYS],
        ),

        pool.query(
          `SELECT s.id, s.sale_number, s.sale_date, s.status, s.total,
                  p.name AS party_name
             FROM sales s
             JOIN parties p ON p.id = s.party_id
            WHERE s.wholesaler_id = $1
            ORDER BY s.sale_date DESC, s.created_at DESC
            LIMIT 5`,
          [wholesalerId],
        ),
      ]);

    const m = money.rows[0];
    const c = counts.rows[0];
    const k = collect.rows[0];

    // An employee who packs orders does not necessarily get to see the books.
    // The screen is not gated whole, because the lists on it are their work; the
    // money block is simply not sent. Withheld rather than zeroed, so the
    // screen can say "not shown to you" instead of "you are owed nothing",
    // which would be a lie about the business.
    // No business on the request means the middleware did not run, which for
    // an authenticated request cannot happen. Treated as the owner so this
    // matches businessId's documented fallback: it would be perverse for one
    // to scope a query to a man's own book and the other to hide its total.
    const showMoney = req.business ? can(req.business, "money") : true;

    res.status(200).json({
      money: showMoney
        ? {
            // Each customer's balance worked out on its own and only then
            // added up, so a customer in credit cannot cancel out another's
            // debt and "still to collect" cannot come out negative. See
            // khataBalance.
            outstanding: Number(k.owed_to_you),
            owedBack: Number(k.owed_by_you),
            billedThisMonth: Number(m.billed_this_month),
            receivedThisMonth: Number(m.received_this_month),
          }
        : null,
      counts: {
        parties: Number(c.parties),
        items: Number(c.items),
        salesThisMonth: Number(c.sales_this_month),
      },
      toDeliver: toDeliver.rows,
      topDues: showMoney ? topDues.rows : [],
      quiet: quiet.rows,
      quietAfterDays: QUIET_AFTER_DAYS,
      recentSales: recentSales.rows,
    });
  } catch (err) {
    console.error("Error building the overview:", err);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * Why is that number what it is?
 *
 * The three figures on the Overview are sums, and a sum a wholesaler cannot
 * take apart is a number they have to trust rather than check. This returns the
 * rows behind one of them.
 *
 * The rule is not restated here. It is read from services/khataBalance, the
 * same place the card itself reads, which is what makes "these rows add up to
 * that card" true rather than hoped for. The test asserts exactly that.
 *
 * @route GET /api/overview/breakdown?metric=outstanding|billed|received
 */
exports.getBreakdown = async (req, res) => {
  const wholesalerId = businessId(req);
  const metric = String(req.query.metric || "outstanding");

  if (!["outstanding", "billed", "received"].includes(metric)) {
    return res.status(400).json({ message: "Unknown metric" });
  }

  try {
    const hasOrderParty = await hasPartyLink(pool);
    const hasBridge = await hasSaleLink(pool);
    const hasOpening = await hasOpeningBalance(pool);

    if (metric === "outstanding") {
      // Every customer, with the three numbers customer balance is made of, so the
      // arithmetic is on the screen rather than behind it. Customers who owe
      // nothing are left out; the ones in credit are kept, because a minus is
      // exactly the thing somebody opens this page to understand.
      // The sum this page shows its working for. It must stay the same four
      // terms as balanceExpression in khataBalance, in the same order, or the
      // page contradicts the card that sent the wholesaler here.
      const sum =
        "(dues.billed_sales + dues.billed_orders - dues.received + dues.refunded)";

      const rows = await pool.query(
        `SELECT p.id, p.name, p.business_name, p.phone, p.city,
                dues.billed_sales, dues.billed_orders, dues.received, dues.refunded,
                ${sum} AS outstanding
           FROM parties p
           JOIN LATERAL (
             SELECT
               COALESCE((SELECT SUM(s.total) FROM sales s
                  WHERE s.party_id = p.id
                    AND s.status IN ${BILLED_SALE_STATUSES}), 0) AS billed_sales,
               ${
                 hasOrderParty
                   ? `COALESCE((SELECT SUM(o.total_amount) FROM orders o
                        WHERE o.party_id = p.id
                          AND o.status NOT IN (${NOT_OWED_SQL})
                          ${bridgedGuard(hasBridge)}), 0)`
                   : "0"
               } AS billed_orders,
               COALESCE((SELECT SUM(pp.amount) FROM party_payments pp
                  WHERE pp.party_id = p.id), 0) AS received,
               ${
                 hasOrderParty
                   ? `COALESCE((${refundedBack("p.id")}), 0)`
                   : "0"
               } AS refunded
           ) dues ON TRUE
          WHERE p.wholesaler_id = $1
            AND ${sum} <> 0
          ORDER BY ${sum} DESC`,
        [wholesalerId],
      );
      return res.status(200).json({ metric, rows: rows.rows });
    }

    const since = "date_trunc('month', CURRENT_DATE)";

    if (metric === "billed") {
      // Hand written sales and shop orders in one list, each saying which it
      // is, because "billed this month" covers both and a wholesaler looking
      // for a missing figure needs to know where to go and look.
      const orderPart = hasOrderParty
        ? `UNION ALL
           SELECT o.id, 'order' AS kind, o.order_number AS reference,
                  o.created_at::date AS on_date, o.status, o.total_amount AS amount,
                  COALESCE(p.name, 'Walk in') AS party_name, p.id AS party_id
             FROM orders o
             LEFT JOIN parties p ON p.id = o.party_id
            WHERE o.supplier_id = $1
              AND o.party_id IS NOT NULL
              AND o.status NOT IN (${NOT_OWED_SQL})
              ${bridgedGuard(hasBridge)}
              AND o.created_at >= ${since}`
        : "";

      const rows = await pool.query(
        `SELECT id, kind, reference, on_date, status, amount, party_name, party_id
           FROM (
             SELECT s.id, 'sale' AS kind, s.sale_number AS reference,
                    s.sale_date AS on_date, s.status, s.total AS amount,
                    p.name AS party_name, p.id AS party_id
               FROM sales s
               JOIN parties p ON p.id = s.party_id
              WHERE s.wholesaler_id = $1
                AND s.status IN ${BILLED_SALE_STATUSES}
                AND s.sale_date >= ${since}
             ${orderPart}
           ) rows
          ORDER BY on_date DESC, reference DESC`,
        [wholesalerId],
      );
      return res.status(200).json({ metric, rows: rows.rows });
    }

    // received
    const rows = await pool.query(
      `SELECT pp.id, pp.amount, pp.method, pp.paid_on, pp.note,
              p.id AS party_id, p.name AS party_name,
              o.order_number
         FROM party_payments pp
         JOIN parties p ON p.id = pp.party_id
         LEFT JOIN orders o ON o.id = pp.order_id
        WHERE pp.wholesaler_id = $1
          AND pp.paid_on >= ${since}
        ORDER BY pp.paid_on DESC, pp.created_at DESC`,
      [wholesalerId],
    );
    return res.status(200).json({ metric, rows: rows.rows });
  } catch (err) {
    console.error("Error building the breakdown:", err);
    res.status(500).json({ message: "Server error" });
  }
};

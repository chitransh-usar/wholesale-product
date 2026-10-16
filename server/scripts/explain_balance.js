/**
 * Why does this customer's balance say what it says?
 *
 * A negative balance means the wholesaler has taken more money from someone
 * than they have billed them for. That is sometimes exactly right, an advance or
 * a payment against an order that was later cancelled, and sometimes it is old
 * test data from a prototype that was never real business.
 *
 * This tells the two apart by showing every figure the balance is made of,
 * rather than leaving anyone to guess at it.
 *
 *     node scripts/explain_balance.js              every customer in credit
 *     node scripts/explain_balance.js <party-id>   one customer in full
 */
require("dotenv").config();
const pool = require("../src/config/db");

// A customer id is a UUID. Anything else is a typo, and saying so is better
// than handing it to Postgres and printing "invalid input syntax for uuid".
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const arg = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null;
if (arg && !UUID.test(arg)) {
  console.error(`"${arg}" is not a customer id.`);
  console.error("Run it with no arguments to see every customer in credit,");
  console.error("or pass one customer's id to see that customer in full.");
  process.exit(1);
}
const ONE = arg;
const CLEAN = process.argv.includes("--clean-test-payments");
const CONFIRM = process.argv.includes("--confirm");

const rupees = (n) =>
  `Rs.${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

const hasColumn = async (table, column) =>
  (await pool.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 AND column_name=$2) AS yes`,
    [table, column],
  )).rows[0].yes;

(async () => {
  try {
    const hasOrderParty = await hasColumn("orders", "party_id");
    const hasBridge = await hasColumn("sales", "order_id");
    const bridged = hasBridge
      ? "AND NOT EXISTS (SELECT 1 FROM sales s2 WHERE s2.order_id = o.id)"
      : "";
    const NOT_OWED = `'pending','payment_pending','payment_failed','cancelled','refunded','return_completed'`;

    const orderTerm = hasOrderParty
      ? `COALESCE((SELECT SUM(o.total_amount) FROM orders o
                    WHERE o.party_id = p.id AND o.status NOT IN (${NOT_OWED}) ${bridged}), 0)`
      : "0";

    /**
     * Remove ledger rows the backfill filed against orders that are not owed.
     *
     * Only rows the backfill itself created, which is what
     * payment_transaction_id marks. A payment the wholesaler wrote down by
     * hand is never touched, whatever state its order is in.
     *
     * This is money leaving the books, so it prints what it would remove and
     * changes nothing until --confirm is passed as well.
     */
    if (CLEAN) {
      const doomed = await pool.query(
        `SELECT pp.id, pp.amount, pp.paid_on, p.name, o.order_number, o.status
           FROM party_payments pp
           JOIN parties p ON p.id = pp.party_id
           JOIN orders o ON o.id = pp.order_id
          WHERE pp.payment_transaction_id IS NOT NULL
            AND o.status IN (${NOT_OWED})
          ORDER BY p.name, pp.paid_on`,
      );

      if (doomed.rows.length === 0) {
        console.log("Nothing to clean: every backfilled payment sits against an order that is owed.");
        return;
      }

      console.log(
        `${doomed.rows.length} payment(s) filed against orders that are not owed:\n`,
      );
      let total = 0;
      for (const row of doomed.rows) {
        total += Number(row.amount);
        console.log(
          `  ${row.name.padEnd(24)} ${rupees(row.amount).padEnd(14)} order ${row.order_number} (${row.status})`,
        );
      }
      console.log(`\n  ${rupees(total)} in total.`);

      if (!CONFIRM) {
        console.log("\nNothing was removed. If this is prototype data and none of it was");
        console.log("real money, run it again with --confirm to delete these rows.");
        console.log("If any of it was real, leave it: the customer is genuinely in credit");
        console.log("and you owe them a refund or the money counts against their next order.");
        return;
      }

      const gone = await pool.query(
        `DELETE FROM party_payments pp
          USING orders o
          WHERE o.id = pp.order_id
            AND pp.payment_transaction_id IS NOT NULL
            AND o.status IN (${NOT_OWED})
          RETURNING pp.id`,
      );
      console.log(`\nRemoved ${gone.rows.length} payment(s) from the khata.`);
      console.log("The orders and the payment records themselves are untouched.");
      return;
    }

    const rows = await pool.query(
      `SELECT p.id, p.name, p.phone,
              COALESCE((SELECT SUM(s.total) FROM sales s
                         WHERE s.party_id = p.id
                           AND s.status IN ('confirmed','delivered')), 0) AS billed_sales,
              ${orderTerm} AS billed_orders,
              COALESCE((SELECT SUM(pp.amount) FROM party_payments pp
                         WHERE pp.party_id = p.id), 0) AS received
         FROM parties p
        ${ONE ? "WHERE p.id = $1" : ""}
        ORDER BY p.name`,
      ONE ? [ONE] : [],
    );

    const interesting = rows.rows
      .map((r) => ({
        ...r,
        balance:
          Number(r.billed_sales) + Number(r.billed_orders) - Number(r.received),
      }))
      .filter((r) => ONE || r.balance < 0);

    if (interesting.length === 0) {
      console.log("No customer is in credit. Nothing to explain.");
      return;
    }

    console.log(
      ONE
        ? ""
        : `${interesting.length} customer(s) show a negative balance, meaning more money came in than was billed.\n`,
    );

    for (const r of interesting) {
      console.log(`${r.name}${r.phone ? ` (${r.phone})` : ""}`);
      console.log(`  billed, hand written sales   ${rupees(r.billed_sales)}`);
      console.log(`  billed, shop orders          ${rupees(r.billed_orders)}`);
      console.log(`  received                     ${rupees(r.received)}`);
      console.log(`  balance                      ${rupees(r.balance)}${r.balance < 0 ? "   <-- in credit" : ""}`);

      // Where the money came from, and whether the order behind it is one the
      // khata counts as owed. A payment against an order that is not owed is
      // the usual reason for a customer sitting in credit.
      if (hasOrderParty) {
        const pays = await pool.query(
          `SELECT pp.amount, pp.paid_on, pp.method, pp.note,
                  o.order_number, o.status AS order_status,
                  (o.status NOT IN (${NOT_OWED})) AS order_is_owed
             FROM party_payments pp
             LEFT JOIN orders o ON o.id = pp.order_id
            WHERE pp.party_id = $1
            ORDER BY pp.paid_on`,
          [r.id],
        );
        console.log("  money received:");
        for (const pay of pays.rows) {
          const where = pay.order_number
            ? `order ${pay.order_number} (${pay.order_status})${pay.order_is_owed ? "" : "  <-- this order is not owed, so this money has nothing to sit against"}`
            : pay.note || "recorded by hand";
          console.log(`    ${String(pay.paid_on).slice(0, 10)}  ${rupees(pay.amount).padEnd(14)} ${where}`);
        }
      }
      console.log("");
    }

    if (!ONE) {
      console.log("What to do:");
      console.log("  A payment against a cancelled or failed order is real money the");
      console.log("  customer handed over, so the credit is correct and you owe them a");
      console.log("  refund, or it counts against their next order.");
      console.log("");
      console.log("  If it is left over from testing and was never real, delete just");
      console.log("  those payment rows:");
      console.log("    node scripts/explain_balance.js --clean-test-payments");
      console.log("  which shows what it would remove before removing anything.");
    }
  } finally {
    await pool.end();
  }
})();

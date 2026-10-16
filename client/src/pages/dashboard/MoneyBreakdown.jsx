import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, IndianRupee, Receipt, ShoppingBag, Wallet } from "lucide-react";
import api from "../../utils/axios";
import { toast } from "sonner";
import { amount as money, dateLabel } from "../../utils/money";

/**
 * Why is that number what it is?
 *
 * The Overview shows three totals, and a total nobody can take apart is a
 * number a wholesaler has to trust rather than check. This is the other half
 * of each card: the rows it is made of, adding up in front of them.
 *
 * The total at the bottom is computed from the rows on this page, not sent
 * down separately, so if it ever disagreed with the card the difference would
 * be visible rather than hidden. The server builds both from one rule for the
 * same reason.
 *
 * "Still to collect" is the one worth the most care. Debts and credits are
 * totalled separately rather than netted, because a customer in credit
 * cancelling out another customer's debt produces a figure nobody can act on
 * and hides both facts. A customer in credit still appears in the list, marked
 * red, since that is exactly what somebody opens this page to understand.
 */

// The minus belongs in front of the whole amount, not between the rupee sign
// and the digits. "Rs.-2,000.00" reads as a typo; "-Rs.2,000.00" reads as a
// credit.
const METRICS = {
  outstanding: {
    title: "Still to collect",
    icon: Wallet,
    lead: "Everything billed, less everything received, plus anything paid back, for each customer.",
    empty: "Nobody owes you anything, and you owe nobody. Your book is square.",
  },
  billed: {
    title: "Billed this month",
    icon: Receipt,
    lead: "Every sale you wrote down and every shop order, since the 1st.",
    empty: "Nothing has been billed yet this month.",
  },
  received: {
    title: "Received this month",
    icon: IndianRupee,
    lead: "Every payment that came in since the 1st, cash or through the shop.",
    empty: "No money has come in yet this month.",
  },
};

const METHOD_LABELS = {
  cash: "Cash",
  upi: "UPI",
  bank: "Bank",
  cheque: "Cheque",
  other: "Other",
};

const MoneyBreakdown = () => {
  const { metric = "outstanding" } = useParams();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const meta = METRICS[metric];

  useEffect(() => {
    if (!meta) return;
    let alive = true;
    const load = async () => {
      setLoading(true);
      try {
        const res = await api.get("/api/overview/breakdown", { params: { metric } });
        if (alive) setRows(Array.isArray(res.data?.rows) ? res.data.rows : []);
      } catch (error) {
        console.error("Failed to load the breakdown", error);
        if (alive) toast.error("Could not load this list.");
      }
      if (alive) setLoading(false);
    };
    load();
    return () => {
      alive = false;
    };
  }, [metric, meta]);

  if (!meta) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <p className="font-semibold text-espresso">Nothing to show here</p>
        <Link to="/seller" className="mt-2 inline-block text-sm font-bold text-clay">
          Back to the overview
        </Link>
      </div>
    );
  }

  // Added up from what is on the screen. If this ever disagreed with the card
  // on the Overview, the disagreement would be visible instead of silent.
  //
  // Debts and credits are added up separately, exactly as the card is, because
  // netting them produces a figure that is not a real quantity: there is no
  // single sum somebody can go out and collect when one customer owes and
  // another is owed.
  const owedToYou = rows.reduce(
    (sum, r) => sum + Math.max(Number(metric === "outstanding" ? r.outstanding : r.amount), 0),
    0,
  );
  const owedByYou =
    metric === "outstanding"
      ? rows.reduce((sum, r) => sum + Math.max(-Number(r.outstanding), 0), 0)
      : 0;

  const Icon = meta.icon;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <button
          onClick={() => navigate("/seller")}
          className="mb-3 inline-flex cursor-pointer items-center gap-1.5 text-xs font-bold text-slate-500 transition-colors hover:text-clay"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Overview
        </button>
        <h2 className="flex items-center gap-2 text-2xl font-black text-espresso">
          <Icon className="h-6 w-6 text-clay" />
          {meta.title}
        </h2>
        <p className="mt-1 text-sm text-slate-500">{meta.lead}</p>
      </div>

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 shadow-sm">
          {meta.empty}
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {metric === "outstanding" && (
              <OutstandingRows rows={rows} />
            )}
            {metric === "billed" && <BilledRows rows={rows} />}
            {metric === "received" && <ReceivedRows rows={rows} />}
          </div>

          {/* The point of the page. The rows above add up to this, and this
              is the figure on the card. */}
          <div className="space-y-3">
            <div className="flex flex-col gap-1 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div>
                <p className="text-sm font-bold text-espresso">{meta.title}</p>
                <p className="text-xs text-slate-500">
                  {rows.length} {rows.length === 1 ? "entry" : "entries"}, added up
                </p>
              </div>
              <p className="text-2xl font-black text-espresso">
                {money(owedToYou)}
              </p>
            </div>

            {owedByYou > 0 && (
              <div className="flex flex-col gap-1 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div>
                  <p className="text-sm font-bold text-amber-900">
                    Money you are holding for customers
                  </p>
                  <p className="text-xs text-amber-800">
                    Kept apart on purpose. It is not yours, and it does not
                    reduce what others owe you.
                  </p>
                </div>
                <p className="shrink-0 text-2xl font-black text-amber-700">
                  {money(owedByYou)}
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

/**
 * Each customer with the arithmetic spelled out, because "they owe 4,200" is
 * not something anyone can check and "billed 9,000, paid 4,800" is.
 */
const OutstandingRows = ({ rows }) => {
  // The column only appears once there is something in it. A wholesaler who
  // has never refunded anybody does not need a column of zeroes, and one who
  // has cannot follow the arithmetic without it.
  const showRefunds = rows.some((r) => Number(r.refunded || 0) !== 0);
  const grid = showRefunds
    ? "sm:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr]"
    : "sm:grid-cols-[2fr_1fr_1fr_1fr_1fr]";

  return (
  <>
    <div className={`hidden gap-3 border-b border-slate-100 bg-slate-50 px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 sm:grid ${grid}`}>
      <span>Customer</span>
      <span className="text-right">Sales</span>
      <span className="text-right">Shop orders</span>
      <span className="text-right">Received</span>
      {showRefunds && <span className="text-right">Paid back</span>}
      <span className="text-right">Balance</span>
    </div>
    <ul className="divide-y divide-slate-100">
      {rows.map((r) => {
        const balance = Number(r.outstanding);
        return (
          <li key={r.id}>
            <Link
              to={`/seller/customers/${r.id}`}
              className={`block px-5 py-3.5 transition-colors hover:bg-slate-50 sm:grid sm:gap-3 ${grid}`}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-espresso">
                  {r.business_name || r.name}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {[r.phone, r.city].filter(Boolean).join(" · ") || "No phone"}
                </p>
              </div>

              {/* On a phone the four figures read as a sentence under the
                  name rather than as a table nobody can see the right of. */}
              {/* A grid rather than a wrapping line. Four figures running
                  into each other cannot be read as arithmetic, and the whole
                  point of this page is that the arithmetic is visible. */}
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-500 sm:hidden">
                <span>Sales {money(r.billed_sales)}</span>
                <span>Shop {money(r.billed_orders)}</span>
                <span>Received {money(r.received)}</span>
                {showRefunds && (
                  <span>Paid back {money(r.refunded)}</span>
                )}
                <span
                  className={`font-bold ${balance < 0 ? "text-rose-600" : "text-espresso"}`}
                >
                  {money(balance)}
                  {balance < 0 ? " in credit" : " due"}
                </span>
              </div>

              <span className="hidden text-right text-sm text-slate-600 sm:block">
                {money(r.billed_sales)}
              </span>
              <span className="hidden text-right text-sm text-slate-600 sm:block">
                {money(r.billed_orders)}
              </span>
              <span className="hidden text-right text-sm text-slate-600 sm:block">
                {money(r.received)}
              </span>
              {showRefunds && (
                <span className="hidden text-right text-sm text-slate-600 sm:block">
                  {money(r.refunded)}
                </span>
              )}
              <span
                className={`hidden text-right text-sm font-bold sm:block ${
                  balance < 0 ? "text-rose-600" : "text-espresso"
                }`}
              >
                {money(balance)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
    {rows.some((r) => Number(r.outstanding) < 0) && (
      // A minus is usually right rather than broken, and saying so here saves
      // a phone call.
      <p className="border-t border-slate-100 bg-amber-50 px-5 py-3 text-xs text-amber-900">
        A red balance means that customer has paid you more than you have
        billed them, so the money is their. It usually means an order was
        cancelled or returned after they had paid.
      </p>
    )}
  </>
  );
};

const BilledRows = ({ rows }) => (
  <ul className="divide-y divide-slate-100">
    {rows.map((r) => (
      <li key={`${r.kind}-${r.id}`}>
        <Link
          to={r.kind === "sale" ? `/seller/sales/${r.id}` : `/seller/orders/${r.id}`}
          className="flex items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-slate-50"
        >
          <div className="flex min-w-0 items-center gap-3">
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                r.kind === "sale" ? "bg-clay/10 text-clay" : "bg-sky-50 text-sky-600"
              }`}
              title={r.kind === "sale" ? "Written down by you" : "Came in through the shop"}
            >
              {r.kind === "sale" ? (
                <Receipt className="h-4 w-4" />
              ) : (
                <ShoppingBag className="h-4 w-4" />
              )}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-espresso">
                {r.party_name}
              </p>
              <p className="truncate text-xs text-slate-500">
                {r.reference} · {dateLabel(r.on_date)}
              </p>
            </div>
          </div>
          <span className="shrink-0 text-sm font-bold text-espresso">
            {money(r.amount)}
          </span>
        </Link>
      </li>
    ))}
  </ul>
);

const ReceivedRows = ({ rows }) => (
  <ul className="divide-y divide-slate-100">
    {rows.map((r) => (
      <li key={r.id}>
        <Link
          to={`/seller/customers/${r.party_id}`}
          className="flex items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-slate-50"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-espresso">
              {r.party_name}
            </p>
            <p className="truncate text-xs text-slate-500">
              {dateLabel(r.paid_on)} · {METHOD_LABELS[r.method] || r.method}
              {r.order_number ? ` · order ${r.order_number}` : ""}
            </p>
          </div>
          <span className="shrink-0 text-sm font-bold text-emerald-700">
            {money(r.amount)}
          </span>
        </Link>
      </li>
    ))}
  </ul>
);

export default MoneyBreakdown;

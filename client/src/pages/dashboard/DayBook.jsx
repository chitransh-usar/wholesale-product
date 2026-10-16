import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Clock } from "lucide-react";
import api from "../../utils/axios";
import { toast } from "sonner";
import { money, dateLabel } from "../../utils/money";
import { formatOrderStatus } from "../../utils/orderStatus";

/**
 * The day book: everything that happened, in one list.
 *
 * Marg calls it Day Book, Tally and Busy have the same screen. It is what a
 * trader opens before going home to check the day, and until now this product
 * made him open six screens to do it.
 *
 * Nothing here is computed that is not computed elsewhere. Every row links
 * back to the document it came from, because the point is to find the thing
 * that looks wrong, not to replace the screen that owns it.
 */

const KINDS = {
  // An order is a promise, so it is listed but adds nothing to the four money
  // figures above. The bill under it is what counts.
  order: { label: "Order", tone: "bg-indigo-50 text-indigo-700", to: (r) => `/seller/orders/${r.id}` },
  sale: { label: "Sale", tone: "bg-sky-50 text-sky-700", to: (r) => `/seller/sales/${r.id}` },
  purchase: { label: "Purchase", tone: "bg-amber-50 text-amber-700", to: (r) => `/seller/purchases/${r.id}` },
  // Payments link to the party whose account they landed on, which is where
  // the voucher and the running balance live. They went nowhere before, which
  // stranded anybody who clicked one wanting to check it.
  payment_in: { label: "Money in", tone: "bg-emerald-50 text-emerald-700",
    to: (r) => (r.link_id ? `/seller/customers/${r.link_id}` : null) },
  payment_out: { label: "Money out", tone: "bg-rose-50 text-rose-700",
    to: (r) => (r.link_id ? `/seller/suppliers/${r.link_id}` : null) },
  // There is no credit note screen of its own: a note is shown on the bill it
  // reverses, which is also where somebody checking one wants to be.
  credit_note: { label: "Credit note", tone: "bg-orange-50 text-orange-700",
    to: (r) => (r.link_id ? `/seller/invoices/${r.link_id}` : null) },
  invoice: { label: "Bill", tone: "bg-violet-50 text-violet-700", to: (r) => `/seller/invoices/${r.id}` },
  sale_challan: { label: "Sale challan", tone: "bg-slate-100 text-slate-600", to: (r) => `/seller/challans/${r.id}` },
  purchase_challan: { label: "Purchase challan", tone: "bg-slate-100 text-slate-600", to: (r) => `/seller/challans/${r.id}` },
};

// A payment carries its method here, not a status, and the ones traders use
// are initialisms. "Upi" is not a word.
const METHODS = { upi: "UPI", neft: "NEFT", rtgs: "RTGS", imps: "IMPS" };

const statusLabel = (status) => {
  const value = String(status || "").toLowerCase();
  return METHODS[value] || formatOrderStatus(status);
};

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) =>
  new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

const Money = ({ label, value, tone = "text-espresso" }) => (
  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
      {label}
    </p>
    <p className={`mt-0.5 text-lg font-black ${tone}`}>₹{money(value)}</p>
  </div>
);

const DayBook = () => {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [data, setData] = useState(null);
  const [payable, setPayable] = useState(null);

  // Derived, not stored. Setting a loading flag in the effect body is the
  // cascading-render pattern React warns about, and the answer already
  // carries the range it was asked for, so "still loading" is just "what I
  // have is not what I asked for".
  const loading = data?.from !== from || data?.to !== to;

  useEffect(() => {
    let alive = true;
    api
      .get("/api/daybook", { params: { from, to } })
      .then(({ data: body }) => alive && setData(body))
      .catch(() => {
        if (!alive) return;
        toast.error("Could not load the day book.");
        // Marked answered, so the screen shows an empty day rather than
        // spinning for ever on a failure.
        setData({ from, to, entries: [], money: {} });
      });
    return () => {
      alive = false;
    };
  }, [from, to]);

  useEffect(() => {
    let alive = true;
    api
      .get("/api/daybook/payable")
      // Silent. An employee without the purchases permission gets a 403 here
      // and should simply not see the block, not be told off for opening the
      // day book.
      .then(({ data: body }) => alive && setPayable(body))
      .catch(() => alive && setPayable(null));
    return () => {
      alive = false;
    };
  }, []);

  const entries = data?.entries || [];
  const m = data?.money || { received: 0, paid: 0, sold: 0, bought: 0 };

  const preset = (label, f, t) => (
    <button
      key={label}
      onClick={() => {
        setFrom(f);
        setTo(t);
      }}
      className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors ${
        from === f && to === t
          ? "bg-espresso text-cream"
          : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h2 className="text-2xl font-black text-espresso">Day book</h2>
        <p className="mt-1 text-sm text-slate-500">
          Everything that happened, newest first.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {preset("Today", today(), today())}
        {preset("Yesterday", daysAgo(1), daysAgo(1))}
        {preset("Last 7 days", daysAgo(6), today())}
        {preset("Last 30 days", daysAgo(29), today())}
        <span className="ml-auto flex items-center gap-2">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-clay"
          />
          <span className="text-xs text-slate-400">to</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-clay"
          />
        </span>
      </div>

      {/* Never netted. A day with a lakh in and a lakh out is not a quiet day,
          and one figure would say it was. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Money label="Sold" value={m.sold} />
        <Money label="Money in" value={m.received} tone="text-emerald-700" />
        <Money label="Bought" value={m.bought} />
        <Money label="Money out" value={m.paid} tone="text-rose-700" />
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent" />
          </div>
        ) : entries.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <BookOpen className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <p className="font-semibold text-espresso">Nothing on these days</p>
            <p className="mt-1 text-sm text-slate-500">
              Try a wider range.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {entries.map((row) => {
              const kind = KINDS[row.kind] || {
                label: row.kind,
                tone: "bg-slate-100 text-slate-600",
                to: () => null,
              };
              const href = kind.to(row);
              const body = (
                <div className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
                  {/* A FIXED WIDTH COLUMN, not a badge that sizes itself.
                      The labels run from "Sale" to "Purchase challan", so a
                      shrink-to-fit badge started every name at a different
                      place and the list read as ragged down the left. The
                      badge still sizes to its own text; the column it sits in
                      does not. */}
                  <span className="w-[104px] shrink-0">
                    <span
                      className={`inline-block whitespace-nowrap rounded-md px-2 py-1 text-[10px] font-bold ${kind.tone}`}
                    >
                      {kind.label}
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-espresso">
                      {row.other_party || "No name"}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {dateLabel(row.on_date)}
                      {row.reference ? ` · ${row.reference}` : ""}
                      {/* Never the raw column. An order carries statuses like
                          supplier_accepted, and a trader should not have to
                          read an underscore to know his order was taken. */}
                      {row.status ? ` · ${statusLabel(row.status)}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-black text-espresso">
                    ₹{money(row.amount)}
                  </span>
                </div>
              );
              return (
                <li key={`${row.kind}-${row.id}`}>
                  {href ? (
                    <Link to={href} className="block transition-colors hover:bg-slate-50">
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* What he owes, by age. The receivable version of this has existed
          since the invoice work; this side had nothing, and it is the one that
          gets a trader into trouble. */}
      {payable?.ready && payable.buckets.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
            <Clock className="h-5 w-5 shrink-0 text-clay" />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-espresso">
                What you owe, by age
              </h3>
              <p className="text-xs text-slate-500">
                Counted from each supplier's own bill date.
              </p>
            </div>
            <span className="shrink-0 text-lg font-black text-espresso">
              ₹{money(payable.total)}
            </span>
          </div>
          <ul className="divide-y divide-slate-100">
            {payable.buckets.map((bucket) => (
              <li
                key={bucket.bucket}
                className="flex items-center gap-3 px-5 py-3"
              >
                <span className="min-w-0 flex-1 text-sm font-semibold text-espresso">
                  {bucket.bucket}
                </span>
                <span className="shrink-0 text-xs text-slate-500">
                  {bucket.count} bill{Number(bucket.count) === 1 ? "" : "s"}
                </span>
                <span className="shrink-0 text-sm font-bold text-espresso">
                  ₹{money(bucket.amount)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default DayBook;

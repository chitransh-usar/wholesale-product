import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock,
  Package,
  Phone,
  Truck,
  Users,
  Wallet,
} from "lucide-react";
import api from "../../utils/axios";
import { toast } from "sonner";
import { money, dateLabel } from "../../utils/money";

const sinceLabel = (value) => {
  if (!value) return "";
  const days = Math.floor(
    (Date.now() - new Date(value).getTime()) / (1000 * 60 * 60 * 24),
  );
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
};

const STATUS_STYLES = {
  draft: "bg-slate-100 text-slate-600",
  confirmed: "bg-sky-50 text-sky-700",
  delivered: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-rose-50 text-rose-700",
};

/**
 * One of the three figures, and the way into the rows behind it.
 *
 * These were plain boxes. A total a wholesaler cannot take apart is a number
 * they have to trust rather than check, and the first question anybody asks of a
 * figure on a dashboard is "why is it that". Each card now opens the list it
 * is made of.
 *
 * A negative "still to collect" reads red rather than amber. It means they owe
 * their customers money, which is a different fact from being owed some.
 */
/**
 * `wide` is the phone only.
 *
 * Three cards across a 320px screen left each amount 57px of room for a figure
 * that needs 82px, so every one of them was clipped, and it was still clipped
 * at 390px. Measured, not guessed: that is what "the dashboard numbers feel
 * weird" was.
 *
 * The fix is not a smaller font. What a wholesaler opens this screen for is
 * what they are owed, so that figure takes the full width and the two month to
 * date totals share the row underneath. Back to three across from sm: up,
 * where they always fitted.
 */
const MoneyCard = ({ label, value, hint, to, tone = "espresso", wide = false }) => (
  <Link
    to={to}
    className={`group block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-clay sm:rounded-2xl sm:p-5 ${
      wide ? "col-span-2 sm:col-span-1" : ""
    }`}
  >
    <div className="flex items-start justify-between gap-1">
      <p className="text-[11px] font-semibold leading-tight text-slate-500 sm:text-sm">
        {label}
      </p>
      {/* A phone has no hover, so the card needs to say it can be tapped
          without spending a line on it. */}
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300 sm:hidden" />
    </div>
    <p
      className={`mt-1 font-black sm:text-2xl ${wide ? "text-2xl" : "text-lg"} ${
        Number(value) < 0
          ? "text-rose-600"
          : tone === "amber"
            ? "text-amber-600"
            : "text-espresso"
      }`}
    >
      ₹{money(value)}
    </p>
    <p className="mt-1 hidden text-xs font-medium text-slate-500 sm:block">
      {hint}
    </p>
    {/* Hidden rather than transparent on a phone. Left in the layout it
        reserved a line that hover could never fill, which is what made these
        cards half empty on a 390px screen. */}
    <p className="mt-1.5 hidden items-center gap-1 text-[11px] font-bold text-clay opacity-0 transition-opacity group-hover:opacity-100 sm:flex">
      See what makes this up
      <ArrowRight className="h-3 w-3" />
    </p>
  </Link>
);

const Panel = ({ icon: Icon, title, subtitle, action, children }) => (
  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-5 py-3">
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-500">
          <Icon className="h-4 w-4 shrink-0 text-slate-400" />
          {title}
        </h3>
        {/* A panel title alone does not say what would appear in it. The
            subtitle does, so an empty panel still explains itself. */}
        {subtitle && (
          <p className="mt-0.5 pl-6 text-xs font-medium text-slate-400">
            {subtitle}
          </p>
        )}
      </div>
      {action}
    </div>
    {children}
  </div>
);

const Empty = ({ children }) => (
  <p className="px-5 py-10 text-center text-sm text-slate-500">{children}</p>
);

/**
 * The wholesaler's first screen. Built around what needs doing rather than
 * what has happened, and every number on it is counted from their own rows. The
 * marketplace dashboard this replaces showed a buyer rating and a listing
 * count, neither of which describes this product.
 */
const Overview = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await api.get("/api/overview");
        if (alive) setData(res.data);
      } catch (error) {
        console.error("Failed to load the overview", error);
        if (alive) toast.error("Could not load your overview.");
      }
      if (alive) setLoading(false);
    };
    load();
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <p className="font-semibold text-espresso">
          Could not load your overview
        </p>
        <p className="mt-1 text-sm text-slate-500">
          Reload the page and it should come back.
        </p>
      </div>
    );
  }

  const { money: m, counts, toDeliver, topDues, quiet, recentSales } = data;

  // While any of these is missing the app cannot do much, so setup comes
  // before the numbers. A wall of zeroes teaches a new wholesaler nothing.
  const steps = [
    {
      done: counts.parties > 0,
      label: "Add the shops you sell to",
      to: "/seller/customers",
    },
    {
      done: counts.items > 0,
      label: "Put in what you sell and your rates",
      to: "/seller/rates",
    },
    {
      done: recentSales.length > 0,
      label: "Record your first sale",
      to: "/seller/sales/new",
    },
  ];
  const setupDone = steps.every((step) => step.done);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* No Record a sale button here, and no Enter a bill either. This screen
          reports, it does not write. Each book carries its own two buttons at
          the top of its own list, and a wholesaler with nothing recorded yet
          gets the steps below. */}
      <div>
        <h2 className="text-2xl font-black text-espresso">Overview</h2>
        <p className="mt-1 text-sm text-slate-500">
          {counts.salesThisMonth === 0
            ? "No sales recorded this month yet."
            : `${counts.salesThisMonth} ${
                counts.salesThisMonth === 1 ? "sale" : "sales"
              } recorded this month.`}
        </p>
      </div>

      {!setupDone && (
        <div className="rounded-2xl border border-clay/20 bg-clay/5 p-5">
          <h3 className="text-sm font-bold text-espresso">
            Three things to get going
          </h3>
          <ul className="mt-3 space-y-2">
            {steps.map((step) => (
              <li key={step.label}>
                <Link
                  to={step.to}
                  className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/60"
                >
                  {step.done ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  ) : (
                    <Circle className="h-4 w-4 shrink-0 text-slate-300" />
                  )}
                  <span
                    className={`flex-1 text-sm ${
                      step.done
                        ? "font-medium text-slate-400 line-through"
                        : "font-semibold text-espresso"
                    }`}
                  >
                    {step.label}
                  </span>
                  {!step.done && (
                    <ArrowRight className="h-4 w-4 shrink-0 text-clay" />
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The money block is WITHHELD, not zeroed, for an employee without the
          money permission: overviewController sends `money: null` rather than
          zeros, so the screen can say "not shown to you" instead of telling
          them the business is owed nothing, which would be a lie about it.
          The server did its half from the start and this screen never did its
          own, so such an employee got a blank page here, on the first screen
          they land on. */}
      {!m ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-6 text-center">
          <p className="text-sm font-bold text-espresso">
            The money figures are not shown to you
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
            Your employer decides who sees what the business is owed. Everything
            else on this page is yours to work with.
          </p>
        </div>
      ) : (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-4">
        <MoneyCard
          label="Still to collect"
          value={m.outstanding}
          hint="What your customers owe you"
          to="/seller/money/outstanding"
          tone={m.outstanding > 0 ? "amber" : "espresso"}
          wide
        />
        <MoneyCard
          label="Billed this month"
          value={m.billedThisMonth}
          hint="Your sales and shop orders"
          to="/seller/money/billed"
        />
        <MoneyCard
          label="Received this month"
          value={m.receivedThisMonth}
          hint="Money that came in"
          to="/seller/money/received"
        />
      </div>
      )}

      {/* Money that is not yours, said out loud rather than quietly taken off
          the figure above. A customer goes into credit when they have paid for
          something that was later cancelled or sent back, and netting it
          against what other customers owe would hide both facts. */}
      {m && Number(m.owedBack) > 0 && (
        <Link
          to="/seller/money/outstanding"
          className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 transition-colors hover:border-amber-300 sm:rounded-2xl sm:px-5"
        >
          <div className="min-w-0">
            <p className="text-sm font-bold text-amber-900">
              You are holding ₹{money(m.owedBack)} of customers' money
            </p>
            <p className="mt-0.5 text-xs text-amber-800">
              They paid for something that was cancelled or came back. Refund
              it, or set it against their next order.
            </p>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-amber-700" />
        </Link>
      )}

      {/* items-start so a short panel does not stretch to match a tall one. */}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Panel
          icon={Truck}
          title="Still to send out"
          subtitle="Confirmed but not marked delivered"
          action={
            <Link
              to="/seller/sales"
              className="text-xs font-bold text-clay hover:underline"
            >
              All sales
            </Link>
          }
        >
          {toDeliver.length === 0 ? (
            <Empty>Nothing is waiting to go out.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {toDeliver.map((sale) => (
                <li key={sale.id}>
                  <Link
                    to={`/seller/sales/${sale.id}`}
                    className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-espresso">
                        {sale.party_name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {sale.sale_number} · {dateLabel(sale.sale_date)}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-black text-espresso">
                      ₹{money(sale.total)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          icon={Wallet}
          title="Who owes you"
          subtitle="Billed to them, not yet received"
          action={
            <Link
              to="/seller/customers"
              className="text-xs font-bold text-clay hover:underline"
            >
              All customers
            </Link>
          }
        >
          {topDues.length === 0 ? (
            <Empty>
              {counts.parties === 0
                ? "Nobody owes you anything yet."
                : "Nobody owes you anything right now."}
            </Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {topDues.map((party) => (
                <li key={party.id}>
                  <Link
                    to={`/seller/customers/${party.id}`}
                    className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-espresso">
                        {party.name}
                      </p>
                      {party.business_name && (
                        <p className="truncate text-xs text-slate-500">
                          {party.business_name}
                        </p>
                      )}
                    </div>
                    <p className="shrink-0 text-sm font-black text-amber-600">
                      ₹{money(party.outstanding)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* items-start so a short panel does not stretch to match a tall one. */}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Panel
          icon={Clock}
          title="Have gone quiet"
          subtitle={`Used to buy, nothing for ${data.quietAfterDays} days`}
        >
          {quiet.length === 0 ? (
            <Empty>
              {/* "Everyone has bought recently" is untrue of an account with
                  nobody in it, so what this says depends on how far along they
                  actually is. */}
              {counts.parties === 0
                ? "Once you add customers, anyone who stops buying shows up here to chase."
                : recentSales.length === 0
                  ? "Once you record sales, anyone who stops buying shows up here to chase."
                  : `Nobody has gone quiet. Customers with no sale for ${data.quietAfterDays} days appear here.`}
            </Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {quiet.map((party) => {
                const digits = String(party.phone || "").replace(/\D/g, "");
                return (
                  <li
                    key={party.id}
                    className="flex items-center justify-between gap-3 px-5 py-3"
                  >
                    <Link
                      to={`/seller/customers/${party.id}`}
                      className="min-w-0 flex-1"
                    >
                      <p className="truncate text-sm font-bold text-espresso">
                        {party.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        Last bought {sinceLabel(party.sale_date)}
                      </p>
                    </Link>
                    {digits && (
                      <a
                        href={`tel:${party.phone}`}
                        className="shrink-0 rounded-lg border border-slate-200 p-2 text-slate-500 transition-colors hover:bg-slate-50 hover:text-clay"
                        aria-label={`Call ${party.name}`}
                      >
                        <Phone className="h-4 w-4" />
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel icon={Package} title="Latest sales" subtitle="Newest first">
          {recentSales.length === 0 ? (
            <Empty>Nothing recorded yet.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recentSales.map((sale) => (
                <li key={sale.id}>
                  <Link
                    to={`/seller/sales/${sale.id}`}
                    className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-espresso">
                        {sale.party_name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {sale.sale_number} · {dateLabel(sale.sale_date)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span
                        className={`hidden rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider sm:inline ${
                          STATUS_STYLES[sale.status] || STATUS_STYLES.draft
                        }`}
                      >
                        {sale.status}
                      </span>
                      <p className="text-sm font-black text-espresso">
                        ₹{money(sale.total)}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <p className="flex items-center gap-2 text-xs text-slate-500">
        <Users className="h-3.5 w-3.5" />
        {counts.parties} {counts.parties === 1 ? "customer" : "customers"} and{" "}
        {counts.items} {counts.items === 1 ? "item" : "items"} on your rate
        list.
      </p>
    </div>
  );
};

export default Overview;

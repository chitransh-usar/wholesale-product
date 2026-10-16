import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  IndianRupee,
  MessageCircle,
  Phone,
  Plus,
  Search,
  Users,
  Wallet,
} from "lucide-react";
import api from "../../utils/axios";
import { toast } from "sonner";
import PartyFormModal from "../../components/PartyFormModal";
import { money } from "../../utils/money";

// "4 days ago" reads faster than a date when scanning a list of customers.
const sinceLabel = (value) => {
  if (!value) return "No sales yet";
  const days = Math.floor(
    (Date.now() - new Date(value).getTime()) / (1000 * 60 * 60 * 24),
  );
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
};

const initialsOf = (name) =>
  String(name || "?")
    .trim()
    .charAt(0)
    .toUpperCase();

// Compact on a phone on purpose. Stacked full-size cards pushed the customer
// list off the first screen, and the list is what they opened the app for.
const StatCard = ({ icon: Icon, label, value, hint }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:rounded-2xl sm:p-5">
    <div className="hidden rounded-xl bg-clay/10 p-2 text-clay sm:inline-flex">
      <Icon className="h-4 w-4" />
    </div>
    <p className="text-[11px] font-semibold leading-tight text-slate-500 sm:mt-4 sm:text-sm">
      {label}
    </p>
    <p className="mt-1 text-base font-black text-espresso sm:text-2xl">{value}</p>
    {hint && (
      <p className="mt-1 hidden text-xs font-medium text-slate-500 sm:block">
        {hint}
      </p>
    )}
  </div>
);

const Parties = () => {
  const [parties, setParties] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  // Bumped after a customer is added, which re-runs the effect below rather
  // than duplicating the fetch in two places.
  const [refreshKey, setRefreshKey] = useState(0);
  const [showInactive, setShowInactive] = useState(false);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const [list, summary] = await Promise.all([
          api.get("/api/parties", {
            params: showInactive ? { includeInactive: 1 } : {},
          }),
          api.get("/api/parties/stats"),
        ]);
        if (!alive) return;
        setParties(list.data || []);
        setStats(summary.data || null);
      } catch (error) {
        console.error("Failed to load customers", error);
        if (alive) toast.error("Could not load your customer list.");
      }
      if (alive) setLoading(false);
    };

    load();
    return () => {
      alive = false;
    };
  }, [refreshKey, showInactive]);

  // Filtering client side keeps typing instant. The server also supports a
  // search parameter for when a book grows past a few hundred names.
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return parties;
    return parties.filter((p) =>
      [p.name, p.business_name, p.phone, p.city]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term)),
    );
  }, [parties, search]);

  const retiredCount = stats
    ? Math.max(0, stats.totalParties - stats.activeParties)
    : 0;

  const handleAdded = (party) => {
    setShowAdd(false);
    toast.success(`${party.name} added to your customer list.`);
    setRefreshKey((key) => key + 1);
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-espresso">My customers</h2>
          <p className="mt-1 text-sm text-slate-500">
            Everyone you sell to, with what they bought and what they still owe.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 rounded-lg bg-espresso px-4 py-2.5 text-sm font-bold text-cream transition-colors hover:bg-clay"
        >
          <Plus className="h-4 w-4" />
          Add customer
        </button>
      </div>

      {stats && (
        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          <StatCard
            icon={Users}
            label="Customers"
            value={stats.activeParties}
            hint={
              stats.totalParties > stats.activeParties
                ? `${stats.totalParties - stats.activeParties} marked inactive`
                : "In your book"
            }
          />
          <StatCard
            icon={IndianRupee}
            label="Total billed"
            value={`₹${money(stats.totalBilled)}`}
            hint="All confirmed sales"
          />
          <StatCard
            icon={Wallet}
            label="Outstanding"
            value={`₹${money(stats.outstanding)}`}
            hint="Billed minus received"
          />
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 sm:px-6">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, phone or city"
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-clay"
            />
          </div>
          <div className="flex items-center gap-4">
            {/* Only offered when they actually has some, so the control does
                not sit there meaning nothing. */}
            {(showInactive || retiredCount > 0) && (
              <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-500">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                  className="h-3.5 w-3.5 accent-clay"
                />
                Show retired
              </label>
            )}
            <p className="text-xs font-semibold text-slate-400">
              {visible.length} of {parties.length}
            </p>
          </div>
        </div>

        {parties.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <Users className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <p className="font-semibold text-espresso">
              Your customer list is empty
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
              Add the shops you sell to. Once they are here, every sale and
              payment you record builds up their history and running balance.
            </p>
            <button
              onClick={() => setShowAdd(true)}
              className="mt-5 rounded-lg bg-clay px-5 py-2.5 text-sm font-bold text-cream transition-colors hover:bg-espresso"
            >
              Add your first customer
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="text-sm text-slate-500">
              No customer matches "{search}".
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {visible.map((party) => {
              const due = Number(party.outstanding || 0);
              return (
                <li key={party.id}>
                  <Link
                    to={`/seller/customers/${party.id}`}
                    className="flex items-center gap-4 px-4 py-4 transition-colors hover:bg-slate-50 sm:px-6"
                  >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-clay/10 text-base font-black text-clay">
                      {initialsOf(party.name)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-espresso">
                        {party.name}
                      </p>
                      <p className="truncate text-xs font-medium text-slate-500">
                        {[party.business_name, party.city]
                          .filter(Boolean)
                          .join(" · ") || "No details added"}
                      </p>
                    </div>

                    <div className="hidden shrink-0 text-right sm:block">
                      <p className="text-xs font-semibold text-slate-400">
                        Last sale
                      </p>
                      <p className="text-xs font-bold text-slate-600">
                        {sinceLabel(party.last_sale_date)}
                      </p>
                    </div>

                    <div className="w-28 shrink-0 text-right">
                      {due > 0 ? (
                        <>
                          <p className="text-sm font-black text-espresso">
                            ₹{money(due)}
                          </p>
                          <p className="text-[11px] font-bold uppercase tracking-wider text-amber-600">
                            Due
                          </p>
                        </>
                      ) : due < 0 ? (
                        // A cancelled sale they had already paid for leaves
                        // them in credit. That is not the same as settled.
                        <>
                          <p className="text-sm font-black text-sky-700">
                            ₹{money(Math.abs(due))}
                          </p>
                          <p className="text-[11px] font-bold uppercase tracking-wider text-sky-700">
                            In credit
                          </p>
                        </>
                      ) : party.last_sale_date ? (
                        <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-600">
                          Settled
                        </p>
                      ) : (
                        // Nothing has been sold to them yet, so there is
                        // nothing to settle. "Settled" here would read as if
                        // they had paid off a bill they never received.
                        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
                          &ndash;
                        </p>
                      )}
                    </div>
                  </Link>

                  {party.phone && (
                    <div className="flex gap-2 px-4 pb-3 sm:hidden">
                      <a
                        href={`tel:${party.phone}`}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 py-1.5 text-xs font-bold text-slate-600"
                      >
                        <Phone className="h-3.5 w-3.5" />
                        Call
                      </a>
                      <a
                        href={`https://wa.me/${String(party.phone).replace(/\D/g, "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 py-1.5 text-xs font-bold text-emerald-700"
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                        WhatsApp
                      </a>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {showAdd && (
        <PartyFormModal
          onClose={() => setShowAdd(false)}
          onSaved={handleAdded}
        />
      )}
    </div>
  );
};

export default Parties;

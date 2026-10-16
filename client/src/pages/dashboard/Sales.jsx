import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Receipt, Truck } from "lucide-react";
import api from "../../utils/axios";
import { toast } from "sonner";
import { money, dateLabel } from "../../utils/money";
import PartyFormModal from "../../components/PartyFormModal";

/**
 * The sales book: what has been sold, newest first.
 *
 * Deliberately the same shape as the Purchases list, down to the two header
 * buttons. The two screens had drifted: Purchases carried Add supplier and
 * Enter a bill, Sales carried nothing at all, because the workspace header
 * used to hold a Record sale button on every screen. That button is gone, so
 * the pair reads the same way round now. Add the party, then write the
 * document, on whichever side of the book you are on.
 */

const STATUS_STYLES = {
  draft: "bg-slate-100 text-slate-600",
  confirmed: "bg-sky-50 text-sky-700",
  delivered: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-rose-50 text-rose-700",
};

const FILTERS = [
  { value: "", label: "All" },
  { value: "confirmed", label: "Confirmed" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

const Sales = () => {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  // Adding a customer from here, as well as from inside the sale form. Same
  // reason Purchases does it: somebody working through a stack adds the new
  // name once and gets on with it.
  const [addingParty, setAddingParty] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { data } = await api.get("/api/sales", {
          params: status ? { status } : {},
        });
        if (alive) setSales(data || []);
      } catch (error) {
        console.error("Failed to load sales", error);
        if (alive) toast.error("Could not load your sales.");
      }
      if (alive) setLoading(false);
    };
    load();
    return () => {
      alive = false;
    };
  }, [status]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black text-espresso">Sales</h2>
          <p className="mt-1 text-sm text-slate-500">
            Everything you have sold, newest first.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setAddingParty(true)}
            className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-espresso transition-colors hover:border-clay hover:text-clay"
          >
            <Plus className="h-4 w-4" />
            Add customer
          </button>
          <Link
            to="/seller/sales/new"
            className="flex items-center gap-2 rounded-lg bg-clay px-4 py-2.5 text-sm font-bold text-cream transition-colors hover:bg-espresso"
          >
            <Plus className="h-4 w-4" />
            Record a sale
          </Link>
        </div>
      </div>

      {addingParty && (
        <PartyFormModal
          onClose={() => setAddingParty(false)}
          onSaved={() => setAddingParty(false)}
        />
      )}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((filter) => (
          <button
            key={filter.value}
            onClick={() => setStatus(filter.value)}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors ${
              status === filter.value
                ? "bg-espresso text-cream"
                : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent" />
          </div>
        ) : sales.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <Receipt className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <p className="font-semibold text-espresso">
              {status ? `No ${status} sales` : "No sales recorded yet"}
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
              {status
                ? "Try a different filter."
                : "Record what you sell and it builds up here, along with each customer's running balance."}
            </p>
            {!status && (
              <Link
                to="/seller/sales/new"
                className="mt-5 inline-block rounded-lg bg-clay px-5 py-2.5 text-sm font-bold text-cream transition-colors hover:bg-espresso"
              >
                Record your first sale
              </Link>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {sales.map((sale) => {
              const due =
                Number(sale.total || 0) - Number(sale.received || 0);
              const settled = sale.status !== "cancelled" && due <= 0;
              return (
                <li key={sale.id}>
                  <Link
                    to={`/seller/sales/${sale.id}`}
                    className="flex items-center gap-4 px-4 py-4 transition-colors hover:bg-slate-50 sm:px-6"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-espresso">
                        {sale.party_name}
                      </p>
                      <p className="truncate text-xs font-medium text-slate-500">
                        {sale.sale_number} · {dateLabel(sale.sale_date)} ·{" "}
                        {sale.line_count}{" "}
                        {Number(sale.line_count) === 1 ? "item" : "items"}
                        {/* Goods already out on a challan, so they can see at a
                            glance which sales have stock away from the godown
                            without opening each one. */}
                        {Number(sale.challan_count) > 0 && (
                          <span className="ml-1.5 inline-flex items-center gap-1 text-amber-700">
                            <Truck className="h-3 w-3" />
                            {sale.challan_count}{" "}
                            {Number(sale.challan_count) === 1
                              ? "challan"
                              : "challans"}
                          </span>
                        )}
                      </p>
                    </div>

                    <span
                      className={`hidden shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider sm:inline ${
                        STATUS_STYLES[sale.status] || STATUS_STYLES.draft
                      }`}
                    >
                      {sale.status}
                    </span>

                    <div className="w-28 shrink-0 text-right">
                      <p className="text-sm font-black text-espresso">
                        ₹{money(sale.total)}
                      </p>
                      {sale.status === "cancelled" ? null : settled ? (
                        <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-600">
                          Paid
                        </p>
                      ) : (
                        <p className="text-[11px] font-bold uppercase tracking-wider text-amber-600">
                          ₹{money(due)} due
                        </p>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default Sales;

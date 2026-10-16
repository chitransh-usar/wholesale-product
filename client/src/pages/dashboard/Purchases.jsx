import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, ShoppingCart, TriangleAlert } from "lucide-react";
import api from "../../utils/axios";
import { toast } from "sonner";
import { money, dateLabel } from "../../utils/money";
import SupplierFormModal from "../../components/SupplierFormModal";

/**
 * The purchase book: bills from suppliers, newest first.
 *
 * Deliberately the same shape as the Sales list, because they are the same
 * kind of list and a wholesaler should not have to learn two. The differences
 * are the two things a purchase has that a sale does not: the supplier's own
 * bill number, which is what they will be asked for, and money owed rather than
 * money to collect.
 */

const STATUS_STYLES = {
  draft: "bg-slate-100 text-slate-600",
  received: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-rose-50 text-rose-700",
};

const FILTERS = [
  { value: "", label: "All" },
  { value: "received", label: "Received" },
  { value: "draft", label: "Draft" },
  { value: "cancelled", label: "Cancelled" },
];

const Purchases = () => {
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  // The migration is applied by hand, so "not set up yet" is a normal state
  // and gets its own screen rather than an error toast.
  const [notSetUp, setNotSetUp] = useState(false);
  // Adding a supplier from here, as well as from inside the bill form.
  // A wholesaler back from the market with a stack of bills adds the new
  // mills first and then enters them, rather than one at a time.
  const [addingSupplier, setAddingSupplier] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { data } = await api.get("/api/purchases", {
          params: status ? { status } : {},
        });
        if (alive) {
          setPurchases(data || []);
          setNotSetUp(false);
        }
      } catch (error) {
        if (error.response?.data?.code === "PURCHASES_NOT_SET_UP") {
          if (alive) setNotSetUp(true);
        } else {
          console.error("Failed to load purchases", error);
          if (alive) toast.error("Could not load your purchases.");
        }
      }
      if (alive) setLoading(false);
    };
    load();
    return () => {
      alive = false;
    };
  }, [status]);

  if (notSetUp) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <TriangleAlert className="mx-auto mb-3 h-10 w-10 text-amber-400" />
        <p className="font-semibold text-espresso">
          The purchase book is not switched on yet
        </p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
          Its tables have not been added to this database. Nothing is lost and
          nothing else is affected.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black text-espresso">Purchases</h2>
          <p className="mt-1 text-sm text-slate-500">
            Bills from your suppliers, and what you still owe on each.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setAddingSupplier(true)}
            className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-espresso transition-colors hover:border-clay hover:text-clay"
          >
            <Plus className="h-4 w-4" />
            Add supplier
          </button>
          <Link
            to="/seller/purchases/new"
            className="flex items-center gap-2 rounded-lg bg-clay px-4 py-2.5 text-sm font-bold text-cream transition-colors hover:bg-espresso"
          >
            <Plus className="h-4 w-4" />
            Enter a bill
          </Link>
        </div>
      </div>

      {addingSupplier && (
        <SupplierFormModal
          onClose={() => setAddingSupplier(false)}
          onSaved={() => setAddingSupplier(false)}
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
        ) : purchases.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <ShoppingCart className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <p className="font-semibold text-espresso">
              {status ? `No ${status} purchases` : "No purchases entered yet"}
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
              {status
                ? "Try a different filter."
                : "Enter the bills your suppliers give you. They build up here, along with what you owe each one."}
            </p>
            {!status && (
              <Link
                to="/seller/purchases/new"
                className="mt-5 inline-block rounded-lg bg-clay px-5 py-2.5 text-sm font-bold text-cream transition-colors hover:bg-espresso"
              >
                Enter your first bill
              </Link>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {purchases.map((purchase) => {
              const due = Number(purchase.total || 0) - Number(purchase.paid || 0);
              const settled = purchase.status !== "cancelled" && due <= 0;
              return (
                <li key={purchase.id}>
                  <Link
                    to={`/seller/purchases/${purchase.id}`}
                    className="flex items-center gap-4 px-4 py-4 transition-colors hover:bg-slate-50 sm:px-6"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-espresso">
                        {purchase.supplier_name}
                      </p>
                      <p className="truncate text-xs font-medium text-slate-500">
                        {purchase.purchase_number} ·{" "}
                        {dateLabel(purchase.purchase_date)} ·{" "}
                        {purchase.line_count}{" "}
                        {Number(purchase.line_count) === 1 ? "item" : "items"}
                        {/* Their bill number, not ours. This is the one a
                            wholesaler is asked for when a return does not
                            match, and it cannot be reconstructed later. */}
                        {purchase.supplier_invoice_number && (
                          <span className="ml-1.5 text-slate-400">
                            · their bill {purchase.supplier_invoice_number}
                          </span>
                        )}
                      </p>
                    </div>

                    <span
                      className={`hidden shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider sm:inline ${
                        STATUS_STYLES[purchase.status] || STATUS_STYLES.draft
                      }`}
                    >
                      {purchase.status}
                    </span>

                    <div className="w-28 shrink-0 text-right">
                      <p className="text-sm font-black text-espresso">
                        ₹{money(purchase.total)}
                      </p>
                      {purchase.status === "cancelled" ? null : settled ? (
                        <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-600">
                          Paid
                        </p>
                      ) : (
                        <p className="text-[11px] font-bold uppercase tracking-wider text-amber-600">
                          ₹{money(due)} owed
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

export default Purchases;

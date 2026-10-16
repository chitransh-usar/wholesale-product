import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Factory, Plus, Search, TriangleAlert } from "lucide-react";
import api from "../../utils/axios";
import { toast } from "sonner";
import { money, dateLabel } from "../../utils/money";
import SupplierFormModal from "../../components/SupplierFormModal";

/**
 * The supplier book, and the money owed to each.
 *
 * The two figures at the top are never netted into one. A wholesaler who owes
 * 80,000 to a mill and has 30,000 sitting on account with an agent does not owe
 * 50,000 to anybody, and showing them that number gets the wrong man paid. Same
 * reasoning as the customer side, written up in services/supplierBalance.js.
 */

const Suppliers = () => {
  const [suppliers, setSuppliers] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notSetUp, setNotSetUp] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null);

  const load = async () => {
    try {
      const [list, totals] = await Promise.all([
        api.get("/api/suppliers"),
        api.get("/api/suppliers/stats"),
      ]);
      setSuppliers(list.data || []);
      setStats(totals.data || null);
      setNotSetUp(false);
    } catch (error) {
      if (error.response?.data?.code === "PURCHASES_NOT_SET_UP") {
        setNotSetUp(true);
      } else {
        console.error("Failed to load suppliers", error);
        toast.error("Could not load your suppliers.");
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    let alive = true;
    Promise.all([api.get("/api/suppliers"), api.get("/api/suppliers/stats")])
      .then(([list, totals]) => {
        if (!alive) return;
        setSuppliers(list.data || []);
        setStats(totals.data || null);
        setLoading(false);
      })
      .catch((error) => {
        if (!alive) return;
        if (error.response?.data?.code === "PURCHASES_NOT_SET_UP") {
          setNotSetUp(true);
        } else {
          console.error("Failed to load suppliers", error);
          toast.error("Could not load your suppliers.");
        }
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Open for a new supplier, or for one being edited.
   *
   * `null` is closed, `"new"` is adding, and a supplier object is editing.
   * The form itself lives in SupplierFormModal now, so this page no longer
   * carries a copy of every field.
   */
  const startEdit = (supplier) => setEditing(supplier);

  const shown = suppliers.filter((supplier) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [supplier.name, supplier.business_name, supplier.phone, supplier.city]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(q));
  });

  if (notSetUp) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <TriangleAlert className="mx-auto mb-3 h-10 w-10 text-amber-400" />
        <p className="font-semibold text-espresso">
          The purchase book is not switched on yet
        </p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
          Its tables have not been added to this database.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black text-espresso">Suppliers</h2>
          <p className="mt-1 text-sm text-slate-500">
            Who you buy from, and what you owe each of them.
          </p>
        </div>
        <button
          onClick={() => setEditing("new")}
          className="flex items-center gap-2 rounded-lg bg-clay px-4 py-2.5 text-sm font-bold text-cream transition-colors hover:bg-espresso"
        >
          <Plus className="h-4 w-4" />
          Add supplier
        </button>
      </div>

      {stats && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              You owe suppliers
            </p>
            <p className="mt-1 text-2xl font-black text-amber-600">
              ₹{money(stats.owedByYou)}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Sitting on account with suppliers
            </p>
            <p className="mt-1 text-2xl font-black text-emerald-600">
              ₹{money(stats.onAccount)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Money of yours they are holding. Kept separate from what you owe
              on purpose: one does not cancel the other, because they are
              different people.
            </p>
          </div>
        </div>
      )}

      {editing && (
        <SupplierFormModal
          supplier={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}

      {suppliers.length > 0 && (
        <div className="relative max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search suppliers"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-clay"
          />
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent" />
          </div>
        ) : shown.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <Factory className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <p className="font-semibold text-espresso">
              {query ? "Nothing matches that" : "No suppliers yet"}
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
              {query
                ? "Try a different search."
                : "Add the mills and agents you buy from. Their bills, and what you owe each, build up here."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shown.map((supplier) => {
              const balance = Number(supplier.balance || 0);
              return (
                <li
                  key={supplier.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-6"
                >
                  <Link
                    to={`/seller/suppliers/${supplier.id}`}
                    className="min-w-0 flex-1"
                  >
                    <p className="truncate text-sm font-bold text-espresso">
                      {supplier.name}
                      {supplier.business_name ? ` (${supplier.business_name})` : ""}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {[supplier.city, supplier.phone].filter(Boolean).join(" · ") ||
                        "No contact details"}
                      {Number(supplier.purchase_count) > 0
                        ? ` · ${supplier.purchase_count} ${
                            Number(supplier.purchase_count) === 1 ? "bill" : "bills"
                          }`
                        : " · no bills yet"}
                      {supplier.last_purchase_on
                        ? ` · last ${dateLabel(supplier.last_purchase_on)}`
                        : ""}
                    </p>
                  </Link>

                  <div className="w-28 shrink-0 text-right">
                    {balance > 0 ? (
                      <>
                        <p className="text-sm font-black text-amber-600">
                          ₹{money(balance)}
                        </p>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          You owe
                        </p>
                      </>
                    ) : balance < 0 ? (
                      <>
                        <p className="text-sm font-black text-emerald-600">
                          ₹{money(-balance)}
                        </p>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          On account
                        </p>
                      </>
                    ) : (
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        Settled
                      </p>
                    )}
                  </div>

                  <button
                    onClick={() => startEdit(supplier)}
                    className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-50"
                  >
                    Edit
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default Suppliers;

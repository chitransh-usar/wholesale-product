import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Package, TrendingDown, TrendingUp, Search, SlidersHorizontal } from "lucide-react";
import api from "../../utils/axios";
import { toast } from "sonner";

const statusClasses = {
  healthy: "bg-emerald-50 text-emerald-700 border-emerald-200",
  low: "bg-amber-50 text-amber-700 border-amber-200",
  warning: "bg-orange-50 text-orange-700 border-orange-200",
  critical: "bg-rose-50 text-rose-700 border-rose-200",
  out_of_stock: "bg-slate-200 text-slate-700 border-slate-300",
};

const summaryLabels = {
  healthy: "Healthy",
  low: "Low stock",
  warning: "Warning",
  critical: "Critical",
  out_of_stock: "Out of stock",
};

const RestockSuggestions = () => {
  const [summary, setSummary] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);

  const fetchSummary = async () => {
    try {
      const { data } = await api.get("/api/restock/summary");
      setSummary(data.summary);
      setProducts(data.products || []);
    } catch (error) {
      console.error("Failed to load restock summary", error);
      toast.error("Could not load restock suggestions.");
    }
  };

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setLoading(true);
      try {
        await fetchSummary();
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    return products.filter((item) => {
      const matchesSearch = !search || item.productName.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = status === "all" || item.forecastStatus === status;
      return matchesSearch && matchesStatus;
    });
  }, [products, search, status]);

  const urgent = useMemo(() => {
    return [...products].filter((item) => ["critical", "warning", "out_of_stock"].includes(item.forecastStatus)).sort((a, b) => (Number(a.predictedDaysRemaining || 999) - Number(b.predictedDaysRemaining || 999)));
  }, [products]);

  const refresh = async () => {
    try {
      await api.post("/api/restock/recalculate");
      await fetchSummary();
      toast.success("Restock suggestions refreshed.");
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not refresh forecasts.");
    }
  };

  if (loading) {
    return <div className="flex min-h-[50vh] items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent" /></div>;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-black text-espresso">Restock Suggestions</h2>
          <p className="mt-1 text-sm text-slate-500">Inventory health and reorder guidance based on real sales history.</p>
        </div>
        <button onClick={refresh} className="rounded-lg bg-espresso px-4 py-2 text-sm font-bold text-cream">Refresh forecasts</button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Object.entries(summaryLabels).map(([key, label]) => {
          const value = summary?.[key] ?? 0;
          return (
            <div key={key} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{label}</p>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusClasses[key]}`}>{value}</span>
              </div>
              <p className="mt-3 text-3xl font-black text-espresso">{value}</p>
            </div>
          );
        })}
      </div>

      {urgent[0] && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-rose-600" />
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-rose-700">Urgent restock</p>
              <h3 className="mt-1 text-xl font-black text-espresso">{urgent[0].productName}</h3>
              <p className="mt-1 text-sm text-rose-700">
                Only {Number.isFinite(urgent[0].predictedDaysRemaining) ? Math.ceil(urgent[0].predictedDaysRemaining) : 0} days of stock left.
                Recommended reorder: {urgent[0].recommendedReorderQuantity} units.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products" className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-clay" />
          </div>
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-slate-500" />
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
              <option value="all">All statuses</option>
              <option value="healthy">Healthy</option>
              <option value="low">Low</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
              <option value="out_of_stock">Out of stock</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-bold">Product</th>
                <th className="px-4 py-3 font-bold">Current Stock</th>
                <th className="px-4 py-3 font-bold">Daily Sales</th>
                <th className="px-4 py-3 font-bold">Days Left</th>
                <th className="px-4 py-3 font-bold">Suggested Reorder</th>
                <th className="px-4 py-3 font-bold">Status</th>
                <th className="px-4 py-3 font-bold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">No products match the current filters.</td></tr>
              ) : filtered.map((item) => (
                <tr key={item.productId} className="border-t border-slate-200 hover:bg-slate-50">
                  <td className="px-4 py-3"><div className="font-bold text-espresso">{item.productName}</div><div className="text-xs text-slate-500">{item.category || "Product"}</div></td>
                  <td className="px-4 py-3 font-medium">{item.currentStock}</td>
                  <td className="px-4 py-3 font-medium">{item.averageDailySales.toFixed(2)}</td>
                  <td className="px-4 py-3 font-medium">{Number.isFinite(item.predictedDaysRemaining) ? Math.ceil(item.predictedDaysRemaining) : "-"}</td>
                  <td className="px-4 py-3 font-medium">{item.recommendedReorderQuantity}</td>
                  <td className="px-4 py-3"><span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase ${statusClasses[item.forecastStatus] || statusClasses.healthy}`}>{summaryLabels[item.forecastStatus] || item.forecastStatus}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">View</button>
                      <button className="rounded-lg bg-clay px-2 py-1 text-xs font-semibold text-white">Restock</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default RestockSuggestions;

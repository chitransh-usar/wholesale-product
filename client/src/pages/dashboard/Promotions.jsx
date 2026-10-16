import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BadgePercent,
  Info,
  Package,
  Pencil,
  Sparkles,
  Tag,
  TrendingDown,
} from "lucide-react";
import api from "../../utils/axios";
import ProductThumb from "../../components/ProductThumb";
import { toast } from "sonner";
import { amount as money } from "../../utils/money";

const StatCard = ({ icon: Icon, label, value, hint }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="inline-flex rounded-xl bg-clay/10 p-2 text-clay">
      <Icon className="w-4 h-4" />
    </div>
    <p className="mt-4 text-sm font-semibold text-slate-500">{label}</p>
    <p className="mt-1 text-2xl font-black text-espresso">{value}</p>
    {hint && <p className="mt-1 text-xs font-medium text-slate-500">{hint}</p>}
  </div>
);

const Promotions = () => {
  const [inventory, setInventory] = useState([]);
  const [flashSales, setFlashSales] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        // Your own listings are the one promotion lever you control today.
        const inv = await api.get("/api/dashboard/inventory");
        setInventory(inv.data || []);
      } catch (error) {
        console.error("Failed to load your products", error);
        toast.error("Could not load your products.");
      }

      try {
        // Marketplace-wide campaigns. Read only: these are set up by the
        // marketplace, not by sellers, so nothing here offers to edit them.
        const flash = await api.get("/api/promotions/flash-sales?active=true");
        setFlashSales(flash.data || []);
      } catch {
        // Optional. A seller with no campaigns must still see their offers.
        setFlashSales([]);
      }

      setLoading(false);
    };

    load();
  }, []);

  const offers = useMemo(
    () =>
      inventory
        .filter(
          (item) =>
            item.discount_price != null &&
            Number(item.discount_price) > 0 &&
            Number(item.discount_price) < Number(item.price),
        )
        .map((item) => ({
          ...item,
          off: Math.round(
            ((Number(item.price) - Number(item.discount_price)) /
              Number(item.price)) *
              100,
          ),
        }))
        .sort((a, b) => b.off - a.off),
    [inventory],
  );

  const liveOffers = offers.filter((item) => item.status === "Active");
  const bestOff = offers.length ? offers[0].off : 0;
  const withoutOffer = inventory.filter(
    (item) => item.status === "Active" && !offers.some((o) => o.id === item.id),
  ).length;

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[50vh]">
        <div className="w-8 h-8 border-4 border-clay border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-black text-espresso">Offers</h2>
        <p className="text-sm text-slate-500 mt-1">
          A bulk price is your offer to buyers. Set one on any product and it
          shows as a discount wherever that product appears.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Tag}
          label="Products on offer"
          value={liveOffers.length}
          hint={`out of ${inventory.filter((i) => i.status === "Active").length} on sale`}
        />
        <StatCard
          icon={TrendingDown}
          label="Biggest discount"
          value={bestOff ? `${bestOff}%` : "-"}
          hint={bestOff ? offers[0].name : "No bulk prices set yet"}
        />
        <StatCard
          icon={Package}
          label="No offer yet"
          value={withoutOffer}
          hint="Products selling at full price"
        />
        <StatCard
          icon={Sparkles}
          label="Marketplace sales"
          value={flashSales.length}
          hint="Campaigns running now"
        />
      </div>

      {/* Your offers */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-6 py-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
            Your offers
          </h3>
          <Link
            to="/seller/products"
            className="text-xs font-bold text-clay hover:text-espresso hover:underline"
          >
            Manage products
          </Link>
        </div>

        {offers.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <BadgePercent className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <p className="font-semibold text-espresso">No offers yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
              Open any product and set a bulk price below your normal price.
              Buyers will see the saving on your product and shop pages.
            </p>
            <Link
              to="/seller/products"
              className="mt-5 inline-block rounded-lg bg-clay px-5 py-2.5 text-sm font-bold text-cream transition-colors hover:bg-espresso"
            >
              Choose a product
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="px-6 py-4 font-bold text-xs uppercase tracking-wider text-slate-500">
                    Product
                  </th>
                  <th className="px-6 py-4 font-bold text-xs uppercase tracking-wider text-slate-500">
                    Normal price
                  </th>
                  <th className="px-6 py-4 font-bold text-xs uppercase tracking-wider text-slate-500">
                    Bulk price
                  </th>
                  <th className="px-6 py-4 font-bold text-xs uppercase tracking-wider text-slate-500">
                    Buyer saves
                  </th>
                  <th className="px-6 py-4 font-bold text-xs uppercase tracking-wider text-slate-500">
                    Status
                  </th>
                  <th className="px-6 py-4 font-bold text-xs uppercase tracking-wider text-slate-500 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {offers.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <ProductThumb src={item.image} alt={item.name} />
                        <div>
                          <p className="font-bold text-espresso text-sm max-w-50 sm:max-w-xs truncate">
                            {item.name}
                          </p>
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mt-0.5">
                            {item.category}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-500 line-through">
                      ₹{money(item.price)}
                    </td>
                    <td className="px-6 py-4 font-bold text-espresso">
                      ₹{money(item.discount_price)}
                    </td>
                    <td className="px-6 py-4">
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                        {item.off}% off
                      </span>
                      <span className="ml-2 text-xs text-slate-500">
                        ₹{money(Number(item.price) - Number(item.discount_price))} per unit
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          item.status === "Active"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        to={`/seller/products/edit/${item.id}`}
                        className="inline-flex p-2 text-slate-500 hover:text-clay hover:bg-clay/10 bg-slate-50 lg:bg-transparent rounded-md transition-colors opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                        title="Change this offer"
                      >
                        <Pencil className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Marketplace campaigns, read only */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
            Marketplace sales
          </h3>
          {flashSales.length > 0 && (
            <span className="rounded-full bg-amber-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-700">
              Running now
            </span>
          )}
        </div>

        {flashSales.length === 0 ? (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <p className="text-sm text-slate-600">
              No marketplace sales are running. These are set up by the
              marketplace, not by sellers, so there is nothing to do here.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {flashSales.map((sale) => (
              <div
                key={sale.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4"
              >
                <div className="min-w-0">
                  <p className="font-bold text-espresso">{sale.name}</p>
                  {sale.description && (
                    <p className="text-sm text-slate-500">{sale.description}</p>
                  )}
                </div>
                <span className="rounded-full bg-clay px-3 py-1 text-sm font-bold text-cream">
                  {sale.discount_type === "percentage"
                    ? `${sale.discount_value}% off`
                    : `₹${money(sale.discount_value)} off`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Promotions;

import { Boxes, MapPin, Store } from "lucide-react";

/**
 * Supply-side snapshot for the marketplace home.
 *
 * Replaces the old "market alert", which announced rising demand in a
 * category and region. That banner both carried hardcoded figures and told
 * buyers exactly where demand was climbing - the one signal a demand-based
 * pricing strategy should not broadcast. These figures are counted from the
 * live catalogue and say nothing about price direction.
 */
const MarketSnapshot = ({ products = [], region }) => {
  const productCount = products.length;

  const supplierCount = new Set(
    products.flatMap((p) =>
      (p.suppliers || [])
        .map((s) => s.supplierId ?? s.id)
        .filter(Boolean)
        .map(String),
    ),
  ).size;

  const categoryCount = new Set(
    products.map((p) => p.category).filter(Boolean),
  ).size;

  if (productCount === 0) return null;

  const Stat = ({ icon: Icon, value, label }) => (
    <div className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-clay/10 text-clay">
        <Icon className="h-4 w-4" strokeWidth={2.5} />
      </span>
      <div className="leading-tight">
        <p className="text-sm font-black text-espresso">{value}</p>
        <p className="text-[10px] font-bold uppercase tracking-wider text-espresso/40">
          {label}
        </p>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-slate-200 border-l-4 border-l-clay bg-white p-4 shadow-sm transition-shadow duration-200 hover:shadow-md sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Stat icon={Boxes} value={productCount} label="Products listed" />
        <Stat
          icon={Store}
          value={supplierCount}
          label={supplierCount === 1 ? "Wholesaler" : "Wholesalers"}
        />
        <Stat icon={Boxes} value={categoryCount} label="Categories" />
      </div>

      {/* This used to read "Delivering to Delhi NCR" on every screen in the
          country, with nothing behind it: no seller had said they delivers
          there and no code worked it out. It now says where the sellers
          counted above actually are, which is a fact the page already holds. */}
      <p className="flex items-center gap-1.5 text-xs font-semibold text-espresso/50">
        <MapPin className="h-3.5 w-3.5 text-clay" />
        {region ? `Sellers in ${region}` : "Sellers from all over India"}
      </p>
    </div>
  );
};

export default MarketSnapshot;

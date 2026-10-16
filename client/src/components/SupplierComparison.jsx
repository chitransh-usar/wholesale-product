import { useMemo, useState } from "react";
import {
  Search,
  ShieldCheck,
  Sparkles,
  ArrowUpDown,
  Filter,
  Star,
  Clock,
  Package,
} from "lucide-react";
import PropTypes from "prop-types";
import {
  filterSuppliers,
  getBestSupplierMetrics,
  sortSuppliers,
} from "../utils/supplierUtils";
import SupplierComparisonRow from "./SupplierComparisonRow";
import SupplierCard from "./SupplierCard";
import SupplierComparisonModal from "./SupplierComparisonModal";

const SORT_OPTIONS = [
  { value: "price-asc", label: "Price: Low → High" },
  { value: "price-desc", label: "Price: High → Low" },
  { value: "highest-rated", label: "Highest Rated" },
  { value: "lowest-moq", label: "Lowest MOQ" },
  { value: "fastest-shipping", label: "Fastest Shipping" },
  { value: "highest-stock", label: "Highest Stock" },
  { value: "most-delivered", label: "Most Orders Delivered" },
];

const SupplierComparison = ({ product, onAddToCart, onContactSupplier }) => {
  const [sortBy, setSortBy] = useState("price-asc");
  const [search, setSearch] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [gstVerifiedOnly, setGstVerifiedOnly] = useState(false);
  const [maxMOQ, setMaxMOQ] = useState("");
  const [maxShipping, setMaxShipping] = useState("");
  const [minRating, setMinRating] = useState(0);
  const [selectedSupplierIds, setSelectedSupplierIds] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);

  const filters = useMemo(
    () => ({
      search,
      verifiedOnly,
      gstVerifiedOnly,
      maxMOQ: maxMOQ === "" ? 0 : Number(maxMOQ),
      maxShipping: maxShipping === "" ? 0 : Number(maxShipping),
      minRating,
    }),
    [search, verifiedOnly, gstVerifiedOnly, maxMOQ, maxShipping, minRating],
  );

  const filteredSuppliers = useMemo(() => {
    return sortSuppliers(filterSuppliers(product.suppliers, filters), sortBy);
  }, [product.suppliers, filters, sortBy]);

  const metrics = useMemo(
    () => getBestSupplierMetrics(filteredSuppliers),
    [filteredSuppliers],
  );

  const selectedSuppliers = useMemo(
    () =>
      filteredSuppliers.filter((supplier) =>
        selectedSupplierIds.includes(supplier.id),
      ),
    [filteredSuppliers, selectedSupplierIds],
  );

  const toggleSelect = (id) => {
    setSelectedSupplierIds((prev) => {
      if (prev.includes(id)) return prev.filter((item) => item !== id);
      if (prev.length >= 3) return prev;
      return [...prev, id];
    });
  };

  const handleCompare = () => {
    if (selectedSuppliers.length < 2) return;
    setModalOpen(true);
  };

  const handleBuyNow = (supplier) => {
    onAddToCart(product, supplier.moq, supplier);
  };

  const handleContact = (supplier) => {
    onContactSupplier(supplier);
  };

  const getSupplierName = (id) => {
    if (!id) return "-";
    const supplier = product.suppliers.find((s) => s.id === id);
    if (!supplier) return "-";
    return (
      supplier.companyName || supplier.company_name || supplier.name || "-"
    );
  };

  const insightCards = [
    {
      label: "Best Price",
      value: getSupplierName(metrics.lowestPriceId),
      color: "text-emerald-700",
      bg: "bg-emerald-50",
      border: "border-emerald-200",
      icon: <Sparkles className="w-4 h-4 text-emerald-600" />,
    },
    {
      label: "Fastest Shipping",
      value: getSupplierName(metrics.fastestShippingId),
      color: "text-sky-700",
      bg: "bg-sky-50",
      border: "border-sky-200",
      icon: <Clock className="w-4 h-4 text-sky-600" />,
    },
    {
      label: "Top Rated",
      value: getSupplierName(metrics.highestRatingId),
      color: "text-amber-700",
      bg: "bg-amber-50",
      border: "border-amber-200",
      icon: <Star className="w-4 h-4 text-amber-600" />,
    },
    {
      label: "Lowest MOQ",
      value: getSupplierName(metrics.lowestMOQId),
      color: "text-violet-700",
      bg: "bg-violet-50",
      border: "border-violet-200",
      icon: <Package className="w-4 h-4 text-violet-600" />,
    },
  ];

  return (
    <section className=" bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
      <div className="p-5 sm:p-6 border-b border-slate-200 bg-slate-50/50">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-6 h-px bg-clay"></span>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 font-mono">
                Vendor Analysis
              </p>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 leading-tight">
              Compare Suppliers
            </h2>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-slate-500">
              Evaluate {filteredSuppliers.length} available vendors based on
              pricing, minimum order quantities, and performance metrics to find
              your ideal partner.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0 mt-2 md:mt-0">
            <button
              type="button"
              disabled={selectedSuppliers.length < 2}
              onClick={handleCompare}
              className="group flex items-center justify-center gap-2 rounded-md bg-clay px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-sm transition-all hover:bg-clay/90 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none disabled:border disabled:border-slate-200"
            >
              Compare
              {selectedSuppliers.length > 0 && (
                <span className="flex h-4 w-4 items-center justify-center rounded-sm bg-white/20 text-[10px] group-disabled:bg-slate-200 group-disabled:text-slate-500">
                  {selectedSuppliers.length}
                </span>
              )}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-6">
          {insightCards.map((card) => (
            <div
              key={card.label}
              className={`rounded-lg border ${card.border} ${card.bg} p-3 flex flex-col justify-between overflow-hidden`}
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  {card.label}
                </p>
                {card.icon}
              </div>
              <p
                className={`font-mono text-base sm:text-lg font-black truncate ${card.color}`}
                title={card.value !== "-" ? card.value : undefined}
              >
                {card.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="p-4 sm:p-5 border-b border-slate-200 bg-white flex flex-col xl:flex-row gap-4 xl:items-center justify-between">
        <div className="relative w-full xl:max-w-xs shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search vendor name or location..."
            className="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-clay focus:ring-1 focus:ring-clay"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full">
          <div className="relative flex items-center shrink-0">
            <ArrowUpDown className="absolute left-2.5 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="appearance-none rounded-md border border-slate-300 bg-white py-2 pl-8 pr-8 text-sm font-medium text-slate-700 outline-none transition focus:border-clay focus:ring-1 focus:ring-clay cursor-pointer"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="w-px h-6 bg-slate-200 mx-1 hidden sm:block"></div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setVerifiedOnly(!verifiedOnly)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-md border text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                verifiedOnly
                  ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                  : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100"
              }`}
            >
              <ShieldCheck
                className={`w-3.5 h-3.5 ${verifiedOnly ? "text-emerald-600" : "text-slate-400"}`}
              />
              Verified
            </button>

            <button
              onClick={() => setGstVerifiedOnly(!gstVerifiedOnly)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-md border text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                gstVerifiedOnly
                  ? "bg-blue-50 border-blue-200 text-blue-700"
                  : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100"
              }`}
            >
              GST
            </button>
          </div>

          <div className="w-px h-6 bg-slate-200 mx-1 hidden md:block"></div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center border border-slate-300 rounded-md bg-white overflow-hidden focus-within:border-clay focus-within:ring-1 focus-within:ring-clay transition-all">
              <span className="px-2.5 py-2 text-xs font-bold uppercase tracking-wider text-slate-500 bg-slate-50 border-r border-slate-200 select-none">
                Max MOQ
              </span>
              <input
                type="number"
                min="0"
                placeholder="Any"
                value={maxMOQ}
                onChange={(e) => setMaxMOQ(e.target.value)}
                className="w-20 px-2 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>

            <div className="flex items-center border border-slate-300 rounded-md bg-white overflow-hidden focus-within:border-clay focus-within:ring-1 focus-within:ring-clay transition-all">
              <span className="px-2.5 py-2 text-xs font-bold uppercase tracking-wider text-slate-500 bg-slate-50 border-r border-slate-200 select-none">
                Max Days
              </span>
              <input
                type="number"
                min="0"
                placeholder="Any"
                value={maxShipping}
                onChange={(e) => setMaxShipping(e.target.value)}
                className="w-16 px-2 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>

            <div className="flex items-center border border-slate-300 rounded-md bg-white overflow-hidden focus-within:border-clay focus-within:ring-1 focus-within:ring-clay transition-all">
              <span className="px-2.5 py-2 text-xs font-bold uppercase tracking-wider text-slate-500 bg-slate-50 border-r border-slate-200 select-none">
                Min Rating
              </span>
              <select
                value={minRating}
                onChange={(e) => setMinRating(Number(e.target.value))}
                className="cursor-pointer bg-white px-2 py-2 text-sm text-slate-900 outline-none"
              >
                <option value={0}>Any</option>
                <option value={3}>3+</option>
                <option value={4}>4+</option>
                <option value={4.5}>4.5+</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="hidden md:block overflow-x-auto bg-white">
        <table className="min-w-full text-left text-sm border-collapse">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80">
              {[
                "Supplier",
                "Status",
                "Rating",
                "Reviews",
                "Price",
                "MOQ",
                "Stock",
                "Shipping",
                "Location",
                "Delivered",
                "",
              ].map((heading, idx) => (
                <th
                  key={idx}
                  className="whitespace-nowrap px-4 py-3 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500 font-mono"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredSuppliers.length > 0 ? (
              filteredSuppliers.map((supplier) => (
                <SupplierComparisonRow
                  key={supplier.id}
                  supplier={supplier}
                  isSelected={selectedSupplierIds.includes(supplier.id)}
                  onToggleSelect={toggleSelect}
                  productName={product.name}
                  onBuyNow={handleBuyNow}
                  badges={{
                    lowestPrice: metrics.lowestPriceId === supplier.id,
                    lowestMOQ: metrics.lowestMOQId === supplier.id,
                    highestRating: metrics.highestRatingId === supplier.id,
                    fastestShipping: metrics.fastestShippingId === supplier.id,
                    mostDelivered: metrics.mostDeliveredId === supplier.id,
                    highestStock: metrics.highestStockId === supplier.id,
                  }}
                />
              ))
            ) : (
              <tr>
                <td
                  colSpan={11}
                  className="py-12 text-center text-slate-500 text-sm"
                >
                  <Filter className="w-8 h-8 mx-auto mb-3 text-slate-300" />
                  No suppliers match your current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="p-4 grid gap-3 md:hidden bg-slate-50">
        {filteredSuppliers.length > 0 ? (
          filteredSuppliers.map((supplier) => (
            <SupplierCard
              key={supplier.id}
              supplier={supplier}
              isSelected={selectedSupplierIds.includes(supplier.id)}
              onToggleSelect={toggleSelect}
              productName={product.name}
              onBuyNow={handleBuyNow}
              badges={{
                lowestPrice: metrics.lowestPriceId === supplier.id,
                lowestMOQ: metrics.lowestMOQId === supplier.id,
                highestRating: metrics.highestRatingId === supplier.id,
                fastestShipping: metrics.fastestShippingId === supplier.id,
                mostDelivered: metrics.mostDeliveredId === supplier.id,
                highestStock: metrics.highestStockId === supplier.id,
              }}
            />
          ))
        ) : (
          <div className="py-10 text-center text-slate-500 text-sm border border-dashed border-slate-300 rounded-lg bg-white">
            <Filter className="w-6 h-6 mx-auto mb-2 text-slate-300" />
            No suppliers found.
          </div>
        )}
      </div>

      <SupplierComparisonModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        suppliers={selectedSuppliers}
        metrics={metrics}
        onBuyNow={handleBuyNow}
        onContact={handleContact}
      />
    </section>
  );
};

SupplierComparison.propTypes = {
  product: PropTypes.shape({
    name: PropTypes.string,
    suppliers: PropTypes.arrayOf(PropTypes.object).isRequired,
  }).isRequired,
  onAddToCart: PropTypes.func.isRequired,
  onContactSupplier: PropTypes.func,
};

SupplierComparison.defaultProps = {
  onContactSupplier: () => {},
};

export default SupplierComparison;

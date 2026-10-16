import { useState, useEffect, useRef } from "react";
import { useSearchParams, Link } from "react-router-dom";
import {
  Search,
  SlidersHorizontal,
  Package,
  Store,
  Grid3X3,
  List,
  ArrowUpDown,
  CheckCircle,
  Sparkles,
  X,
} from "lucide-react";
import gsap from "gsap";
import { ScrollToPlugin } from "gsap/all";
import api from "../utils/axios"; // Your backend API
import { money } from "../utils/money";
import { useLocationFilter } from "../context/LocationContext";

/**
 * Star ratings used to live on this page and were removed.
 *
 * Every card showed 4.5. The catalogue endpoint this page reads,
 * getPublicCatalog, does not select a rating at all, so `supplier.rating`
 * was always undefined and `|| 4.5` turned that into a number for
 * everything on screen. The sort and the "min rating" filter then ordered
 * and hid results by a constant, and anything at 4.8 or over was badged a
 * Top Pick, which nothing ever was.
 *
 * Real ratings do exist: seller_reviews, averaged by getProductById and
 * getWholesalerById, and shown on the product and wholesaler pages where a
 * seller with no reviews honestly reads zero. If search is to rank on that,
 * the average has to be joined into getPublicCatalog first. Until then this
 * page shows what it actually knows.
 */

gsap.registerPlugin(ScrollToPlugin);

const SearchResults = () => {
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q") || "";

  const [activeTab, setActiveTab] = useState("product");
  const [viewMode, setViewMode] = useState("grid");
  const [sortBy, setSortBy] = useState("relevance");
  const [filters, setFilters] = useState({
    category: "",
    minPrice: "",
    maxPrice: "",
  });
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false);

  // Live Database State
  const [fullData, setFullData] = useState({
    products: [],
    wholesalers: [],
    categories: [],
  });
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [initialFetchDone, setInitialFetchDone] = useState(false);
  const resultsRef = useRef(null);

  const { cityParam, label: cityLabel, setCity } = useLocationFilter();

  // 1. Fetch live catalog and build searchable arrays on mount
  useEffect(() => {
    const fetchLiveCatalog = async () => {
      try {
        const res = await api.get("/api/products", {
          params: cityParam ? { city: cityParam } : {},
        });
        const dbProducts = res.data;

        const mappedProducts = [];
        const vendorMap = {};
        const categorySet = new Set();

        dbProducts.forEach((product) => {
          categorySet.add(product.category);
          const bestSupplier = product.suppliers?.[0] || {};
          const sName =
            bestSupplier.companyName ||
            bestSupplier.name ||
            "Verified Supplier";

          // Map Product Format
          mappedProducts.push({
            id: product.id.toString(),
            type: "product",
            name: product.name,
            image: product.image,
            category: product.category,
            vendorId: bestSupplier.id,
            vendorName: sName,
            location: bestSupplier.city || "India",
            verified: bestSupplier.verified || false,
            price: Number(product.starting_price || bestSupplier.price || 0),
            bulkPrice: Number(bestSupplier.discountPrice || 0),
            moq: `${bestSupplier.moq || 1} units`,
            stock: Number(bestSupplier.stock || 0),
            shippingDays: Number(bestSupplier.shippingDays || 0),
            supplySignal:
              Number(bestSupplier.stock || 0) > 1000
                ? "High supply"
                : Number(bestSupplier.stock || 0) > 300
                  ? "Moderate"
                  : "Low stock",
          });

          // Map Unique Wholesalers.
          // Key on the seller's user id, not supplier.id - that is the
          // inventory row id, so one seller listing five products produced
          // five duplicate "wholesalers".
          product.suppliers?.forEach((supplier) => {
            const vName = supplier.companyName || supplier.name || "Supplier";
            const vendorId = supplier.supplierId ?? supplier.id;
            if (!vendorId) return;
            vendorMap[vendorId] = {
              id: vendorId,
              type: "wholesaler",
              name: vName,
              location: supplier.city || "India",
              category: product.category,
              verified: supplier.verified || false,
              logo: `https://ui-avatars.com/api/?name=${encodeURIComponent(vName)}&background=random`,
            };
          });
        });

        setFullData({
          products: mappedProducts,
          wholesalers: Object.values(vendorMap),
          categories: Array.from(categorySet),
        });
      } catch (err) {
        console.error("Error fetching search catalog:", err);
      } finally {
        setInitialFetchDone(true);
      }
    };

    fetchLiveCatalog();
  }, [cityParam]);

  // 2. Local filtering over the live data
  useEffect(() => {
    if (!initialFetchDone) return;

    setLoading(true);
    const timer = setTimeout(() => {
      let data =
        activeTab === "product" ? fullData.products : fullData.wholesalers;

      if (query) {
        const lowerQuery = query.toLowerCase();
        data = data.filter((item) => {
          if (activeTab === "product") {
            return (
              item.name.toLowerCase().includes(lowerQuery) ||
              item.vendorName.toLowerCase().includes(lowerQuery) ||
              item.category.toLowerCase().includes(lowerQuery)
            );
          } else {
            return (
              item.name.toLowerCase().includes(lowerQuery) ||
              item.location.toLowerCase().includes(lowerQuery) ||
              item.category.toLowerCase().includes(lowerQuery)
            );
          }
        });
      }

      if (filters.category) {
        data = data.filter((item) => item.category === filters.category);
      }
      if (activeTab === "product") {
        if (filters.minPrice) {
          data = data.filter(
            (item) => item.price >= parseFloat(filters.minPrice),
          );
        }
        if (filters.maxPrice) {
          data = data.filter(
            (item) => item.price <= parseFloat(filters.maxPrice),
          );
        }
      }
      if (sortBy === "price-asc") data.sort((a, b) => a.price - b.price);
      else if (sortBy === "price-desc") data.sort((a, b) => b.price - a.price);

      setResults(data);
      setLoading(false);
    }, 400);

    return () => clearTimeout(timer);
  }, [query, activeTab, filters, sortBy, fullData, initialFetchDone]);

  // ---- Scroll to top ----
  useEffect(() => {
    gsap.to(window, {
      duration: 0.6,
      scrollTo: 0,
      ease: "power2.inOut",
    });
  }, [query]);

  // No entrance animation for result cards. GSAP writes inline opacity on the
  // nodes, and because React reuses those nodes as the list re-renders while
  // filtering, cards were left mid-fade (most visibly a few items down the
  // list). Results now render immediately.

  // One copy of the controls, shown in the sidebar on a wide screen and in the
  // drawer on a narrow one. The sidebar is hidden below the sm breakpoint, so
  // without the drawer a phone has the Filters button and nothing behind it.
  const isProductTab = activeTab === "product";
  const clearFilters = () =>
    setFilters({ category: "", minPrice: "", maxPrice: "" });

  const filterControls = (
    <>
      <div>
        <label className="block text-sm font-medium text-espresso/70 mb-1">
          Category
        </label>
        <select
          value={filters.category}
          onChange={(e) => setFilters({ ...filters, category: e.target.value })}
          className="w-full bg-white/80 border border-sage/30 rounded-xl py-2 px-3 text-sm text-espresso focus:ring-2 focus:ring-clay outline-none"
        >
          <option value="">All Categories</option>
          {fullData.categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>

      {isProductTab && (
        <div>
          <label className="block text-sm font-medium text-espresso/70 mb-1">
            Price Range
          </label>
          <div className="flex gap-2">
            <input
              type="number"
              placeholder="Min"
              value={filters.minPrice}
              onChange={(e) =>
                setFilters({ ...filters, minPrice: e.target.value })
              }
              className="w-1/2 bg-white/80 border border-sage/30 rounded-xl py-2 px-3 text-sm text-espresso outline-none focus:border-clay"
            />
            <input
              type="number"
              placeholder="Max"
              value={filters.maxPrice}
              onChange={(e) =>
                setFilters({ ...filters, maxPrice: e.target.value })
              }
              className="w-1/2 bg-white/80 border border-sage/30 rounded-xl py-2 px-3 text-sm text-espresso outline-none focus:border-clay"
            />
          </div>
        </div>
      )}

      <button
        onClick={clearFilters}
        className="w-full py-2.5 bg-clay/10 text-clay text-sm font-medium rounded-xl hover:bg-clay/20 transition-colors cursor-pointer"
      >
        Clear All Filters
      </button>
    </>
  );

  if (!query && initialFetchDone) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <Search className="w-20 h-20 text-espresso/20 mb-6" strokeWidth={1.5} />
        <h2 className="text-3xl font-bold text-espresso tracking-tight">
          What are you looking for?
        </h2>
        <p className="text-espresso/60 mt-2 max-w-md">
          Enter a product name, wholesaler, or category in the search bar above
          to get started.
        </p>
        <div className="mt-6 flex flex-wrap gap-2 justify-center">
          {["Packaging", "Raw Materials", "Hardware", "Electronics"].map(
            (suggestion) => (
              <Link
                key={suggestion}
                to={`/search?q=${suggestion}`}
                className="px-4 py-2 bg-white/60 backdrop-blur-sm border border-sage/30 rounded-full text-sm text-espresso hover:bg-clay hover:text-cream transition-colors"
              >
                {suggestion}
              </Link>
            ),
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="min-h-screen py-6 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            {/* Left side - result count */}
            <div className="flex items-center gap-3">
              <h1 className="text-xl sm:text-2xl font-bold text-espresso tracking-tight">
                {loading ? (
                  "Searching..."
                ) : (
                  <>
                    <span className="text-clay font-extrabold">
                      {results.length}
                    </span>{" "}
                    result{results.length !== 1 ? "s" : ""} for{" "}
                    <span className="bg-clay/10 px-2 py-0.5 rounded-md text-clay">
                      "{query}"
                    </span>
                  </>
                )}
              </h1>
              {!loading && results.length > 0 && (
                <Sparkles className="w-5 h-5 text-yellow-500 animate-pulse" />
              )}
            </div>

            {/* Right side - controls */}
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              {/* View toggle */}
              <div className="flex bg-white/60 backdrop-blur-sm rounded-lg border border-sage/30 p-0.5 shadow-sm">
                <button
                  onClick={() => setViewMode("grid")}
                  className={`p-1.5 rounded-md transition-all ${
                    viewMode === "grid"
                      ? "bg-clay text-cream shadow-sm"
                      : "text-espresso/60 hover:text-espresso hover:bg-white/50"
                  }`}
                >
                  <Grid3X3 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode("list")}
                  className={`p-1.5 rounded-md transition-all ${
                    viewMode === "list"
                      ? "bg-clay text-cream shadow-sm"
                      : "text-espresso/60 hover:text-espresso hover:bg-white/50"
                  }`}
                >
                  <List className="w-4 h-4" />
                </button>
              </div>

              {/* Sort dropdown */}
              <div className="relative">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="appearance-none bg-white/60 backdrop-blur-sm border border-sage/30 rounded-lg py-1.5 pl-3 pr-8 text-sm text-espresso focus:ring-2 focus:ring-clay focus:border-clay outline-none shadow-sm"
                >
                  <option value="relevance">Relevance</option>
                  <option value="price-asc">Price: Low → High</option>
                  <option value="price-desc">Price: High → Low</option>
                </select>
                <ArrowUpDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-espresso/40 pointer-events-none" />
              </div>

              {/* Filter button (mobile) - opens drawer */}
              <button
                onClick={() => setIsFilterDrawerOpen(true)}
                className="flex items-center gap-1.5 bg-white/60 backdrop-blur-sm border border-sage/30 rounded-lg px-3 py-1.5 text-sm text-espresso shadow-sm sm:hidden"
              >
                <SlidersHorizontal className="w-4 h-4" />
                Filters
              </button>
            </div>
          </div>

          <div className="flex border-b border-sage/30 mb-6">
            <button
              onClick={() => setActiveTab("product")}
              className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-all ${
                activeTab === "product"
                  ? "border-clay text-espresso font-semibold"
                  : "border-transparent text-espresso/50 hover:text-espresso hover:border-sage/20"
              }`}
            >
              <Package className="w-4 h-4" />
              Products
            </button>
            <button
              onClick={() => setActiveTab("wholesaler")}
              className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-all ${
                activeTab === "wholesaler"
                  ? "border-clay text-espresso font-semibold"
                  : "border-transparent text-espresso/50 hover:text-espresso hover:border-sage/20"
              }`}
            >
              <Store className="w-4 h-4" />
              Wholesalers
            </button>
          </div>

          <div className="flex gap-6">
            {/* Filters Sidebar */}
            <aside className="h-fit hidden sm:block w-72 shrink-0 space-y-5 bg-white/60 backdrop-blur-lg rounded-2xl p-5 border border-sage/20 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-espresso flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4 text-clay" />
                  Filters
                </h3>
              </div>

              {filterControls}
            </aside>

            {/* Results area */}
            <div className="flex-1" ref={resultsRef}>
              {loading ? (
                <div className="flex justify-center items-center h-64">
                  <div className="animate-spin rounded-full h-14 w-14 border-4 border-clay/20 border-t-clay"></div>
                </div>
              ) : results.length === 0 ? (
                <div className="text-center py-16">
                  <div className="text-7xl mb-4">🔍</div>
                  <h3 className="text-2xl font-bold text-espresso">
                    No results found
                  </h3>
                  <p className="text-espresso/60 mt-2 max-w-md mx-auto">
                    We couldn't find anything matching "{query}".
                    {/* The city is a filter the buyer set in the navbar, far
                        from here. Say so, or they blame the search. */}
                    {cityParam
                      ? ` You are only being shown sellers in ${cityLabel}.`
                      : " Try adjusting your filters or search for something else."}
                  </p>
                  <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                    {cityParam && (
                      <button
                        onClick={() => setCity(null)}
                        className="bg-clay text-cream px-6 py-2.5 rounded-xl hover:bg-clay/90 transition-colors shadow-lg cursor-pointer"
                      >
                        Search all of India
                      </button>
                    )}
                    <button
                      onClick={() =>
                        setFilters({
                          category: "",
                          minPrice: "",
                          maxPrice: "",
                        })
                      }
                      className={`px-6 py-2.5 rounded-xl transition-colors cursor-pointer ${
                        cityParam
                          ? "border border-sage/40 text-espresso hover:border-clay hover:text-clay"
                          : "bg-clay text-cream hover:bg-clay/90 shadow-lg"
                      }`}
                    >
                      Clear all filters
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    className={
                      viewMode === "grid"
                        ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"
                        : "space-y-4"
                    }
                  >
                    {results.map((item) => (
                      <ResultCard
                        key={item.id}
                        item={item}
                        viewMode={viewMode}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Filter drawer, phones only. The Filters button called a setter that
          was never declared, so tapping it threw a ReferenceError and the
          sidebar it was meant to open is hidden below sm anyway. */}
      {isFilterDrawerOpen && (
        <div className="fixed inset-0 z-50 sm:hidden">
          <button
            aria-label="Close filters"
            onClick={() => setIsFilterDrawerOpen(false)}
            className="absolute inset-0 bg-espresso/40 backdrop-blur-sm"
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-2xl bg-cream p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-semibold text-espresso">
                <SlidersHorizontal className="h-4 w-4 text-clay" />
                Filters
              </h3>
              <button
                aria-label="Close filters"
                onClick={() => setIsFilterDrawerOpen(false)}
                className="rounded-lg p-1.5 text-espresso/60 hover:bg-sage/10 hover:text-espresso"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-5">{filterControls}</div>
            <button
              onClick={() => setIsFilterDrawerOpen(false)}
              className="mt-5 w-full rounded-xl bg-clay py-2.5 text-sm font-bold text-cream"
            >
              Show results
            </button>
          </div>
        </div>
      )}
    </>
  );
};

const ResultCard = ({ item, viewMode }) => {
  const isProduct = item.type === "product";
  // Convert ID to string to ensure safe routing
  const linkTo = `/${isProduct ? "product" : "wholesaler"}/${item.id.toString()}`;

  const SupplyBadge = ({ signal }) => {
    const colorMap = {
      "High supply": "text-green-700 bg-green-100",
      Moderate: "text-yellow-700 bg-yellow-100",
      "Low stock": "text-red-700 bg-red-100",
      "In stock": "text-blue-700 bg-blue-100",
    };
    return (
      <span
        className={`px-2.5 py-0.5 text-xs rounded-full font-medium ${colorMap[signal] || "bg-gray-100 text-gray-700"}`}
      >
        {signal}
      </span>
    );
  };

  if (viewMode === "grid") {
    return (
      <Link
        to={linkTo}
        className="result-card group relative bg-white/80 backdrop-blur-sm rounded-2xl overflow-hidden border border-sage/20 shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1.5 hover:border-clay/30"
      >
        <div className="aspect-square bg-sage/10 flex items-center justify-center overflow-hidden">
          <img
            src={isProduct ? item.image : item.logo}
            alt={item.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        </div>
        <div className="p-4">
          <div className="flex items-start justify-between gap-2">
            <h4 className="font-semibold text-espresso group-hover:text-clay transition-colors line-clamp-1 text-base">
              {item.name}
            </h4>
            {item.verified && (
              <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
            )}
          </div>

          {isProduct ? (
            <div className="">
              <p className="text-sm text-espresso/60 mt-0.5">
                {item.vendorName}
              </p>
              <div className="flex items-center gap-2 mt-2.5">
                <SupplyBadge signal={item.supplySignal} />
              </div>
              <div className="flex items-center justify-between mt-2">
                <p className="text-base font-bold text-espresso">
                  {money(item.price)}
                </p>
                {item.bulkPrice > 0 && (
                  <p className="text-xs text-espresso/50 bg-sage/10 px-2 py-0.5 rounded-full">
                    Bulk: {money(item.bulkPrice)}
                  </p>
                )}
              </div>
              <p className="text-xs text-espresso/40 mt-1">MOQ: {item.moq}</p>
            </div>
          ) : (
            <>
              <p className="text-sm text-espresso/60 mt-0.5">{item.location}</p>
            </>
          )}
        </div>
      </Link>
    );
  }

  // List view
  return (
    <Link
      to={linkTo}
      className="result-card group flex items-start gap-5 bg-white/80 backdrop-blur-sm rounded-2xl p-4 border border-sage/20 shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-0.5"
    >
      <div className="w-24 h-24 shrink-0 bg-sage/10 rounded-xl overflow-hidden">
        <img
          src={isProduct ? item.image : item.logo}
          alt={item.name}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between">
          <h4 className="font-semibold text-espresso group-hover:text-clay transition-colors line-clamp-1 text-lg">
            {item.name}
          </h4>
          <div className="flex items-center gap-1.5">
            {item.verified && (
              <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
            )}
          </div>
        </div>

        {isProduct ? (
          <>
            <p className="text-sm text-espresso/60">{item.vendorName}</p>
            <div className="flex flex-wrap items-center gap-4 mt-2.5">
              <SupplyBadge signal={item.supplySignal} />
              <span className="text-sm font-semibold text-espresso">
                {money(item.price)}
              </span>
              {item.bulkPrice > 0 && (
                <span className="text-xs text-espresso/50 bg-sage/10 px-2 py-0.5 rounded-full">
                  Bulk: {money(item.bulkPrice)}
                </span>
              )}
            </div>
            <div className="flex gap-3 text-xs text-espresso/50 mt-1.5">
              <span>MOQ: {item.moq}</span>
              <span>• {item.location}</span>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-espresso/60">{item.location}</p>
          </>
        )}
      </div>
    </Link>
  );
};

export default SearchResults;

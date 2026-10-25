import { useRef, useEffect, useState, useMemo, useLayoutEffect } from "react";
import { gsap } from "gsap";
import CategorySlider from "../components/CategorySlider";
import ProductCard from "../components/ProductCard";
import FilterBar from "../components/FilterBar";
import HeroCarousel from "../components/HeroCarousel";
import CTABanner from "../components/CTABanner";
import LoadMore from "../components/LoadMore";
import MarketSnapshot from "../components/MarketSnapshot";
import PromotionStrip from "../components/PromotionStrip";
import {
  getCheapestSupplier,
  hasVerifiedSupplier,
} from "../utils/supplierUtils";
import api from "../utils/axios"; // Added API import
import { toast } from "sonner";
import { useLocationFilter } from "../context/LocationContext";

const PAGE_SIZE = 8;

const MarketplaceHome = () => {
  const containerRef = useRef(null);
  const prevAnimatedIdsRef = useRef([]);

  const [products, setProducts] = useState([]);
  const [isFetching, setIsFetching] = useState(true);
  // A catalogue that failed to load and a catalogue with nothing in it look
  // identical once the array is empty, and they need different words.
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const [selectedCategory, setSelectedCategory] = useState(null);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [sortBy, setSortBy] = useState("recommended");

  const { cityParam, label: cityLabel, setCity } = useLocationFilter();

  useEffect(() => {
    const controller = new AbortController();
    const fetchCatalog = async () => {
      try {
        const res = await api.get("/api/products", {
          params: cityParam ? { city: cityParam } : {},
          signal: controller.signal,
        });

        const catalog = Array.isArray(res.data) ? res.data : [];
        const mappedProducts = catalog.map((dbProduct) => ({
          id: dbProduct.id.toString(),
          name: dbProduct.name,
          category: dbProduct.category,
          image: dbProduct.image,
          description: dbProduct.description,
          suppliers: dbProduct.suppliers,
        }));

        setProducts(mappedProducts);
        setLoadFailed(false);
      } catch (err) {
        if (controller.signal.aborted) return;
        // A failed catalogue shows nothing, not something.
        //
        // Two invented products used to stand in here: ABC Textiles in Mumbai
        // and XYZ Garments in Delhi, with prices, MOQs, verified ticks and
        // phone numbers. They were clickable, so a buyer could try to order
        // from a wholesaler who does not exist, and a real wholesaler looking
        // at their own marketplace saw competitors who were never there.
        //
        // Nothing is shown instead, and the empty state says the catalogue
        // could not be loaded rather than blaming the buyer's filters.
        console.error("Failed to fetch catalog:", err);
        toast.error("Could not load the catalogue. Please try again.");
        setProducts([]);
        setLoadFailed(true);
      } finally {
        if (!controller.signal.aborted) setIsFetching(false);
      }
    };

    fetchCatalog();
    return () => controller.abort();
    // Deliberately no spinner on a city change. The cards already on screen
    // stay until the new ones arrive, which reads better than the whole page
    // blanking out, and the chip below the filter bar has already changed to
    // say which city is being loaded.
  }, [cityParam, retryCount]);

  const categories = useMemo(() => {
    const set = new Set(products.map((p) => p.category).filter(Boolean));
    return Array.from(set).sort();
  }, [products]);

  const filteredSorted = useMemo(() => {
    let result = products.filter((product) => {
      if (verifiedOnly && !hasVerifiedSupplier(product)) return false;
      if (selectedCategory && product.category !== selectedCategory)
        return false;
      return true;
    });

    switch (sortBy) {
      case "price-asc":
        result = [...result].sort((a, b) => {
          const pa =
            getCheapestSupplier(a)?.discountPrice ??
            getCheapestSupplier(a)?.price ??
            0;
          const pb =
            getCheapestSupplier(b)?.discountPrice ??
            getCheapestSupplier(b)?.price ??
            0;
          return pa - pb;
        });
        break;
      case "price-desc":
        result = [...result].sort((a, b) => {
          const pa =
            getCheapestSupplier(a)?.discountPrice ??
            getCheapestSupplier(a)?.price ??
            0;
          const pb =
            getCheapestSupplier(b)?.discountPrice ??
            getCheapestSupplier(b)?.price ??
            0;
          return pb - pa;
        });
        break;
      case "verified":
        result = [...result].sort(
          (a, b) =>
            Number(hasVerifiedSupplier(b)) - Number(hasVerifiedSupplier(a)),
        );
        break;
      default:
        break;
    }

    return result;
  }, [products, selectedCategory, verifiedOnly, sortBy]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [selectedCategory, verifiedOnly, sortBy]);

  const displayedProducts = useMemo(
    () => filteredSorted.slice(0, visibleCount),
    [filteredSorted, visibleCount],
  );

  const hasMore = visibleCount < filteredSorted.length;

  const handleLoadMore = () => {
    setIsLoadingMore(true);
    setTimeout(() => {
      setVisibleCount((prev) =>
        Math.min(prev + PAGE_SIZE, filteredSorted.length),
      );
      setIsLoadingMore(false);
    }, 500);
  };

  const handleClearFilters = () => {
    setVerifiedOnly(false);
    setSelectedCategory(null);
  };

  // Initial Page Load Animation
  // useLayoutEffect so the opacity-0 start state lands before the browser
  // paints. In useEffect the hero rendered fully, then blanked out and faded
  // back in, which read as a flash on every load.
  useLayoutEffect(() => {
    if (isFetching) return;
    window.scrollTo(0, 0);

    const ctx = gsap.context(() => {
      gsap.fromTo(
        ".page-load-anim",
        { y: 20, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.6,
          stagger: 0.1,
          ease: "power2.out",
          clearProps: "opacity,transform,willChange",
        },
      );
    }, containerRef);
    return () => ctx.revert();
  }, [isFetching]);

  useEffect(() => {
    if (isFetching || displayedProducts.length === 0) return;

    const ctx = gsap.context(() => {
      const allIds = displayedProducts.map((p) => p.id);
      const newIds = allIds.filter(
        (id) => !prevAnimatedIdsRef.current.includes(id),
      );

      if (newIds.length === 0) return;

      const isFreshSet =
        prevAnimatedIdsRef.current.length === 0 ||
        newIds.length === allIds.length;
      const selector = newIds.map((id) => `[data-card-id="${id}"]`).join(",");
      const targets = gsap.utils.toArray(selector);

      gsap.fromTo(
        targets,
        { y: 30, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.5,
          stagger: 0.05,
          ease: "power2.out",
          delay: isFreshSet ? 0.2 : 0,
          willChange: "transform, opacity",
        },
      );
    }, containerRef);

    prevAnimatedIdsRef.current = displayedProducts.map((p) => p.id);
    return () => ctx.revert();
  }, [displayedProducts, isFetching]);

  if (isFetching) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-clay border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex flex-col gap-4 sm:gap-6 pb-10">
      <div className="page-load-anim">
        <HeroCarousel />
      </div>
      <div className="page-load-anim">
        <MarketSnapshot
          products={products}
          region={cityParam ? cityLabel : null}
        />
      </div>
      <div className="page-load-anim">
        <PromotionStrip />
      </div>
      <div className="page-load-anim">
        <CategorySlider
          categories={categories}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
        />
      </div>
      <div className="flex flex-col gap-2 page-load-anim">
        <FilterBar
          verifiedOnly={verifiedOnly}
          onToggleVerifiedOnly={() => setVerifiedOnly((prev) => !prev)}
          sortBy={sortBy}
          onSortChange={setSortBy}
          onClearFilters={handleClearFilters}
          resultCount={displayedProducts.length}
          totalCount={filteredSorted.length}
        />
        {/* The navbar carries the city too, but a buyer who scrolled past it
            is owed a reminder of why they are seeing fewer sellers than they
            expects, and a way out that does not need them to find the pin. */}
        {cityParam && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-sage/30 bg-sage/5 px-3 py-2 text-xs">
            <span className="font-semibold text-espresso">
              Showing sellers from {cityLabel} only
            </span>
            <button
              onClick={() => setCity(null)}
              className="font-bold text-clay underline underline-offset-2 hover:text-espresso"
            >
              Show all of India
            </button>
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6 items-start">
          {displayedProducts.map((product) => (
            <div
              key={product.id}
              data-card-id={product.id}
              className="product-card-anim"
            >
              <ProductCard product={product} />
            </div>
          ))}
        </div>
        {filteredSorted.length === 0 && (
          <div className="text-center py-12 text-sm text-slate-500">
            {/* Naming the city matters. Without it a buyer cannot tell
                whether the shop is empty or they narrowed it themselves. */}
            {loadFailed ? (
              <>
                <p>The catalogue could not be loaded.</p>
                <button
                  onClick={() => {
                    setIsFetching(true);
                    setRetryCount((count) => count + 1);
                  }}
                  className="mt-3 rounded-xl border border-sage/40 px-4 py-2 text-xs font-bold text-espresso transition-colors hover:border-clay hover:text-clay"
                >
                  Try again
                </button>
              </>
            ) : cityParam ? (
              <>
                <p>No products from sellers in {cityLabel}.</p>
                <button
                  onClick={() => setCity(null)}
                  className="mt-3 rounded-xl border border-sage/40 px-4 py-2 text-xs font-bold text-espresso transition-colors hover:border-clay hover:text-clay"
                >
                  Show sellers from all of India
                </button>
              </>
            ) : (
              "No products match your filters."
            )}
          </div>
        )}
      </div>
      {hasMore && (
        <div className="page-load-anim">
          <LoadMore isLoading={isLoadingMore} onClick={handleLoadMore} />
        </div>
      )}
      <div className="page-load-anim">
        <CTABanner />
      </div>
    </div>
  );
};

export default MarketplaceHome;

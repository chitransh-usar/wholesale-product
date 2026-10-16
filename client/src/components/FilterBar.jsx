import { useState, useRef, useEffect } from "react";
import { SlidersHorizontal, ChevronDown, Check, X } from "lucide-react";

export const SORT_OPTIONS = [
  { value: "recommended", label: "Recommended" },
  { value: "price-asc", label: "Price: Low to High" },
  { value: "price-desc", label: "Price: High to Low" },
  { value: "verified", label: "Verified First" },
];

const FilterBar = ({
  verifiedOnly = false,
  onToggleVerifiedOnly = () => {},
  sortBy = "recommended",
  onSortChange = () => {},
  onClearFilters = () => {},
  resultCount = 0,
  totalCount = 0,
}) => {
  const [openDropdown, setOpenDropdown] = useState(null); // null | "filters" | "sort"
  const wrapperRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const activeFilterCount = verifiedOnly ? 1 : 0;
  const currentSortLabel =
    SORT_OPTIONS.find((opt) => opt.value === sortBy)?.label || "Recommended";

  return (
    <div
      ref={wrapperRef}
      className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-3 mb-2 border-b border-sage/30"
    >
      <div className="text-sm font-medium text-espresso">
        <span className="text-sage mr-2">Results:</span>
        Showing {resultCount} of {totalCount} products
      </div>

      <div className="flex items-center gap-3 w-full sm:w-auto">
        {/* Filters - non-category attributes only; category lives in the CategorySlider above */}
        <div className="relative flex-1 sm:flex-none">
          <button
            onClick={() =>
              setOpenDropdown(openDropdown === "filters" ? null : "filters")
            }
            className="flex items-center justify-center gap-2 w-full px-4 py-1.5 border border-sage/50 rounded-sm text-xs font-semibold text-espresso hover:bg-sage/10 transition-colors cursor-pointer"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Filters
            {activeFilterCount > 0 && (
              <span className="flex items-center justify-center w-4 h-4 bg-clay text-cream text-[10px] font-bold rounded-full">
                {activeFilterCount}
              </span>
            )}
          </button>

          {openDropdown === "filters" && (
            <div className="absolute right-0 sm:left-0 mt-2 w-56 bg-white border border-sage/30 rounded-md shadow-lg z-20 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-espresso uppercase tracking-wide">
                  Filter by
                </span>
                {activeFilterCount > 0 && (
                  <button
                    onClick={onClearFilters}
                    className="flex items-center gap-1 text-[11px] font-semibold text-clay hover:underline cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                    Clear
                  </button>
                )}
              </div>

              <label className="flex items-center gap-2 py-1.5 cursor-pointer group">
                <span
                  className={`flex items-center justify-center w-4 h-4 rounded-sm border shrink-0 transition-colors ${
                    verifiedOnly
                      ? "bg-clay border-clay"
                      : "border-sage/50 group-hover:border-sage"
                  }`}
                >
                  {verifiedOnly && (
                    <Check className="w-3 h-3 text-cream" strokeWidth={3} />
                  )}
                </span>
                <input
                  type="checkbox"
                  checked={verifiedOnly}
                  onChange={onToggleVerifiedOnly}
                  className="sr-only"
                />
                <span className="text-xs text-espresso">
                  Verified suppliers only
                </span>
              </label>

              {/* Room to grow: price range, MOQ, etc. - anything that isn't category,
                  since category selection is owned by the CategorySlider. */}
            </div>
          )}
        </div>

        {/* Sort */}
        <div className="relative flex-1 sm:flex-none">
          <button
            onClick={() =>
              setOpenDropdown(openDropdown === "sort" ? null : "sort")
            }
            className="flex items-center justify-center gap-2 w-full px-4 py-1.5 border border-sage/50 rounded-sm text-xs font-semibold text-espresso hover:bg-sage/10 transition-colors cursor-pointer whitespace-nowrap"
          >
            Sort: {currentSortLabel}
            <ChevronDown className="w-3.5 h-3.5" />
          </button>

          {openDropdown === "sort" && (
            <div className="absolute right-0 mt-2 w-48 bg-white border border-sage/30 rounded-md shadow-lg z-20 py-1">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    onSortChange(opt.value);
                    setOpenDropdown(null);
                  }}
                  className={`flex items-center justify-between w-full px-3 py-2 text-xs text-left hover:bg-sage/10 transition-colors cursor-pointer ${
                    sortBy === opt.value
                      ? "text-clay font-semibold"
                      : "text-espresso"
                  }`}
                >
                  {opt.label}
                  {sortBy === opt.value && <Check className="w-3.5 h-3.5" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FilterBar;

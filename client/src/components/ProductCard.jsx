import { Heart, IndianRupee, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { useWishlist } from "../context/WishlistContext";
import { getSortedSuppliers } from "../utils/supplierUtils";
import SupplierRow from "./SupplierRow";

const ProductCard = ({ product }) => {
  const { id, name = "Untitled Product", image, description = "" } = product;
  const suppliers = Array.isArray(product?.suppliers) ? product.suppliers : [];
  const { toggleWishlist, isWishlisted } = useWishlist();
  const wishlisted = isWishlisted(id);

  const sortedSuppliers = getSortedSuppliers({ ...product, suppliers });

  const displayedSuppliers = sortedSuppliers
    .map((supplier) => ({
      ...supplier,
      name:
        supplier.companyName ||
        supplier.company_name ||
        supplier.name ||
        "Verified Supplier",
      city: supplier.city || supplier.location || "",
      country: supplier.country || "India",
      price: supplier.price ?? supplier.originalPrice ?? supplier.unitPrice,
      discountPrice:
        supplier.discountPrice ??
        supplier.discount_price ??
        supplier.offerPrice,
    }))
    .slice(0, 6);

  const bestSupplier = displayedSuppliers[0] ?? null;

  if (!bestSupplier) return null;

  return (
    <div className="group bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col h-full transition-all duration-300 hover:shadow-2xl hover:shadow-slate-200/60 hover:-translate-y-1.5 hover:border-slate-300">
      <div className="relative w-full aspect-4/3 bg-slate-50 overflow-hidden shrink-0 border-b border-slate-100">
        <img
          src={image}
          alt={name}
          className="object-cover w-full h-full transition-transform duration-700 group-hover:scale-105"
        />

        <div className="absolute inset-x-0 top-0 p-2.5 sm:p-3 flex items-start justify-between gap-2 z-10">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              toggleWishlist(product);
            }}
            aria-label={wishlisted ? "Remove from wishlist" : "Add to wishlist"}
            className={`shrink-0 p-2 sm:p-2.5 rounded-full backdrop-blur-md transition-all duration-300 hover:scale-110 active:scale-95 cursor-pointer shadow-sm ring-1 ${
              wishlisted
                ? "bg-rose-50/90 ring-rose-200 text-rose-500"
                : "bg-white/90 ring-slate-200/50 text-slate-400 hover:ring-rose-200 hover:text-rose-500"
            }`}
          >
            <Heart
              className={`w-4 h-4 sm:w-5 sm:h-5 transition-all duration-300 ${
                wishlisted ? "fill-current scale-110" : "fill-none"
              }`}
            />
          </button>

          <div className="shrink-0 bg-white/90 backdrop-blur-md text-slate-700 text-[10px] sm:text-xs font-bold px-2 sm:px-3 py-1 sm:py-1.5 rounded-full shadow-sm flex items-center gap-1 sm:gap-1.5 ring-1 ring-slate-900/5">
            <Users className="w-3 h-3 sm:w-3.5 sm:h-3.5 md:w-4 md:h-4 text-clay shrink-0" />
            <span>{suppliers.length}</span>
            <span className="hidden sm:inline">suppliers</span>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-5 flex flex-col flex-1 gap-3">
        <div>
          <h3 className="text-sm sm:text-base font-bold text-slate-900 line-clamp-2 leading-snug min-h-10 sm:min-h-12 group-hover:text-clay transition-colors">
            {name}
          </h3>

          <p className="mt-1 text-xs sm:text-sm text-slate-500 line-clamp-1 min-h-4 sm:min-h-5">
            {description || "\u00A0"}
          </p>
        </div>

        <div className="mt-auto flex flex-col pt-1">
          <div className="flex items-baseline gap-1.5 mb-3 sm:mb-4 flex-wrap">
            <div className="flex items-center text-clay">
              <IndianRupee
                className="w-3.5 h-3.5 sm:w-5 sm:h-5"
                strokeWidth={2.5}
              />
              <span className="text-lg sm:text-2xl font-black leading-none tracking-tight">
                {bestSupplier.discountPrice ?? bestSupplier.price}
              </span>
            </div>
            <span className="text-[9px] sm:text-xs font-medium text-slate-400 tracking-wider whitespace-nowrap">
              <span className="sm:hidden">/unit</span>
              <span className="hidden sm:inline">/ unit starts</span>
            </span>
          </div>

          <div className="border-t border-slate-100 pt-3 sm:pt-4">
            <div
              className="flex flex-col gap-2 h-22 sm:h-24 overflow-y-auto pr-1 snap-y snap-mandatory [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-slate-200 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent"
              style={{ scrollbarWidth: "thin" }}
            >
              {displayedSuppliers.map((supplier, idx) => (
                <div key={supplier.id ?? idx} className="shrink-0 snap-start">
                  <SupplierRow supplier={supplier} isBest={idx === 0} />
                </div>
              ))}
            </div>
          </div>

          <Link
            to={`/product/${id}`}
            className="group/btn mt-4 flex items-center justify-center gap-2 w-full py-3 sm:py-3.5 bg-slate-900 text-white text-[11px] sm:text-sm font-bold rounded-xl no-underline hover:bg-clay transition-all duration-300 active:scale-[0.97] shadow-sm hover:shadow-md"
          >
            Compare and Buy
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ProductCard;

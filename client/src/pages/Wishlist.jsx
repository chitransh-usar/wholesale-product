import { Link } from "react-router-dom";
import { Heart, ArrowRight } from "lucide-react";
import ProductCard from "../components/ProductCard";
import { useWishlist } from "../context/WishlistContext";

const Wishlist = () => {
  const { items, clearWishlist } = useWishlist();

  return (
    <div className="flex flex-col gap-6 pb-10">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
            Saved for later
          </p>
          <h1 className="text-2xl sm:text-3xl font-black text-espresso">
            My Wishlist
          </h1>
        </div>

        {items.length > 0 && (
          <button
            type="button"
            onClick={clearWishlist}
            className="text-sm font-semibold text-slate-600 hover:text-rose-500 transition-colors cursor-pointer"
          >
            Clear all
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/70 px-6 py-16 text-center shadow-sm">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-rose-50 text-rose-500">
            <Heart className="h-8 w-8 fill-current" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">
            Your wishlist is empty.
          </h2>
          <p className="mt-2 max-w-md text-sm text-slate-600">
            Save products to compare or purchase later.
          </p>
          <Link
            to="/"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-espresso px-5 py-2.5 text-sm font-semibold text-cream transition-all duration-300 hover:bg-clay"
          >
            Continue Shopping
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
          {items.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
};

export default Wishlist;

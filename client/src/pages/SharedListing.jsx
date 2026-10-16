import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  BadgeCheck,
  IndianRupee,
  Lock,
  MapPin,
  MessageCircle,
  Package,
  Phone,
  ShoppingCart,
  Store,
  Truck,
} from "lucide-react";
import api from "../utils/axios";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";
import { toast } from "sonner";
import { amount as money } from "../utils/money";

/**
 * The page a wholesaler's shared link opens. Reached only by someone holding
 * the link, so it deliberately has no search, no related products and no way
 * to browse sideways into the rest of the catalogue.
 */
const SharedListing = () => {
  const { inventoryId } = useParams();
  const { user } = useAuth();
  const { addToCart } = useCart();
  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [imageBroken, setImageBroken] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await api.get(`/api/products/listing/${inventoryId}`);
        if (!cancelled) setListing(res.data);
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [inventoryId]);

  const handleAdd = () => {
    const added = addToCart(
      {
        id: listing.productId,
        name: listing.name,
        image: listing.image,
        price: listing.price,
      },
      listing.moq || 1,
      {
        id: listing.inventoryId,
        supplierId: listing.supplier.id,
        companyName: listing.supplier.companyName,
        price: listing.price,
        discountPrice: listing.discountPrice,
        moq: listing.moq,
        image: listing.image,
      },
    );
    if (added) toast.success(`${listing.name} added to cart`);
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent" />
      </div>
    );
  }

  if (notFound || !listing) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <Package className="mx-auto mb-4 h-14 w-14 text-espresso/15" />
        <h1 className="text-xl font-bold text-espresso">
          This link does not work
        </h1>
        <p className="mt-2 text-sm text-espresso/60">
          The seller may have removed this product, or the link may be wrong.
          Ask them to send it again.
        </p>
        <Link
          to="/"
          className="mt-6 inline-block rounded-lg bg-clay px-5 py-2.5 text-sm font-bold text-cream transition-colors hover:bg-espresso"
        >
          Browse products
        </Link>
      </div>
    );
  }

  const { supplier } = listing;
  const hasDiscount =
    listing.discountPrice && listing.discountPrice < listing.price;
  const payable = hasDiscount ? listing.discountPrice : listing.price;
  const isOwner = user?.id && String(user.id) === String(supplier.id);
  const phone = String(supplier.contactPhone || "").replace(/\D/g, "");

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6">
      {listing.visibility === "private" && (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-clay/25 bg-clay/5 px-4 py-3">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-clay" />
          <p className="text-sm text-espresso/75">
            <span className="font-bold">Shared with you.</span> This product is
            not in the public listings. Only people with this link can see it.
          </p>
        </div>
      )}

      <div className="grid gap-8 md:grid-cols-2">
        <div className="aspect-square overflow-hidden rounded-2xl border border-sage/20 bg-white">
          {listing.image && !imageBroken ? (
            <img
              src={listing.image}
              alt={listing.name}
              onError={() => setImageBroken(true)}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-sage/10">
              <Package className="h-12 w-12 text-espresso/15" />
            </div>
          )}
        </div>

        <div className="flex flex-col">
          <span className="text-[11px] font-bold uppercase tracking-wider text-espresso/40">
            {listing.category}
          </span>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-espresso sm:text-3xl">
            {listing.name}
          </h1>

          <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="flex items-center text-3xl font-black text-espresso">
              <IndianRupee className="h-6 w-6" />
              {money(payable)}
            </span>
            {hasDiscount && (
              <span className="text-base text-espresso/40 line-through">
                ₹{money(listing.price)}
              </span>
            )}
            <span className="text-sm text-espresso/50">per unit</span>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-sage/15 px-3 py-1.5 font-semibold text-espresso/75">
              Minimum order {listing.moq}
            </span>
            <span className="rounded-full bg-sage/15 px-3 py-1.5 font-semibold text-espresso/75">
              <Truck className="mr-1 inline h-3.5 w-3.5" />
              Ships in {listing.shippingDays} days
            </span>
            <span
              className={`rounded-full px-3 py-1.5 font-semibold ${
                listing.stock > 0
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-rose-50 text-rose-600"
              }`}
            >
              {listing.stock > 0 ? `${listing.stock} in stock` : "Out of stock"}
            </span>
          </div>

          {listing.description && (
            <p className="mt-4 text-sm leading-relaxed text-espresso/70">
              {listing.description}
            </p>
          )}

          {/* Seller */}
          <div className="mt-6 rounded-xl border border-sage/20 bg-white/70 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-clay/10 text-lg font-black uppercase text-clay">
                {supplier.companyName?.[0] || "?"}
              </div>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 font-bold text-espresso">
                  <span className="truncate">{supplier.companyName}</span>
                  {supplier.verified && (
                    <BadgeCheck className="h-4 w-4 shrink-0 text-emerald-600" />
                  )}
                </p>
                {(supplier.city || supplier.country) && (
                  <p className="flex items-center gap-1 text-xs text-espresso/50">
                    <MapPin className="h-3 w-3" />
                    {[supplier.city, supplier.country].filter(Boolean).join(", ")}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {listing.onStorefront && (
                <Link
                  to={`/wholesaler/${supplier.id}`}
                  className="flex items-center gap-1.5 rounded-lg border border-sage/30 bg-white px-3 py-2 text-xs font-bold text-espresso/70 transition-colors hover:border-clay hover:text-clay"
                >
                  <Store className="h-3.5 w-3.5" />
                  See their shop
                </Link>
              )}
              {phone && !isOwner && (
                <a
                  href={`https://wa.me/${phone}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border border-sage/30 bg-white px-3 py-2 text-xs font-bold text-espresso/70 transition-colors hover:border-clay hover:text-clay"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  WhatsApp
                </a>
              )}
              {phone && !isOwner && (
                <a
                  href={`tel:${phone}`}
                  className="flex items-center gap-1.5 rounded-lg border border-sage/30 bg-white px-3 py-2 text-xs font-bold text-espresso/70 transition-colors hover:border-clay hover:text-clay"
                >
                  <Phone className="h-3.5 w-3.5" />
                  Call
                </a>
              )}
            </div>
          </div>

          {isOwner ? (
            <p className="mt-5 rounded-xl border border-clay/20 bg-clay/5 px-4 py-3 text-xs text-espresso/70">
              This is your own listing, shown the way your customers see it.
              Send them this page's link.
            </p>
          ) : (
            <button
              type="button"
              disabled={listing.stock <= 0}
              onClick={handleAdd}
              className="mt-5 flex items-center justify-center gap-2 rounded-lg bg-clay px-6 py-3.5 text-sm font-bold text-cream transition-colors hover:bg-espresso disabled:cursor-not-allowed disabled:bg-espresso/20 disabled:text-espresso/50"
            >
              <ShoppingCart className="h-4 w-4" />
              {listing.stock > 0
                ? `Add ${listing.moq} to cart`
                : "Out of stock"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default SharedListing;

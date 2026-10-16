import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  BadgeCheck,
  CalendarDays,
  Check,
  Truck,
  MapPin,
  MessageCircle,
  Package,
  Phone,
  Search,
  ShieldCheck,
  ShoppingCart,
  Share2,
  Star,
  Store,
  IndianRupee,
} from "lucide-react";
import api from "../utils/axios";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";
import { toast } from "sonner";

// A storefront should not look like every other storefront, and there is no
// cover image in the data. The name picks one of a few theme palettes, so a
// given wholesaler always gets the same banner.
const COVERS = [
  "from-clay via-clay/70 to-espresso/60",
  "from-sage via-sage/70 to-espresso/50",
  "from-espresso via-espresso/70 to-clay/70",
  "from-clay/90 via-espresso/60 to-sage/70",
];

const coverFor = (name = "") => {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) % 9973;
  }
  return COVERS[hash % COVERS.length];
};

const rupees = (value) =>
  Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const Media = ({ item }) => {
  // Listing images are external URLs that can rot. Without this, a dead one
  // renders as overflowing alt text across the card instead of a placeholder.
  const [broken, setBroken] = useState(false);

  if (!item.image || broken) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-sage/10">
        <Package className="h-10 w-10 text-espresso/15" />
      </div>
    );
  }

  return (
    <img
      src={item.image}
      alt={item.name}
      loading="lazy"
      onError={() => setBroken(true)}
      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
    />
  );
};

const StockLine = ({ item }) => {
  if (item.stock <= 0) {
    return (
      <span className="font-semibold text-rose-500">Out of stock</span>
    );
  }
  if (item.stock < Math.max(item.moq || 1, 1) * 2) {
    return <span className="font-semibold text-amber-600">Low stock</span>;
  }
  return <span className="text-espresso/50">{item.stock} in stock</span>;
};

const PriceBlock = ({ item }) => {
  const hasDiscount = item.discountPrice && item.discountPrice < item.price;
  const effectivePrice = hasDiscount ? item.discountPrice : item.price;
  const off = hasDiscount
    ? Math.round(((item.price - item.discountPrice) / item.price) * 100)
    : 0;

  return (
    <div className="mt-auto pt-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="flex items-center text-lg font-black text-espresso">
          <IndianRupee className="h-4 w-4" />
          {rupees(effectivePrice)}
        </span>
        {hasDiscount && (
          <>
            <span className="text-xs text-espresso/40 line-through">
              ₹{rupees(item.price)}
            </span>
            <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
              {off}% off
            </span>
          </>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="rounded bg-sage/15 px-1.5 py-0.5 font-semibold text-espresso/70">
          MOQ {item.moq}
        </span>
        <StockLine item={item} />
      </div>
    </div>
  );
};

// `to` turns the whole card into a link. Without it the card is a plain box,
// used where the card carries its own button instead.
const CardShell = ({ to, children, className = "" }) => {
  const shared = `group flex flex-col overflow-hidden rounded-2xl border bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${className}`;
  return to ? (
    <Link to={to} className={shared}>
      {children}
    </Link>
  ) : (
    <div className={shared}>{children}</div>
  );
};

/**
 * A listing that is also in the shared catalogue. The product page is the
 * right destination: it carries the reviews and the other sellers.
 */
const CatalogueCard = ({ item }) => (
  <CardShell
    to={`/product/${item.id}`}
    className="border-sage/20 hover:border-clay/30"
  >
    <div className="aspect-square overflow-hidden">
      <Media item={item} />
    </div>
    <div className="flex flex-1 flex-col p-4">
      <span className="text-[10px] font-bold uppercase tracking-wider text-espresso/40">
        {item.category}
      </span>
      <h3 className="mt-1 line-clamp-2 font-semibold text-espresso transition-colors group-hover:text-clay">
        {item.name}
      </h3>
      <PriceBlock item={item} />
    </div>
  </CardShell>
);

/**
 * A storefront-only listing. It deliberately has no entry in the shared
 * catalogue, so there is no comparison page to send the buyer to. The card
 * orders directly from this wholesaler instead.
 */
const ExclusiveCard = ({ item, wholesaler, onAdd }) => (
  <CardShell className="border-clay/25 hover:border-clay/50">
    <div className="relative aspect-square overflow-hidden">
      <Media item={item} />
      <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-clay px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-cream shadow-sm">
        <Store className="h-3 w-3" />
        Only here
      </span>
      {item.stock <= 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70">
          <span className="rounded-full bg-espresso/80 px-3 py-1 text-xs font-bold uppercase tracking-wider text-cream">
            Out of stock
          </span>
        </div>
      )}
    </div>

    <div className="flex flex-1 flex-col p-4">
      <span className="text-[10px] font-bold uppercase tracking-wider text-espresso/40">
        {item.category}
      </span>
      <h3 className="mt-1 line-clamp-2 font-semibold text-espresso">
        {item.name}
      </h3>
      <PriceBlock item={item} />

      <button
        type="button"
        disabled={item.stock <= 0}
        onClick={() => onAdd(item, wholesaler)}
        className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-clay px-4 py-2.5 text-sm font-bold text-cream transition-colors hover:bg-espresso disabled:cursor-not-allowed disabled:bg-espresso/20 disabled:text-espresso/50"
      >
        <ShoppingCart className="h-4 w-4" />
        {item.stock > 0 ? `Add ${item.moq} to cart` : "Unavailable"}
      </button>
    </div>
  </CardShell>
);

const TrustChip = ({ icon: Icon, children, tone = "sage" }) => {
  const tones = {
    sage: "bg-sage/15 text-espresso/75",
    emerald: "bg-emerald-50 text-emerald-700",
    clay: "bg-clay/10 text-clay",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${tones[tone]}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {children}
    </span>
  );
};

const EmptyRange = ({ title, body }) => (
  <div className="rounded-2xl border border-dashed border-sage/40 bg-white/50 py-16 text-center">
    <Package className="mx-auto mb-3 h-10 w-10 text-espresso/15" />
    <p className="font-semibold text-espresso">{title}</p>
    <p className="mt-1 text-sm text-espresso/50">{body}</p>
  </div>
);

const WholesalerProfile = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { addToCart } = useCart();
  const [wholesaler, setWholesaler] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");

  useEffect(() => {
    let cancelled = false;

    const fetchWholesaler = async () => {
      setLoading(true);
      try {
        const res = await api.get(`/api/products/wholesaler/${id}`);
        if (!cancelled) setWholesaler(res.data);
      } catch (error) {
        console.error("Failed to fetch wholesaler", error);
        if (!cancelled) {
          toast.error("Wholesaler not found");
          navigate("/");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchWholesaler();
    return () => {
      cancelled = true;
    };
  }, [id, navigate]);

  const products = useMemo(() => wholesaler?.products || [], [wholesaler]);

  const categories = useMemo(() => {
    const seen = [...new Set(products.map((p) => p.category).filter(Boolean))];
    return ["All", ...seen.sort()];
  }, [products]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products.filter((item) => {
      if (category !== "All" && item.category !== category) return false;
      if (!needle) return true;
      return (
        item.name?.toLowerCase().includes(needle) ||
        item.category?.toLowerCase().includes(needle)
      );
    });
  }, [products, query, category]);

  const exclusive = visible.filter((item) => item.exclusive);
  const catalogue = visible.filter((item) => !item.exclusive);
  const filtering = query.trim() !== "" || category !== "All";

  const handleShare = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Shop link copied. Paste it on WhatsApp to share.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is blocked outside a secure context, so show the link
      // rather than failing silently.
      toast.info(url);
    }
  };

  // The storefront row has no supplier list of its own, so build the shape
  // the cart expects: `id` is the inventory row, `supplierId` the seller.
  const handleAddExclusive = (item, seller) => {
    const added = addToCart(
      {
        id: item.id,
        name: item.name,
        image: item.image,
        price: item.price,
      },
      item.moq || 1,
      {
        id: item.inventoryId,
        supplierId: seller.id,
        companyName: seller.companyName,
        price: item.price,
        discountPrice: item.discountPrice,
        moq: item.moq,
        image: item.image,
      },
    );
    if (added) toast.success(`${item.name} added to cart`);
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent" />
      </div>
    );
  }

  if (!wholesaler) return null;

  const location = [wholesaler.city, wholesaler.country]
    .filter(Boolean)
    .join(", ");
  const memberSince = wholesaler.memberSince
    ? new Date(wholesaler.memberSince).getFullYear()
    : null;
  const isOwner = user?.id && String(user.id) === String(wholesaler.id);
  const phone = String(wholesaler.contactPhone || "").replace(/\D/g, "");
  const totalExclusive = products.filter((item) => item.exclusive).length;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 pb-16">
      <button
        onClick={() => navigate(-1)}
        className="group flex w-fit items-center gap-2 text-sm font-semibold text-espresso/60 transition-colors hover:text-espresso"
      >
        <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
        Back
      </button>

      {/* Shopfront header */}
      <header className="overflow-hidden rounded-2xl border border-sage/20 bg-white shadow-sm">
        <div
          className={`h-24 bg-linear-to-br sm:h-28 ${coverFor(wholesaler.companyName)}`}
        />

        <div className="px-5 pb-6 sm:px-8">
          {/* Avatar overlaps the banner; the actions sit on the same line so
              the name gets the full width below rather than being squeezed
              against a button on the far right. */}
          <div className="flex items-end justify-between gap-4">
            <div className="-mt-10 flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border-4 border-white bg-cream text-3xl font-black uppercase text-clay shadow-md sm:-mt-12 sm:h-24 sm:w-24 sm:text-4xl">
              {wholesaler.companyName?.[0] || "?"}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {phone && !isOwner && (
                <>
                  <a
                    href={`tel:${phone}`}
                    className="flex items-center gap-2 rounded-lg border border-sage/30 bg-white px-4 py-2.5 text-sm font-bold text-espresso/70 transition-colors hover:border-clay hover:text-clay"
                  >
                    <Phone className="h-4 w-4" />
                    Call
                  </a>
                  <a
                    href={`https://wa.me/${phone}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 rounded-lg border border-sage/30 bg-white px-4 py-2.5 text-sm font-bold text-espresso/70 transition-colors hover:border-clay hover:text-clay"
                  >
                    <MessageCircle className="h-4 w-4" />
                    WhatsApp
                  </a>
                </>
              )}
              <button
                type="button"
                onClick={handleShare}
                className="flex items-center gap-2 rounded-lg bg-clay px-4 py-2.5 text-sm font-bold text-cream transition-colors hover:bg-espresso"
              >
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Share2 className="h-4 w-4" />
                )}
                {copied ? "Copied" : "Share"}
              </button>
            </div>
          </div>

          <div className="mt-3">
            <h1 className="text-2xl font-black tracking-tight text-espresso sm:text-3xl">
              {wholesaler.companyName}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-espresso/60">
              {location && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-4 w-4" />
                  {location}
                </span>
              )}
              {wholesaler.totalReviews > 0 && (
                <span className="flex items-center gap-1">
                  <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                  <span className="font-bold text-espresso">
                    {Number(wholesaler.rating).toFixed(1)}
                  </span>
                  <span className="text-espresso/50">
                    ({wholesaler.totalReviews} review
                    {wholesaler.totalReviews === 1 ? "" : "s"})
                  </span>
                </span>
              )}
            </div>
          </div>

          {/* Trust row: only facts we actually hold */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {wholesaler.verified && (
              <TrustChip icon={BadgeCheck} tone="emerald">
                Verified seller
              </TrustChip>
            )}
            {wholesaler.gstVerified && (
              <TrustChip icon={ShieldCheck}>GST registered</TrustChip>
            )}
            <TrustChip icon={Package}>
              {products.length} product{products.length === 1 ? "" : "s"}
            </TrustChip>
            {totalExclusive > 0 && (
              <TrustChip icon={Store} tone="clay">
                {totalExclusive} only here
              </TrustChip>
            )}
            {wholesaler.fulfilledOrders > 0 && (
              <TrustChip icon={Truck}>
                {wholesaler.fulfilledOrders} order
                {wholesaler.fulfilledOrders === 1 ? "" : "s"} delivered
              </TrustChip>
            )}
            {wholesaler.yearsInBusiness > 0 && (
              <TrustChip icon={CalendarDays}>
                {wholesaler.yearsInBusiness} years in business
              </TrustChip>
            )}
            {!wholesaler.yearsInBusiness && memberSince && (
              <TrustChip icon={CalendarDays}>
                {memberSince === new Date().getFullYear()
                  ? "New seller"
                  : `Selling since ${memberSince}`}
              </TrustChip>
            )}
          </div>

          {isOwner && (
            <p className="mt-4 rounded-xl border border-clay/20 bg-clay/5 px-4 py-3 text-xs text-espresso/70">
              This is your shop page, the way buyers see it. Send the link to your
              customers. Products you set to "Only with my link" stay off this
              page.
            </p>
          )}
        </div>
      </header>

      {/* Browse the range */}
      {products.length > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-sage/20 bg-white/70 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-espresso/30" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search in ${wholesaler.companyName}`}
              className="w-full rounded-lg border border-sage/25 bg-white py-2.5 pl-9 pr-4 text-sm text-espresso outline-none transition-colors placeholder:text-espresso/35 focus:border-clay"
            />
          </div>

          {categories.length > 2 && (
            <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0">
              {categories.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setCategory(name)}
                  className={`whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-bold transition-colors ${
                    category === name
                      ? "bg-espresso text-cream"
                      : "text-espresso/60 hover:bg-sage/15"
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {filtering && visible.length === 0 && (
        <EmptyRange
          title="Nothing matches that"
          body="Try a different word, or clear the category filter."
        />
      )}

      {/* Storefront-only range: the reason to visit this page */}
      {exclusive.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-2 border-b border-sage/20 pb-3">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-bold text-espresso">
                <Store className="h-5 w-5 text-clay" />
                Only in this shop
              </h2>
              <p className="mt-1 text-sm text-espresso/50">
                You will not find these anywhere else on the site. Only this seller
                has them.
              </p>
            </div>
            <span className="text-sm font-semibold text-espresso/50">
              {exclusive.length} product{exclusive.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {exclusive.map((item) => (
              <ExclusiveCard
                key={item.inventoryId}
                item={item}
                wholesaler={wholesaler}
                onAdd={handleAddExclusive}
              />
            ))}
          </div>
        </section>
      )}

      {/* Everything else, which is also in the shared catalogue */}
      {(catalogue.length > 0 || !filtering) && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-2 border-b border-sage/20 pb-3">
            <h2 className="text-xl font-bold text-espresso">
              {exclusive.length > 0 || totalExclusive > 0
                ? "Other products"
                : "Products"}
            </h2>
            <span className="text-sm font-semibold text-espresso/50">
              {catalogue.length} listing{catalogue.length === 1 ? "" : "s"}
            </span>
          </div>

          {catalogue.length === 0 ? (
            <EmptyRange
              title={
                totalExclusive > 0
                  ? "Nothing in search"
                  : "No listings yet"
              }
              body={
                totalExclusive > 0
                  ? "Everything this seller has is on this page only."
                  : "This seller has no products right now."
              }
            />
          ) : (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
              {catalogue.map((item) => (
                <CatalogueCard key={item.inventoryId} item={item} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
};

export default WholesalerProfile;

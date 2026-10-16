import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ShieldCheck,
  MapPin,
  IndianRupee,
  Layers,
  Scale,
  Truck,
  TrendingDown,
  Building2,
  Calculator,
  Minus,
  Plus,
  ShoppingBag,
  Check,
  Tag,
  Heart,
} from "lucide-react";
import { gsap } from "gsap";
import api from "../utils/axios";
import { toast } from "sonner";
import ContactVendorBtn from "../components/ContactVendorBtn";
import SupplierComparison from "../components/SupplierComparison";
import ReviewSection from "../components/ReviewSection";
import { useCart } from "../context/CartContext";
import { useWishlist } from "../context/WishlistContext";
import {
  getCheapestSupplier,
  getEffectivePrice,
  getSupplyLabel,
} from "../utils/supplierUtils";

const ProductDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const pageRef = useRef(null);
  const addToCartBtnRef = useRef(null);
  const { addToCart, isOwnListing } = useCart();
  const { toggleWishlist, isWishlisted } = useWishlist();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedSupplierId, setSelectedSupplierId] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [justAdded, setJustAdded] = useState(false);

  // Fetch product on mount
  useEffect(() => {
    const fetchProduct = async () => {
      try {
        const response = await api.get(`/api/products/${id}`);

        const productData = {
          ...response.data,
          id: response.data.id.toString(),
          suppliers: response.data.suppliers.map((s) => ({
            ...s,
            name:
              s.companyName || s.company_name || s.name || "Verified Supplier",
          })),
        };

        setProduct(productData);

        const cheapest =
          getCheapestSupplier(productData)?.id ?? productData.suppliers[0]?.id;
        setSelectedSupplierId(cheapest);
      } catch (error) {
        console.error("Failed to fetch product", error);
        toast.error("Product not found");
        navigate("/");
      } finally {
        setLoading(false);
      }
    };

    fetchProduct();
  }, [id, navigate]);

  const suppliers = product?.suppliers ?? [];
  const selectedSupplier =
    suppliers.find((s) => s.id === selectedSupplierId) ?? suppliers[0] ?? {};

  const currentSupplierName =
    selectedSupplier.companyName ||
    selectedSupplier.company_name ||
    selectedSupplier.name ||
    "Verified Supplier";
  const baseMoq = selectedSupplier.moq ?? 1;
  const quantityStep = Math.max(1, Math.round(baseMoq / 10));

  useEffect(() => {
    setQuantity(baseMoq);
  }, [selectedSupplierId, baseMoq]);

  // useLayoutEffect, not useEffect: the tween starts the elements at
  // opacity 0, and in useEffect that happens *after* the browser has already
  // painted them, so the content appeared, blanked out, then faded back in.
  useLayoutEffect(() => {
    if (loading || !product) return;
    window.scrollTo(0, 0);
    const ctx = gsap.context(() => {
      gsap.fromTo(
        ".detail-fade-in",
        { y: 15, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.5,
          stagger: 0.08,
          ease: "power2.out",
          clearProps: "opacity,transform",
        },
      );
    }, pageRef);
    return () => ctx.revert();
  }, [loading, product]);

  const handleQuantityChange = (val) => {
    if (isNaN(val) || val < baseMoq) {
      setQuantity(baseMoq);
    } else {
      setQuantity(val);
    }
  };

  const handleAddToCart = () => {
    if (!addToCart(product, quantity, selectedSupplier)) return;
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1600);
  };

  if (loading) {
    // Reserve close to the loaded page's height so the footer does not sit
    // high under the spinner and then get shoved down when content arrives.
    return (
      <div className="flex justify-center items-center min-h-[85vh]">
        <div className="w-8 h-8 border-4 border-clay border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!product) return null;

  const currentUnitPrice = getEffectivePrice(selectedSupplier);
  const totalCost = currentUnitPrice * quantity;
  const unitSavings =
    (selectedSupplier.price ?? 0) - (selectedSupplier.discountPrice ?? 0);
  const savingsPercent =
    selectedSupplier.price > 0
      ? Math.round((unitSavings / selectedSupplier.price) * 100)
      : 0;
  const wishlisted = isWishlisted(product.id);
  const ownListing = isOwnListing(product, selectedSupplier);
  const location =
    selectedSupplier.city && selectedSupplier.country
      ? `${selectedSupplier.city}, ${selectedSupplier.country}`
      : "India";
  const supplySignal = getSupplyLabel(selectedSupplier.stock);

  return (
    <div
      ref={pageRef}
      className="w-full flex flex-col gap-6 pb-16 max-w-7xl mx-auto"
    >
      <div className="detail-fade-in flex items-center justify-between py-2 border-b border-slate-200">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors cursor-pointer group"
        >
          <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
          Back to Marketplace
        </button>
        <span className="text-xs text-slate-400 uppercase tracking-wider hidden sm:inline">
          Product ID: {product.id}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-10 items-start">
        <div className="detail-fade-in flex flex-col gap-4">
          <div className="group relative w-full aspect-4/3 bg-slate-100 border border-slate-200 rounded-lg overflow-hidden shadow-sm">
            <img
              src={
                selectedSupplier.image_url ||
                selectedSupplier.image ||
                product.global_image_url ||
                product.image
              }
              alt={product.name}
              className="object-cover w-full h-full transition-transform duration-500 group-hover:scale-105"
            />
            <div className="absolute top-3 right-3 bg-white/95 text-slate-700 text-xs font-semibold px-3 py-1.5 rounded-md border border-slate-200 shadow-sm">
              {supplySignal}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-white border border-slate-200 p-3 rounded-lg flex flex-col items-center justify-center shadow-xs">
              <Scale className="w-5 h-5 text-slate-400 mb-1" />
              <span className="text-xs text-slate-400 uppercase font-bold tracking-wider">
                Min Order
              </span>
              <span className="text-sm font-bold text-slate-800 mt-1 truncate max-w-full">
                {baseMoq}
              </span>
            </div>
            <div className="bg-white border border-slate-200 p-3 rounded-lg flex flex-col items-center justify-center shadow-xs">
              <Layers className="w-5 h-5 text-slate-400 mb-1" />
              <span className="text-xs text-slate-400 uppercase font-bold tracking-wider">
                In stock
              </span>
              <span className="text-sm font-bold text-slate-800 mt-1 truncate max-w-full">
                {selectedSupplier.stock ?? 0}
              </span>
            </div>
            <div className="bg-white border border-slate-200 p-3 rounded-lg flex flex-col items-center justify-center shadow-xs">
              <Truck className="w-5 h-5 text-slate-400 mb-1" />
              <span className="text-xs text-slate-400 uppercase font-bold tracking-wider">
                Shipping
              </span>
              <span className="text-sm font-bold text-slate-800 mt-1 truncate max-w-full">
                {selectedSupplier.shippingDays
                  ? `${selectedSupplier.shippingDays}d`
                  : "FOB Options"}
              </span>
            </div>
          </div>
        </div>

        <div className="detail-fade-in flex flex-col gap-5">
          <div className="flex flex-col gap-2 pb-3 border-b border-slate-200">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-bold text-slate-800">
                {currentSupplierName}
              </span>
              {selectedSupplier.verified && (
                <div className="flex items-center gap-1 bg-white border border-emerald-600 text-emerald-700 text-xs font-bold px-2 py-0.5 rounded-full shadow-xs">
                  <ShieldCheck className="w-3.5 h-3.5" strokeWidth={2.5} />
                  <span>Verified Supplier</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 text-sm text-slate-500 font-medium">
              <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
              <span>{location}</span>
              <span className="text-slate-300 mx-1">•</span>
              <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="text-xs text-slate-400">
                {product.category} Industry
              </span>
            </div>
          </div>

          {suppliers.length > 1 && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                {suppliers.length} suppliers available
              </span>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {suppliers.map((s) => {
                  const active = s.id === selectedSupplierId;
                  const btnSupplierName =
                    s.companyName || s.company_name || s.name || "Supplier";
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelectedSupplierId(s.id)}
                      className={`shrink-0 flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-all cursor-pointer ${
                        active
                          ? "border-clay bg-clay/5 shadow-sm"
                          : "border-slate-200 bg-white hover:border-slate-300"
                      }`}
                    >
                      <span className="flex items-center gap-1 text-xs font-bold text-slate-800">
                        {btnSupplierName}
                        {s.verified && (
                          <ShieldCheck className="w-3 h-3 text-emerald-600" />
                        )}
                      </span>
                      <span className="text-xs font-bold text-clay">
                        ₹{getEffectivePrice(s)}
                        <span className="text-slate-400 font-normal">
                          /unit
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 leading-tight">
              {product.name}
            </h1>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col">
            <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Pricing Tiers
              </span>
              {savingsPercent > 0 && (
                <div className="flex items-center gap-1 bg-emerald-100/80 text-emerald-700 text-[10px] font-extrabold px-2 py-1 rounded-md uppercase tracking-widest border border-emerald-200">
                  <Tag className="w-3 h-3" />
                  <span>Save {savingsPercent}% on Bulk</span>
                </div>
              )}
            </div>

            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div className="border border-slate-200 rounded-lg p-3.5 flex flex-col justify-center bg-white shadow-xs relative">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Standard Rate
                </span>
                <div className="flex items-baseline gap-0.5 font-mono">
                  <IndianRupee
                    className="w-4 h-4 text-slate-800 shrink-0"
                    strokeWidth={2.5}
                  />
                  <span className="text-2xl font-bold text-slate-800">
                    {selectedSupplier.price ?? 0}
                  </span>
                  <span className="text-xs text-slate-500 ml-1">/unit</span>
                </div>
                <span className="text-xs text-slate-400 mt-1 font-medium">
                  Min. order: {baseMoq}
                </span>
              </div>

              <div className="border-2 border-clay rounded-lg p-3.5 flex flex-col justify-center bg-clay/5 relative shadow-xs">
                <div className="absolute -top-2.5 right-3 bg-clay text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider shadow-sm flex items-center gap-1">
                  <TrendingDown className="w-3 h-3" strokeWidth={3} />
                  Best Value
                </div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-clay mb-2">
                  Bulk Rate
                </span>
                <div className="flex items-baseline gap-0.5 font-mono">
                  <IndianRupee
                    className="w-4 h-4 text-clay shrink-0"
                    strokeWidth={3}
                  />
                  <span className="text-2xl font-black text-clay">
                    {selectedSupplier.discountPrice ??
                      selectedSupplier.price ??
                      0}
                  </span>
                  <span className="text-xs text-clay/70 ml-1 font-bold">
                    /unit
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-slate-500 font-medium line-through decoration-slate-300">
                    ₹{selectedSupplier.price ?? 0}
                  </span>
                  <span className="text-xs text-clay font-semibold">
                    ({baseMoq}+ units)
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col gap-4 shadow-xs">
            <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-600">
              <Calculator className="w-4 h-4 text-clay" />
              <span>Calculate Total</span>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
              <div className="flex flex-col gap-1.5 flex-1">
                <label className="text-sm font-medium text-slate-600">
                  Order Quantity
                </label>
                <div className="flex items-stretch border border-slate-300 rounded-xl overflow-hidden focus-within:ring-1 focus-within:ring-clay focus-within:border-clay">
                  <button
                    type="button"
                    disabled={quantity <= baseMoq}
                    onClick={() =>
                      handleQuantityChange(quantity - quantityStep)
                    }
                    className={`px-3 flex items-center justify-center bg-slate-50 border-r border-slate-200 shrink-0 transition-colors ${
                      quantity <= baseMoq
                        ? "text-slate-300 cursor-not-allowed"
                        : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                    }`}
                    aria-label="Decrease quantity"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <input
                    type="number"
                    min={baseMoq}
                    value={quantity}
                    onChange={(e) =>
                      handleQuantityChange(parseInt(e.target.value))
                    }
                    className="w-full min-w-0 text-center py-2 text-base font-mono font-bold text-slate-900 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      handleQuantityChange(quantity + quantityStep)
                    }
                    className="px-3 flex items-center justify-center text-slate-500 bg-slate-50 hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer border-l border-slate-200 shrink-0"
                    aria-label="Increase quantity"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                <span className="text-xs text-slate-400">
                  Increments of {quantityStep} units · Min {baseMoq}
                </span>
              </div>

              <div className="flex flex-row sm:flex-col justify-between sm:justify-center px-2 sm:px-4 py-2 sm:py-0 border-t sm:border-t-0 sm:border-l border-slate-200 gap-2 font-mono shrink-0">
                <div>
                  <span className="block text-xs text-slate-400 uppercase font-bold tracking-wide">
                    Price per unit
                  </span>
                  <span className="text-sm font-bold text-slate-700">
                    ₹{currentUnitPrice}
                  </span>
                </div>
                <div className="text-right sm:text-left">
                  <span className="block text-xs text-slate-400 uppercase font-bold tracking-wide">
                    Total Cost
                  </span>
                  <span className="text-lg font-black text-clay">
                    ₹{totalCost.toLocaleString("en-IN")}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 mt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ContactVendorBtn
                vendorId={selectedSupplier.supplierId || selectedSupplier.id}
                vendorName={currentSupplierName}
                productName={product.name}
                productImage={product.image}
                productId={product.id}
                vendorPhone={
                  selectedSupplier.contactPhone ??
                  selectedSupplier.contact_phone ??
                  selectedSupplier.phone ??
                  selectedSupplier.mobile
                }
              />
              <button
                type="button"
                onClick={() => toggleWishlist(product)}
                className={`flex items-center justify-center gap-2 py-3 text-sm font-bold rounded-xl transition-all cursor-pointer shadow-sm active:scale-[0.99] border ${
                  wishlisted
                    ? "bg-rose-50 border-rose-200 text-rose-600 hover:bg-rose-100"
                    : "bg-white border-slate-200 text-slate-700 hover:border-rose-200 hover:text-rose-500"
                }`}
              >
                <Heart
                  className={`w-5 h-5 shrink-0 transition-all ${wishlisted ? "fill-current scale-110" : "fill-none"}`}
                />
                <span className="sm:hidden">
                  {wishlisted ? "Saved" : "Wishlist"}
                </span>
                <span className="hidden sm:inline">
                  {wishlisted ? "Remove from Wishlist" : "Add to Wishlist"}
                </span>
              </button>
            </div>

            <button
              ref={addToCartBtnRef}
              onClick={handleAddToCart}
              disabled={ownListing}
              title={
                ownListing ? "This is your own listing" : undefined
              }
              className={`w-full flex items-center justify-center gap-2 py-3.5 text-sm font-bold rounded-xl transition-all shadow-sm active:scale-[0.99] ${
                ownListing
                  ? "bg-slate-100 text-slate-400 cursor-not-allowed shadow-none"
                  : justAdded
                    ? "bg-emerald-600 text-white cursor-pointer"
                    : "bg-clay text-white hover:bg-clay/90 cursor-pointer"
              }`}
            >
              {ownListing ? (
                <span>This is your own listing</span>
              ) : justAdded ? (
                <>
                  <Check className="w-5 h-5 shrink-0" />
                  <span>Added to Cart</span>
                </>
              ) : (
                <>
                  <ShoppingBag className="w-5 h-5 shrink-0" />
                  <span>Add to Cart</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <SupplierComparison
        product={product}
        onAddToCart={(productObj, qty, supplier) => {
          addToCart(productObj, qty, supplier);
          setSelectedSupplierId(supplier.id);
        }}
        onContactSupplier={async (supplier) => {
          setSelectedSupplierId(supplier.id);

          try {
            const response = await api.get(
              `/api/products/${product.id}/contact`,
              {
                params: { supplierId: supplier.supplierId || supplier.id },
              },
            );

            if (response.data.success && response.data.whatsappUrl) {
              window.open(response.data.whatsappUrl, "_blank");
            } else {
              toast.error(
                response.data.message || "Failed to generate WhatsApp link",
              );
            }
          } catch (error) {
            console.error("Failed to contact supplier:", error);
            if (error.response?.status === 401) {
              toast.error("Please login to contact suppliers");
            } else if (error.response?.status === 403) {
              toast.error("Only buyers can contact suppliers");
            } else {
              toast.error("Failed to connect with supplier");
            }
          }
        }}
      />

      <ReviewSection productId={product.id} />
    </div>
  );
};

export default ProductDetails;

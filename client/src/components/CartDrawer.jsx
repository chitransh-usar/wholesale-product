import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Minus, Plus, ShoppingBag, Store, Trash2, X } from "lucide-react";
import { useCart } from "../context/CartContext";
import { money } from "../utils/money";

const CartDrawer = () => {
  const navigate = useNavigate();
  const {
    items,
    isCartOpen,
    setIsCartOpen,
    removeFromCart,
    updateQuantity,
    subtotal,
    uniqueItemCount,
    cartSeller,
  } = useCart();

  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!isCartOpen) return;

    const raf = window.requestAnimationFrame(() => setIsVisible(true));
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setIsCartOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(raf);
      document.removeEventListener("keydown", handleKeyDown);
      setIsVisible(false);
    };
  }, [isCartOpen, setIsCartOpen]);

  if (!isCartOpen) return null;

  return (
    <>
      <div
        className={`fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 transition-all duration-300 ${
          isVisible ? "opacity-100" : "opacity-0"
        }`}
        onClick={() => setIsCartOpen(false)}
      />

      <div
        className={`fixed top-0 right-0 h-full w-full sm:w-md bg-slate-50/95 shadow-2xl z-50 flex flex-col transition-transform duration-300 ease-out ${
          isVisible ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-6 py-5 bg-white border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-clay/10 p-2 rounded-lg text-clay">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <h2 className="text-lg font-black text-slate-900">Your Cart</h2>
            {uniqueItemCount > 0 && (
              <span className="bg-clay text-white font-mono text-[10px] font-bold px-2 py-0.5 rounded-full ml-1 shadow-sm">
                {uniqueItemCount} {uniqueItemCount === 1 ? "Item" : "Items"}
              </span>
            )}
          </div>
          <button
            onClick={() => setIsCartOpen(false)}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-all cursor-pointer"
            aria-label="Close cart"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* An order ships from one wholesaler, so name them up front. */}
        {cartSeller && (
          <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-6 py-3 shrink-0">
            <Store className="h-4 w-4 shrink-0 text-clay" />
            <p className="min-w-0 text-xs text-slate-500">
              Ordering from{" "}
              <span className="font-bold text-slate-800">
                {cartSeller.name}
              </span>
            </p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-10 gap-4">
              <div className="w-16 h-16 rounded-full bg-white shadow-sm border border-slate-100 flex items-center justify-center mb-2">
                <ShoppingBag className="w-6 h-6 text-slate-300" />
              </div>
              <div>
                <p className="text-base font-bold text-slate-800">
                  Your cart is empty
                </p>
                <p className="text-sm text-slate-500 mt-1.5 max-w-50 mx-auto">
                  Looks like you haven't added anything to your cart yet.
                </p>
              </div>
              <button
                onClick={() => setIsCartOpen(false)}
                className="mt-4 flex items-center gap-2 px-6 py-3 bg-white border border-slate-200 hover:border-clay hover:text-clay text-slate-700 text-sm font-bold rounded-xl transition-all cursor-pointer shadow-sm"
              >
                Start Shopping
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:gap-4">
              {items.map((item) => {
                const unitPrice =
                  item.bulkQuantity && item.quantity >= item.bulkQuantity
                    ? item.bulkPrice
                    : item.price;

                return (
                  <div
                    key={item.id}
                    className="flex gap-4 p-4 bg-white border border-slate-100 shadow-sm rounded-xl hover:border-slate-200 transition-colors group"
                  >
                    <div className="relative shrink-0">
                      <img
                        src={item.image}
                        alt={item.name}
                        className="w-20 h-20 rounded-lg object-cover border border-slate-100 bg-slate-50"
                      />
                    </div>

                    <div className="flex-1 min-w-0 flex flex-col">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <h3 className="text-sm font-bold text-slate-800 line-clamp-2 leading-snug pr-2">
                            {item.name}
                          </h3>
                          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider mt-1">
                            {item.sellerName}
                          </p>
                        </div>
                        <button
                          onClick={() => removeFromCart(item.id)}
                          className="p-1.5 -mr-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-md transition-colors cursor-pointer shrink-0"
                          aria-label="Remove item"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="flex items-end justify-between mt-auto pt-3">
                        <div className="flex items-center border border-slate-200 rounded-lg bg-white overflow-hidden shadow-xs">
                          <button
                            onClick={() => updateQuantity(item.id, item.quantity - 1)}
                            className="p-1.5 sm:p-2 text-slate-500 hover:bg-slate-50 hover:text-slate-800 transition-colors cursor-pointer"
                            aria-label="Decrease quantity"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="w-8 sm:w-10 text-xs font-mono font-bold text-slate-800 text-center select-none">
                            {item.quantity}
                          </span>
                          <button
                            onClick={() => updateQuantity(item.id, item.quantity + 1)}
                            className="p-1.5 sm:p-2 text-slate-500 hover:bg-slate-50 hover:text-slate-800 transition-colors cursor-pointer border-l border-slate-100"
                            aria-label="Increase quantity"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="flex flex-col items-end">
                          <span className="font-mono text-base font-black text-clay tracking-tight">
                            ₹{money(unitPrice * item.quantity)}
                          </span>
                          {item.quantity > 1 && (
                            <span className="text-[10px] text-slate-400 font-medium mt-0.5">
                              ₹{money(unitPrice)} each
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {items.length > 0 && (
          <div className="bg-white border-t border-slate-200 p-5 sm:p-6 shrink-0 shadow-[0_-4px_10px_-4px_rgba(0,0,0,0.05)]">
            <div className="flex items-end justify-between mb-4">
              <div className="flex flex-col">
                <span className="text-sm text-slate-500 font-semibold">
                  Subtotal
                </span>
                <span className="text-[11px] text-slate-400 mt-0.5">
                  Taxes and shipping calculated at checkout
                </span>
              </div>
              <span className="text-2xl font-black text-slate-900 font-mono tracking-tight">
                ₹{money(subtotal)}
              </span>
            </div>

            <button
              onClick={() => {
                setIsCartOpen(false);
                navigate("/checkout");
              }}
              className="w-full flex items-center justify-center gap-2 bg-clay text-white text-sm font-bold py-3.5 rounded-xl hover:bg-clay/90 hover:shadow-lg hover:shadow-clay/20 transition-all cursor-pointer active:scale-[0.98]"
            >
              Proceed to Checkout
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </>
  );
};

export default CartDrawer;

/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { useAuth } from "./AuthContext";
import CartConflictModal from "../components/CartConflictModal";

const CartContext = createContext(null);
// v2: items now carry the seller's user id so an order can be tied to one
// wholesaler. Bumping the key discards v1 carts rather than mixing shapes.
const STORAGE_KEY = "wholesale_cart_v2";

// `supplier.supplierId` is the seller's user id; `supplier.id` is the
// inventory row id. Both matter, so resolve them explicitly.
const resolveSellerId = (product, supplier) =>
  supplier?.supplierId ??
  supplier?.vendorId ??
  product?.supplierId ??
  product?.vendorId ??
  null;

const isOwnListing = (userId, product, supplier) => {
  if (!userId) return false;
  const sellerId = resolveSellerId(product, supplier);
  return sellerId != null && String(sellerId) === String(userId);
};

export const CartProvider = ({ children }) => {
  const { user } = useAuth();
  const [items, setItems] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [isCartOpen, setIsCartOpen] = useState(false);
  // Set when the buyer tries to add a product from a different wholesaler.
  // Held here so the prompt works from every call site without plumbing.
  const [conflict, setConflict] = useState(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // localStorage unavailable (private browsing, etc.) - fail silently
    }
  }, [items]);

  // An order ships from a single wholesaler, so the cart belongs to one.
  const cartSeller = items.length
    ? { id: items[0].sellerId, name: items[0].sellerName }
    : null;

  const buildItem = (product, quantity, supplier) => {
    const sellerId = resolveSellerId(product, supplier);
    const price = supplier?.price ?? product.price ?? 0;
    return {
      // one line per inventory listing
      id: supplier ? `${product.id}#${supplier.id}` : String(product.id),
      productId: product.id,
      inventoryId: supplier?.id ?? null,
      sellerId: sellerId != null ? String(sellerId) : null,
      sellerName:
        supplier?.companyName ??
        supplier?.name ??
        product.vendorName ??
        "Wholesaler",
      name: product.name,
      image: supplier?.image ?? product.image,
      price,
      bulkPrice: supplier?.discountPrice ?? product.bulkPrice ?? price,
      bulkQuantity: supplier?.moq ?? product.bulkQuantity ?? 1,
      quantity,
    };
  };

  const commitItem = (nextItem) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.id === nextItem.id);
      if (existing) {
        return prev.map((i) =>
          i.id === nextItem.id
            ? { ...i, quantity: i.quantity + nextItem.quantity }
            : i,
        );
      }
      return [...prev, nextItem];
    });
    setIsCartOpen(true);
  };

  const addToCart = (product, quantity = 1, supplier = null) => {
    if (isOwnListing(user?.id, product, supplier)) {
      toast.error("You can't add your own listing to the cart");
      return false;
    }

    const nextItem = buildItem(product, quantity, supplier);

    // Orders cannot span wholesalers: ask before discarding the current one.
    if (cartSeller && nextItem.sellerId && cartSeller.id !== nextItem.sellerId) {
      setConflict({ nextItem, currentSeller: cartSeller });
      return false;
    }

    commitItem(nextItem);
    return true;
  };

  const resolveConflict = (replace) => {
    if (replace && conflict) {
      setItems([]);
      // commitItem reads no stale state, so this is safe immediately after
      setTimeout(() => commitItem(conflict.nextItem), 0);
    }
    setConflict(null);
  };

  const removeFromCart = (id) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const updateQuantity = (id, quantity) => {
    if (quantity < 1) return;
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, quantity } : i)));
  };

  const clearCart = () => setItems([]);

  const itemCount = useMemo(
    () => items.reduce((sum, i) => sum + i.quantity, 0),
    [items],
  );

  const uniqueItemCount = items.length;

  const subtotal = useMemo(
    () =>
      items.reduce((sum, i) => {
        const unitPrice =
          i.bulkQuantity && i.quantity >= i.bulkQuantity ? i.bulkPrice : i.price;
        return sum + unitPrice * i.quantity;
      }, 0),
    [items],
  );

  return (
    <CartContext.Provider
      value={{
        items,
        cartSeller,
        addToCart,
        isOwnListing: (product, supplier) =>
          isOwnListing(user?.id, product, supplier),
        removeFromCart,
        updateQuantity,
        clearCart,
        itemCount,
        uniqueItemCount,
        subtotal,
        isCartOpen,
        setIsCartOpen,
      }}
    >
      {children}
      {conflict && (
        <CartConflictModal
          currentSeller={conflict.currentSeller}
          incomingSeller={{
            id: conflict.nextItem.sellerId,
            name: conflict.nextItem.sellerName,
          }}
          productName={conflict.nextItem.name}
          onKeep={() => resolveConflict(false)}
          onReplace={() => resolveConflict(true)}
        />
      )}
    </CartContext.Provider>
  );
};

export const useCart = () => {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return ctx;
};

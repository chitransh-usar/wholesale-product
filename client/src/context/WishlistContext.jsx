import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const WishlistContext = createContext(null);
const STORAGE_KEY = "wholesale_wishlist_v1";

export const WishlistProvider = ({ children }) => {
  const [items, setItems] = useState(() => {
    if (typeof window === "undefined") return [];

    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // localStorage unavailable (private browsing, etc.) - fail silently
    }
  }, [items]);

  const normalizeProduct = (product) => {
    const productId =
      product?.id ?? product?.productId ?? product?.slug ?? null;
    if (!productId) return null;

    return {
      ...product,
      id: String(productId),
      name: product?.name ?? "Untitled Product",
      image: product?.image ?? "",
      description: product?.description ?? "",
      suppliers: Array.isArray(product?.suppliers) ? product.suppliers : [],
    };
  };

  const addToWishlist = (product) => {
    const normalizedProduct = normalizeProduct(product);
    if (!normalizedProduct) return;

    setItems((prev) => {
      if (prev.some((item) => item.id === normalizedProduct.id)) return prev;
      return [...prev, normalizedProduct];
    });
  };

  const removeFromWishlist = (id) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const toggleWishlist = (product) => {
    const normalizedProduct = normalizeProduct(product);
    if (!normalizedProduct) return;

    setItems((prev) => {
      const exists = prev.some((item) => item.id === normalizedProduct.id);
      if (exists) {
        return prev.filter((item) => item.id !== normalizedProduct.id);
      }

      return [...prev, normalizedProduct];
    });
  };

  const isWishlisted = (id) => items.some((item) => item.id === String(id));

  const clearWishlist = () => setItems([]);

  const itemCount = useMemo(() => items.length, [items]);

  return (
    <WishlistContext.Provider
      value={{
        items,
        addToWishlist,
        removeFromWishlist,
        toggleWishlist,
        isWishlisted,
        clearWishlist,
        itemCount,
      }}
    >
      {children}
    </WishlistContext.Provider>
  );
};

export const useWishlist = () => {
  const ctx = useContext(WishlistContext);

  if (!ctx) {
    throw new Error("useWishlist must be used within a WishlistProvider");
  }

  return ctx;
};

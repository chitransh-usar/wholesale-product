// Safely parse any incoming number/string to a strict float
export const parseNum = (val, defaultVal = 0) => {
  const num = Number(val);
  return Number.isNaN(num) ? defaultVal : num;
};

export const getEffectivePrice = (supplier) =>
  parseNum(
    supplier?.discountPrice ?? supplier?.discount_price ?? supplier?.price ?? 0,
  );

export const getCheapestSupplier = (product) => {
  const suppliers = product?.suppliers ?? [];
  if (suppliers.length === 0) return null;
  return [...suppliers].sort(
    (a, b) => getEffectivePrice(a) - getEffectivePrice(b),
  )[0];
};

export const getSortedSuppliers = (product) => {
  const suppliers = product?.suppliers ?? [];
  return [...suppliers].sort(
    (a, b) => getEffectivePrice(a) - getEffectivePrice(b),
  );
};

export const hasVerifiedSupplier = (product) =>
  (product?.suppliers ?? []).some((s) => s.verified);

export const sortSuppliers = (suppliers, sortBy) => {
  if (!Array.isArray(suppliers)) return [];
  const list = [...suppliers];

  switch (sortBy) {
    case "price-asc":
      return list.sort((a, b) => getEffectivePrice(a) - getEffectivePrice(b));
    case "price-desc":
      return list.sort((a, b) => getEffectivePrice(b) - getEffectivePrice(a));
    case "highest-rated":
      return list.sort((a, b) => parseNum(b.rating) - parseNum(a.rating));
    case "lowest-moq":
      return list.sort((a, b) => parseNum(a.moq) - parseNum(b.moq));
    case "fastest-shipping":
      return list.sort(
        (a, b) =>
          parseNum(a.shippingDays || a.shipping_days) -
          parseNum(b.shippingDays || b.shipping_days),
      );
    case "highest-stock":
      return list.sort((a, b) => parseNum(b.stock) - parseNum(a.stock));
    case "most-delivered":
      return list.sort(
        (a, b) => parseNum(b.fulfilledOrders) - parseNum(a.fulfilledOrders),
      );
    default:
      return list;
  }
};

export const filterSuppliers = (suppliers, filters) => {
  if (!Array.isArray(suppliers)) return [];
  const normalizedSearch = String(filters.search || "")
    .trim()
    .toLowerCase();
  const maxMOQ = Number(filters.maxMOQ || 0);
  const maxShipping = Number(filters.maxShipping || 0);
  const minRating = Number(filters.minRating || 0);

  return suppliers.filter((supplier) => {
    if (filters.verifiedOnly && !supplier.verified) return false;
    if (filters.gstVerifiedOnly && !supplier.gstVerified) return false;
    if (maxMOQ > 0 && parseNum(supplier.moq) > maxMOQ) return false;
    if (
      maxShipping > 0 &&
      parseNum(supplier.shippingDays || supplier.shipping_days) > maxShipping
    )
      return false;
    if (minRating > 0 && parseNum(supplier.rating) < minRating) return false;

    if (normalizedSearch) {
      const sName =
        supplier.companyName || supplier.company_name || supplier.name || "";
      const searchTarget = [sName, supplier.city, supplier.country]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!searchTarget.includes(normalizedSearch)) return false;
    }
    return true;
  });
};

export const getBestSupplierMetrics = (suppliers) => {
  const metrics = {
    lowestPriceId: null,
    lowestMOQId: null,
    highestRatingId: null,
    fastestShippingId: null,
    mostDeliveredId: null,
    highestStockId: null,
  };

  let bestPrice = Infinity,
    bestMOQ = Infinity,
    bestRating = -Infinity;
  let bestShipping = Infinity,
    bestDelivered = -Infinity,
    bestStock = -Infinity;

  suppliers.forEach((supplier) => {
    const price = getEffectivePrice(supplier);
    if (price < bestPrice) {
      bestPrice = price;
      metrics.lowestPriceId = supplier.id;
    }

    const moq = parseNum(supplier.moq);
    if (moq < bestMOQ) {
      bestMOQ = moq;
      metrics.lowestMOQId = supplier.id;
    }

    const rating = parseNum(supplier.rating);
    if (rating > bestRating) {
      bestRating = rating;
      metrics.highestRatingId = supplier.id;
    }

    const shipping = parseNum(supplier.shippingDays || supplier.shipping_days);
    if (shipping < bestShipping) {
      bestShipping = shipping;
      metrics.fastestShippingId = supplier.id;
    }

    const delivered = parseNum(supplier.fulfilledOrders);
    if (delivered > bestDelivered) {
      bestDelivered = delivered;
      metrics.mostDeliveredId = supplier.id;
    }

    const stock = parseNum(supplier.stock);
    if (stock > bestStock) {
      bestStock = stock;
      metrics.highestStockId = supplier.id;
    }
  });

  return metrics;
};

export const getSupplyLabel = (stock = 0) => {
  const currentStock = parseNum(stock);
  if (currentStock === 0) return "Out of stock";
  if (currentStock < 50) return "Low stock";
  return "High supply";
};

export const getSupplierPhone = (supplier) =>
  supplier?.contactPhone ??
  supplier?.contact_phone ??
  supplier?.phone ??
  supplier?.contactNo ??
  supplier?.mobile ??
  undefined;

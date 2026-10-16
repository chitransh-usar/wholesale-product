import PropTypes from "prop-types";
import { ShieldCheck, Star, MapPin, IndianRupee } from "lucide-react";
import {
  getEffectivePrice,
  parseNum,
  getSupplierPhone,
} from "../utils/supplierUtils";
import ContactVendorBtn from "./ContactVendorBtn";
import { amount as money } from "../utils/money";

const SupplierCard = ({
  supplier,
  productName,
  isSelected,
  onToggleSelect,
  onBuyNow,
  badges,
}) => {
  const supplierName =
    supplier.companyName ||
    supplier.company_name ||
    supplier.name ||
    "Verified Supplier";

  const metricItems = [
    {
      label: "Price",
      value: (
        <span className="inline-flex items-center gap-0.5">
          <IndianRupee className="w-3 h-3" />
          {money(getEffectivePrice(supplier))}
        </span>
      ),
      badge: badges.lowestPrice,
      badgeText: "Best",
      badgeColor: "text-clay",
    },
    {
      label: "MOQ",
      value: parseNum(supplier.moq),
      badge: badges.lowestMOQ,
      badgeText: "Lowest",
      badgeColor: "text-clay",
    },
    {
      label: "Rating",
      value: (
        <span className="inline-flex items-center gap-0.5">
          <Star className="w-3 h-3 text-amber-500" />
          {parseNum(supplier.rating).toFixed(1)}
        </span>
      ),
      badge: badges.highestRating,
      badgeText: "Top",
      badgeColor: "text-clay",
    },
    {
      label: "Stock",
      value: parseNum(supplier.stock),
      badge: badges.highestStock,
      badgeText: "Highest",
      badgeColor: "text-clay",
    },
    {
      label: "Shipping",
      value: `${parseNum(supplier.shippingDays || supplier.shipping_days)}d`,
      badge: badges.fastestShipping,
      badgeText: "Fastest",
      badgeColor: "text-clay",
    },
    {
      label: "Delivered",
      value: parseNum(supplier.fulfilledOrders),
      badge: badges.mostDelivered,
      badgeText: "Most",
      badgeColor: "text-clay",
    },
  ];

  return (
    <div
      className={`rounded-3xl border p-5 transition-all duration-200 ${
        isSelected
          ? "border-clay/30 bg-clay/3 shadow-sm"
          : "border-slate-200 bg-white"
      }`}
    >
      <div className="font-dmsans flex items-start justify-between gap-3">
        <label className="inline-flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(supplier.id)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-clay focus:ring-clay/20"
          />
          <div>
            <span className="font-dmsans text-sm font-bold text-slate-900">
              {supplierName}
            </span>
            <span className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500">
              <MapPin className="w-3 h-3" />
              {supplier.city}, {supplier.country}
            </span>
          </div>
        </label>
        {supplier.verified && (
          <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
            <ShieldCheck className="w-3 h-3" />
            Verified
          </span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2.5">
        {metricItems.map((item) => (
          <div
            key={item.label}
            className="rounded-2xl border border-slate-100 bg-slate-50/70 px-3 py-2.5"
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
              {item.label}
            </p>
            <p
              className={`mt-1 font-dmsans text-sm font-bold ${
                item.badge ? item.badgeColor : "text-slate-900"
              }`}
            >
              {item.value}
            </p>
            {item.badge && (
              <p
                className={`mt-0.5 text-[10px] font-semibold ${item.badgeColor}`}
              >
                {item.badgeText}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex gap-2">
        <ContactVendorBtn
          vendorId={supplier.id}
          vendorName={supplierName}
          productName={productName}
          vendorPhone={getSupplierPhone(supplier)}
          trigger={(open) => (
            <button
              type="button"
              onClick={open}
              className="flex-1 rounded-full border border-slate-200 bg-white py-2.5 text-xs font-bold uppercase tracking-wider text-slate-700 transition hover:bg-slate-50"
            >
              Contact
            </button>
          )}
        />
        <button
          type="button"
          onClick={() => onBuyNow(supplier)}
          className="flex-1 rounded-full bg-clay py-2.5 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-clay/90"
        >
          Buy Now
        </button>
      </div>
    </div>
  );
};

SupplierCard.propTypes = {
  supplier: PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    name: PropTypes.string,
    companyName: PropTypes.string,
    verified: PropTypes.bool,
    rating: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    reviews: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    price: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    moq: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    stock: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    shippingDays: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    city: PropTypes.string,
    country: PropTypes.string,
    fulfilledOrders: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  }).isRequired,
  isSelected: PropTypes.bool.isRequired,
  onToggleSelect: PropTypes.func.isRequired,
  onBuyNow: PropTypes.func.isRequired,
  badges: PropTypes.object.isRequired,
};

export default SupplierCard;

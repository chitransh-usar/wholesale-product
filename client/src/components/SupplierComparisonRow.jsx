import PropTypes from "prop-types";
import { Link } from "react-router-dom";
import { ShieldCheck, Star, MapPin, IndianRupee, Store } from "lucide-react";
import {
  getEffectivePrice,
  parseNum,
  getSupplierPhone,
} from "../utils/supplierUtils";
import ContactVendorBtn from "./ContactVendorBtn";

const SupplierComparisonRow = ({
  supplier,
  isSelected,
  onToggleSelect,
  productName,
  onBuyNow,
  badges,
}) => {
  const supplierName =
    supplier.companyName ||
    supplier.company_name ||
    supplier.name ||
    "Verified Supplier";
  const shippingDays = parseNum(
    supplier.shippingDays || supplier.shipping_days,
  );

  // The way into the seller's own page. Their off-catalogue range is not
  // visible from here at all, so this is the only route to it.
  const sellerId = supplier.supplierId || supplier.supplier_id;
  const catalogSize = parseNum(supplier.catalogSize) || 0;
  const exclusiveCount = parseNum(supplier.exclusiveCount) || 0;

  return (
    <tr
      className={`group  transition-colors duration-150 ${
        isSelected ? "bg-clay/3" : "hover:bg-slate-50/80"
      }`}
    >
      <td className="whitespace-nowrap px-5 py-4">
        <label className="inline-flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(supplier.id)}
            className="h-4 w-4 rounded border-slate-300 text-clay focus:ring-clay/20"
          />
          <div className="flex flex-col">
            <span className="font-dmsans text-sm font-bold text-slate-900">
              {supplierName}
            </span>
            <span className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-400">
              <MapPin className="w-3 h-3" />
              {supplier.city}, {supplier.country}
            </span>
          </div>
        </label>

        {sellerId && catalogSize > 1 && (
          <Link
            to={`/wholesaler/${sellerId}`}
            onClick={(e) => e.stopPropagation()}
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-clay hover:text-espresso hover:underline"
          >
            <Store className="w-3 h-3" />
            {exclusiveCount > 0
              ? `${exclusiveCount} more only on their storefront`
              : `View all ${catalogSize} products`}
          </Link>
        )}
      </td>
      <td className="px-4 py-4">
        {supplier.verified ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
            <ShieldCheck className="w-3 h-3" />
            Verified
          </span>
        ) : (
          <span className="text-[11px] text-slate-400">-</span>
        )}
      </td>
      <td className="px-4 py-4">
        <span className="inline-flex items-center gap-1">
          <Star className="w-3.5 h-3.5 text-amber-500" />
          <span
            className={`font-dmsans text-sm font-bold ${
              badges.highestRating ? "text-amber-700" : "text-slate-900"
            }`}
          >
            {parseNum(supplier.rating).toFixed(1)}
          </span>
        </span>
      </td>
      <td className="px-4 py-4 font-inter text-sm text-slate-600">
        {parseNum(supplier.reviews)}
      </td>
      <td className="px-4 py-4">
        <span className="inline-flex items-center gap-0.5">
          <IndianRupee
            className={`w-3.5 h-3.5 ${
              badges.lowestPrice ? "text-emerald-700" : "text-slate-400"
            }`}
          />
          <span className="font-dmsans text-sm font-bold">
            {getEffectivePrice(supplier)}
          </span>
        </span>
      </td>
      <td className="px-4 py-4">
        <span
          className={`font-dmsans text-sm font-bold ${
            badges.lowestMOQ ? "text-emerald-700" : "text-slate-900"
          }`}
        >
          {parseNum(supplier.moq)}
        </span>
      </td>
      <td className="px-4 py-4">
        <span
          className={`font-dmsans text-sm font-bold ${
            badges.highestStock ? "text-emerald-700" : "text-slate-900"
          }`}
        >
          {parseNum(supplier.stock)}
        </span>
      </td>
      <td className="px-4 py-4">
        <span
          className={`font-inter text-sm font-medium ${
            badges.fastestShipping ? "text-sky-700" : "text-slate-600"
          }`}
        >
          {shippingDays} days
        </span>
      </td>
      <td className="px-4 py-4 font-inter text-sm text-slate-600">
        {supplier.city}, {supplier.country}
      </td>
      <td className="px-4 py-4">
        <span
          className={`font-dmsans text-sm font-bold ${
            badges.mostDelivered ? "text-violet-700" : "text-slate-900"
          }`}
        >
          {parseNum(supplier.fulfilledOrders)}
        </span>
      </td>
      <td className="px-4 py-4">
        <div className="flex items-center gap-2">
          <ContactVendorBtn
            vendorId={supplier.id}
            vendorName={supplierName}
            productName={productName}
            vendorPhone={getSupplierPhone(supplier)}
            trigger={(open) => (
              <button
                type="button"
                onClick={open}
                className="rounded-full border border-slate-200 px-3.5 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-600 transition hover:bg-slate-50"
              >
                Contact
              </button>
            )}
          />
          <button
            type="button"
            onClick={() => onBuyNow(supplier)}
            className="rounded-full bg-clay px-3.5 py-2 text-[11px] font-bold uppercase tracking-wider text-white transition hover:bg-clay/90"
          >
            Buy
          </button>
        </div>
      </td>
    </tr>
  );
};

SupplierComparisonRow.propTypes = {
  supplier: PropTypes.object.isRequired,
  isSelected: PropTypes.bool.isRequired,
  onToggleSelect: PropTypes.func.isRequired,
  onBuyNow: PropTypes.func.isRequired,
  badges: PropTypes.object.isRequired,
};

export default SupplierComparisonRow;

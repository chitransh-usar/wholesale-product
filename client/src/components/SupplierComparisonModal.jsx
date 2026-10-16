import PropTypes from "prop-types";
import {
  ShieldCheck,
  Star,
  IndianRupee,
  CheckCircle,
  MapPin,
  X,
} from "lucide-react";
import ModalShell from "./ModalShell";
import ContactVendorBtn from "./ContactVendorBtn";
import { getEffectivePrice, getSupplierPhone } from "../utils/supplierUtils";

const STAT_FIELDS = [
  { key: "moq", label: "MOQ", bestKey: "lowestMOQId" },
  { key: "stock", label: "Stock", bestKey: "highestStockId" },
  {
    key: "shippingDays",
    label: "Shipping",
    bestKey: "fastestShippingId",
    suffix: "d",
  },
  { key: "rating", label: "Rating", bestKey: "highestRatingId" },
  { key: "reviews", label: "Reviews" },
  {
    key: "fulfilledOrders",
    label: "Orders Delivered",
    bestKey: "mostDeliveredId",
  },
  { key: "catalogSize", label: "Catalog Size" },
];

const isBestFor = (metrics, supplierId, bestKey) =>
  bestKey ? metrics[bestKey] === supplierId : false;

const SupplierComparisonModal = ({
  open,
  onClose,
  suppliers,
  metrics,
  onBuyNow,
  productName,
}) => {
  if (!open) return null;

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-5xl">
      {/* Header */}
      <div className="font-dmsans sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-clay">
            Side-by-side
          </p>
          <h2 className="mt-1 text-lg sm:text-xl font-bold text-slate-900">
            Comparing {suppliers.length} suppliers
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-full p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          aria-label="Close comparison"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* MOBILE: swipeable supplier cards */}
      <div className="md:hidden px-4 pt-4 pb-6">
        <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1">
          {suppliers.map((supplier) => {
            const priceIsBest = metrics.lowestPriceId === supplier.id;
            const supplierName =
              supplier.companyName ||
              supplier.company_name ||
              supplier.name ||
              "Verified Supplier";

            return (
              <div
                key={supplier.id}
                className="shrink-0 snap-center w-[85%] rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-slate-900 leading-tight">
                      {supplierName}
                    </p>
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
                      <MapPin className="w-3 h-3 shrink-0" />
                      {supplier.city}, {supplier.country}
                    </p>
                  </div>
                  {supplier.verified && (
                    <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">
                      <ShieldCheck className="w-3 h-3" />
                      Verified
                    </span>
                  )}
                </div>

                <div
                  className={`mt-4 rounded-xl border p-3.5 ${
                    priceIsBest
                      ? "border-clay/30 bg-clay/5 ring-1 ring-inset ring-clay/10"
                      : "border-slate-100 bg-slate-50/60"
                  }`}
                >
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Price{" "}
                    {priceIsBest && (
                      <span className="text-clay ml-1">· Best</span>
                    )}
                  </p>
                  <p
                    className={`mt-1 flex items-center gap-0.5 text-2xl font-black ${
                      priceIsBest ? "text-clay" : "text-slate-900"
                    }`}
                  >
                    <IndianRupee className="w-5 h-5" strokeWidth={3} />
                    {Number(getEffectivePrice(supplier)).toFixed(2)}
                    <span className="text-xs font-medium text-slate-400 mb-1 ml-0.5 self-end">
                      /unit
                    </span>
                  </p>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  {STAT_FIELDS.map((field) => {
                    const best = isBestFor(metrics, supplier.id, field.bestKey);
                    // Use actual shipping_days if shippingDays is missing (DB column name variation)
                    const rawValue =
                      field.key === "shippingDays"
                        ? supplier.shippingDays || supplier.shipping_days
                        : supplier[field.key];
                    const parsedNum = Number(rawValue ?? 0);

                    const value =
                      field.key === "rating"
                        ? parsedNum.toFixed(1)
                        : `${rawValue ?? "-"}${field.suffix ?? ""}`;

                    return (
                      <div
                        key={field.key}
                        className={`rounded-lg border px-3 py-2 ${
                          best
                            ? "border-clay/20 bg-clay/5"
                            : "border-slate-100 bg-white"
                        }`}
                      >
                        <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                          {field.label}
                        </p>
                        <p
                          className={`mt-1 flex items-center gap-1 text-sm font-bold ${
                            best ? "text-clay" : "text-slate-900"
                          }`}
                        >
                          {field.key === "rating" && (
                            <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                          )}
                          {value}
                        </p>
                      </div>
                    );
                  })}
                  <div className="rounded-lg border border-slate-100 bg-white px-3 py-2">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                      GST
                    </p>
                    <p className="mt-1 text-sm font-bold">
                      {supplier.gstVerified ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700">
                          <CheckCircle className="w-3.5 h-3.5" /> Yes
                        </span>
                      ) : (
                        <span className="text-slate-400">No</span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="mt-5 flex gap-2">
                  <ContactVendorBtn
                    vendorId={supplier.id}
                    vendorName={supplierName}
                    productName={productName}
                    vendorPhone={getSupplierPhone(supplier)}
                    trigger={(triggerOpen) => (
                      <button
                        type="button"
                        onClick={triggerOpen}
                        className="flex-1 rounded-lg border border-slate-200 bg-white py-3 text-[11px] font-bold uppercase tracking-wider text-slate-700 transition hover:bg-slate-50 shadow-sm"
                      >
                        Contact
                      </button>
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => onBuyNow(supplier)}
                    className="flex-1 rounded-lg bg-clay py-3 text-[11px] font-bold uppercase tracking-wider text-white transition hover:bg-clay/90 shadow-sm shadow-clay/20"
                  >
                    Buy Now
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-center text-[11px] font-medium text-slate-400">
          Swipe to see all suppliers →
        </p>
      </div>

      {/* DESKTOP: Refined modern table */}
      <div className="hidden font-dmsans md:block p-6 bg-slate-50/50">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-900/5">
          <table className="w-full text-left text-sm table-fixed">
            <thead className="bg-slate-50/80 border-b border-slate-200">
              <tr>
                <th className="w-45 p-5 align-bottom text-[11px] font-bold uppercase tracking-widest text-slate-400">
                  Compare Features
                </th>
                {suppliers.map((supplier) => (
                  <th
                    key={supplier.id}
                    className="p-5 align-top border-l border-slate-100"
                  >
                    <div className="flex flex-col gap-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-base font-bold text-slate-900 leading-tight">
                          {supplier.companyName ||
                            supplier.company_name ||
                            supplier.name ||
                            "Supplier"}
                        </span>
                        {supplier.verified && (
                          <span
                            title="Verified Supplier"
                            className="shrink-0 inline-flex rounded-md bg-emerald-50 p-1 text-emerald-600 ring-1 ring-inset ring-emerald-600/20"
                          >
                            <ShieldCheck className="w-4 h-4" />
                          </span>
                        )}
                      </div>
                      <span className="flex items-center gap-1.5 text-[13px] font-medium text-slate-500">
                        <MapPin className="w-3.5 h-3.5" />
                        {supplier.city}, {supplier.country}
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {/* Highlighted Price Row */}
              <tr className="group transition-colors hover:bg-slate-50/50">
                <td className="w-45 p-5 font-bold text-slate-700">
                  Unit Price
                </td>
                {suppliers.map((supplier) => {
                  const best = metrics.lowestPriceId === supplier.id;
                  return (
                    <td
                      key={supplier.id}
                      className={`p-5 border-l border-slate-100 transition-colors ${
                        best
                          ? "bg-clay/5 ring-1 ring-inset ring-clay/10 relative"
                          : ""
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center text-xl font-black ${
                            best ? "text-clay" : "text-slate-900"
                          }`}
                        >
                          <IndianRupee className="w-4 h-4" strokeWidth={3} />
                          {Number(getEffectivePrice(supplier)).toFixed(2)}
                        </span>
                        {best && (
                          <span className="rounded bg-clay px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-sm">
                            Best Rate
                          </span>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>

              {/* Dynamic Stats */}
              {STAT_FIELDS.map((field) => (
                <tr
                  key={field.key}
                  className="group transition-colors hover:bg-slate-50/50"
                >
                  <td className="w-45 p-5 font-medium text-slate-600">
                    {field.label}
                  </td>
                  {suppliers.map((supplier) => {
                    const best = isBestFor(metrics, supplier.id, field.bestKey);
                    // Use actual shipping_days if shippingDays is missing
                    const rawValue =
                      field.key === "shippingDays"
                        ? supplier.shippingDays || supplier.shipping_days
                        : supplier[field.key];
                    return (
                      <td
                        key={`${supplier.id}-${field.key}`}
                        className={`p-5 border-l border-slate-100 transition-colors ${
                          best
                            ? "bg-clay/5 ring-1 ring-inset ring-clay/10 relative"
                            : ""
                        }`}
                      >
                        {field.key === "rating" ? (
                          <div className="flex items-center gap-1.5">
                            <Star
                              className={`w-4 h-4 ${
                                best
                                  ? "text-clay fill-clay/20"
                                  : "text-amber-400 fill-amber-400"
                              }`}
                            />
                            <span
                              className={`font-bold ${
                                best ? "text-clay" : "text-slate-800"
                              }`}
                            >
                              {Number(rawValue ?? 0).toFixed(1)}
                            </span>
                          </div>
                        ) : (
                          <span
                            className={
                              best
                                ? "font-bold text-clay flex items-center gap-2"
                                : "font-medium text-slate-700"
                            }
                          >
                            {rawValue ?? "-"}
                            {field.suffix ?? ""}
                            {best && (
                              <span className="w-1.5 h-1.5 rounded-full bg-clay"></span>
                            )}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}

              {/* GST Row */}
              <tr className="group transition-colors hover:bg-slate-50/50">
                <td className="w-45 p-5 font-medium text-slate-600">
                  GST Verified
                </td>
                {suppliers.map((supplier) => (
                  <td
                    key={supplier.id}
                    className="p-5 border-l border-slate-100"
                  >
                    {supplier.gstVerified ? (
                      <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md text-sm border border-emerald-100 w-fit">
                        <CheckCircle className="w-4 h-4" /> Yes
                      </span>
                    ) : (
                      <span className="text-sm font-medium text-slate-400">
                        No
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>

            {/* Action Buttons Integrated into Table Footer */}
            <tfoot className="bg-slate-50/80 border-t border-slate-200">
              <tr>
                <td className="w-45 p-5 font-medium text-slate-500">
                  Take Action
                </td>
                {suppliers.map((supplier) => (
                  <td
                    key={supplier.id}
                    className="p-5 border-l border-slate-200"
                  >
                    <div className="flex flex-col xl:flex-row gap-2">
                      <ContactVendorBtn
                        vendorId={supplier.id}
                        vendorName={
                          supplier.companyName ||
                          supplier.company_name ||
                          supplier.name ||
                          "Supplier"
                        }
                        productName={productName}
                        vendorPhone={getSupplierPhone(supplier)}
                        trigger={(triggerOpen) => (
                          <button
                            type="button"
                            onClick={triggerOpen}
                            className="flex-1 w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-slate-700 transition hover:bg-slate-100 hover:text-slate-900 shadow-sm"
                          >
                            Contact
                          </button>
                        )}
                      />
                      <button
                        type="button"
                        onClick={() => onBuyNow(supplier)}
                        className="flex-1 w-full rounded-lg bg-clay px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-clay/90 shadow-sm shadow-clay/20"
                      >
                        Buy Now
                      </button>
                    </div>
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </ModalShell>
  );
};

SupplierComparisonModal.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  suppliers: PropTypes.arrayOf(PropTypes.object).isRequired,
  metrics: PropTypes.object.isRequired,
  onBuyNow: PropTypes.func.isRequired,
  productName: PropTypes.string,
};

export default SupplierComparisonModal;

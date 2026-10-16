import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  CreditCard,
  Download,
  FileText,
  IndianRupee,
  MapPin,
  Package,
  Truck,
} from "lucide-react";
import api from "../utils/axios";
import { downloadFile } from "../utils/download";
import { toast } from "sonner";
import { formatOrderStatus, getOrderStatusStyle } from "../utils/orderStatus";
import OrderTracking from "../components/OrderTracking";
import InstallmentTimeline from "../components/InstallmentTimeline";

const PAYMENT_STYLES = {
  paid: "bg-emerald-100 text-emerald-700 border-emerald-200",
  partial: "bg-amber-100 text-amber-700 border-amber-200",
  cod: "bg-sky-100 text-sky-700 border-sky-200",
  pending: "bg-amber-100 text-amber-700 border-amber-200",
  failed: "bg-rose-100 text-rose-700 border-rose-200",
  refunded: "bg-slate-100 text-slate-700 border-slate-200",
};

const paymentStyle = (status) =>
  PAYMENT_STYLES[String(status || "").toLowerCase()] ||
  "bg-slate-100 text-slate-700 border-slate-200";

const Field = ({ label, children }) => (
  <div>
    <p className="text-[10px] font-bold uppercase tracking-wider text-espresso/40">
      {label}
    </p>
    <p className="mt-1 font-semibold text-espresso">{children}</p>
  </div>
);

// delivery_address is stored as JSON; render whatever shape it holds.
const formatAddress = (address) => {
  if (!address) return null;
  let value = address;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return value;
    }
  }
  if (typeof value !== "object") return String(value);
  const parts = [
    value.name,
    value.house,
    value.street,
    value.area,
    value.city,
    value.state,
    value.country,
    value.pincode,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
};

const OrderDetails = () => {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [orderResponse, timelineResponse] = await Promise.all([
          api.get(`/api/orders/${orderId}`),
          api.get(`/api/orders/${orderId}/timeline`),
        ]);
        setOrder(orderResponse.data);
        setTimeline(timelineResponse.data?.timeline || []);
      } catch (error) {
        console.error(error);
        toast.error("Could not load the order details");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [orderId]);

  // The seller issues the invoice; this fetches that exact document rather
  // than rendering a second, differently numbered one for the buyer.
  const downloadInvoice = async () => {
    try {
      await downloadFile(
        `/api/invoices/by-order/${orderId}/pdf`,
        `invoice-${order?.order_number || orderId}.pdf`,
      );
      toast.success("Invoice downloaded");
    } catch (err) {
      console.error("Invoice download failed", err);
      toast.error("Invoice could not be downloaded");
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="py-20 text-center">
        <Package className="mx-auto mb-3 h-10 w-10 text-espresso/15" />
        <p className="font-bold text-espresso">Order not found</p>
        <Link
          to="/orders"
          className="mt-4 inline-block text-sm font-semibold text-clay hover:underline"
        >
          Back to your orders
        </Link>
      </div>
    );
  }

  // Multi-item orders carry `items`; older single-item orders only have the
  // flattened product columns, so synthesise one line from those.
  const lineItems =
    Array.isArray(order.items) && order.items.length > 0
      ? order.items
      : [
          {
            id: "legacy",
            product_id: order.product_id,
            product_name: order.product_name,
            category: order.product_category,
            image: order.product_image,
            quantity: order.quantity,
            unit_price: order.unit_discount_price || order.unit_price,
            total_price: order.total_amount,
            moq: order.moq,
            shipping_days: order.shipping_days,
          },
        ];

  const quantity = Number(order.quantity) || 1;
  const total = Number(order.total_amount) || 0;
  const address = formatAddress(order.delivery_address);
  const supplierLocation = [order.supplier_city, order.supplier_country]
    .filter(Boolean)
    .join(", ");
  const placed = order.created_at
    ? new Date(order.created_at).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "-";

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 pb-16">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={() => navigate(-1)}
          className="group flex items-center gap-2 text-sm font-semibold text-espresso/60 transition-colors hover:text-espresso"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          Back
        </button>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={downloadInvoice}
            className="flex items-center gap-2 rounded-xl border border-sage/40 bg-white px-3 py-2 text-xs font-bold text-espresso transition-colors hover:bg-sage/10"
          >
            <Download className="h-4 w-4" /> Invoice
          </button>
          <Link
            to={`/orders/${orderId}`}
            onClick={(e) => {
              e.preventDefault();
              window.open(`/api/orders/${orderId}/packing-slip`, "_blank");
            }}
            className="flex items-center gap-2 rounded-xl border border-sage/40 bg-white px-3 py-2 text-xs font-bold text-espresso transition-colors hover:bg-sage/10"
          >
            <FileText className="h-4 w-4" /> Packing slip
          </Link>
        </div>
      </div>

      {/* Summary */}
      <section className="rounded-2xl border border-sage/20 bg-white/80 p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-espresso">
              {order.order_number || `ORD-${order.id}`}
            </h1>
            <p className="mt-1 text-sm text-espresso/50">Placed {placed}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span
              className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${getOrderStatusStyle(
                order.status,
              )}`}
            >
              {formatOrderStatus(order.status)}
            </span>
            <span
              className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${paymentStyle(
                order.payment_status,
              )}`}
            >
              Payment: {order.payment_status || "pending"}
            </span>
          </div>
        </div>
      </section>

      {/* What was ordered */}
      <section className="rounded-2xl border border-sage/20 bg-white/80 p-5 shadow-sm sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-bold text-espresso">
            <Package className="h-5 w-5 text-clay" />
            What you ordered
          </h2>
          <span className="text-xs font-semibold text-espresso/40">
            {lineItems.length} item{lineItems.length === 1 ? "" : "s"}
          </span>
        </div>

        {order.supplier_name && (
          <p className="mb-4 flex flex-wrap items-center gap-1.5 text-sm text-espresso/60">
            <Building2 className="h-3.5 w-3.5 shrink-0" />
            Sold by
            {order.supplier_user_id ? (
              <Link
                to={`/wholesaler/${order.supplier_user_id}`}
                className="font-semibold text-espresso hover:text-clay hover:underline"
              >
                {order.supplier_name}
              </Link>
            ) : (
              <span className="font-semibold text-espresso">
                {order.supplier_name}
              </span>
            )}
            {supplierLocation && (
              <span className="text-espresso/40">· {supplierLocation}</span>
            )}
          </p>
        )}

        <div className="divide-y divide-sage/15">
          {lineItems.map((item) => {
            const lineQty = Number(item.quantity) || 1;
            const lineUnit =
              Number(item.unit_price) ||
              (Number(item.total_price) || 0) / lineQty;
            return (
              <div
                key={item.id}
                className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
              >
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-sage/20 bg-sage/10">
                  {item.image ? (
                    <img
                      src={item.image}
                      alt={item.product_name || "Product"}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Package className="h-6 w-6 text-espresso/15" />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  {item.category && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-espresso/40">
                      {item.category}
                    </span>
                  )}
                  {item.product_id ? (
                    <Link
                      to={`/product/${item.product_id}`}
                      className="block truncate font-bold text-espresso transition-colors hover:text-clay"
                    >
                      {item.product_name || "Product"}
                    </Link>
                  ) : (
                    <p className="truncate font-bold text-espresso">
                      {item.product_name || "Product"}
                    </p>
                  )}
                  <p className="mt-0.5 text-xs text-espresso/50">
                    {lineQty} × ₹{Number(lineUnit).toLocaleString("en-IN")}
                    {item.moq != null && ` · MOQ ${item.moq}`}
                    {item.shipping_days != null &&
                      ` · ships in ${item.shipping_days}d`}
                  </p>
                </div>

                <p className="shrink-0 text-right font-bold text-espresso">
                  ₹
                  {Number(
                    item.total_price || lineUnit * lineQty,
                  ).toLocaleString("en-IN")}
                </p>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-sage/20 pt-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-espresso/40">
              Order total
            </p>
            <p className="mt-0.5 text-[11px] text-espresso/40">
              {quantity} unit{quantity === 1 ? "" : "s"} in total
            </p>
          </div>
          <p className="flex items-center text-2xl font-black text-clay">
            <IndianRupee className="h-5 w-5" />
            {total.toLocaleString("en-IN")}
          </p>
        </div>
      </section>

      {/* Delivery + payment */}
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-2xl border border-sage/20 bg-white/80 p-5 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 font-bold text-espresso">
            <MapPin className="h-4 w-4 text-clay" />
            Delivery address
          </h2>
          <p className="text-sm leading-relaxed text-espresso/70">
            {address || "No delivery address recorded."}
          </p>
          {order.contact_phone && (
            <p className="mt-2 text-sm text-espresso/50">
              Phone: {order.contact_phone}
            </p>
          )}
          {order.expected_delivery_date && (
            <p className="mt-2 text-sm text-espresso/50">
              Expected by{" "}
              {new Date(order.expected_delivery_date).toLocaleDateString(
                "en-IN",
                { day: "numeric", month: "short", year: "numeric" },
              )}
            </p>
          )}
        </section>

        <section className="rounded-2xl border border-sage/20 bg-white/80 p-5 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 font-bold text-espresso">
            <CreditCard className="h-4 w-4 text-clay" />
            Payment
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Status">{order.payment_status || "pending"}</Field>
            <Field label="Order total">₹{total.toLocaleString("en-IN")}</Field>
            {order.subtotal != null && (
              <Field label="Subtotal">
                ₹{Number(order.subtotal).toLocaleString("en-IN")}
              </Field>
            )}
            {Number(order.discount_amount) > 0 && (
              <Field label="Discount">
                −₹{Number(order.discount_amount).toLocaleString("en-IN")}
              </Field>
            )}
          </div>
        </section>
      </div>

      {/* Only meaningful on a plan that has stages, so it stays out of the
          way of an ordinary pay-once order. */}
      {order.payment_plan === "installment_50_50" && (
        <InstallmentTimeline
          payments={order.payments || []}
          totalAmount={total}
          paymentPlan={order.payment_plan}
        />
      )}

      <OrderTracking orderId={orderId} />

      {/* Timeline */}
      <section className="rounded-2xl border border-sage/20 bg-white/80 p-5 shadow-sm sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-espresso">
          <Truck className="h-5 w-5 text-clay" />
          Order timeline
        </h2>

        {timeline.length === 0 ? (
          <p className="text-sm text-espresso/50">No movement recorded yet.</p>
        ) : (
          <ol className="relative space-y-5 border-l border-sage/30 pl-6">
            {timeline.map((entry, index) => (
              <li key={entry.id || index} className="relative">
                <span className="absolute -left-[1.9rem] top-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-white bg-clay" />
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${getOrderStatusStyle(
                      entry.status,
                    )}`}
                  >
                    {formatOrderStatus(entry.status)}
                  </span>
                  <span className="text-[11px] text-espresso/40">
                    {entry.created_at
                      ? new Date(entry.created_at).toLocaleString("en-IN")
                      : ""}
                  </span>
                </div>
                {entry.remarks && (
                  <p className="mt-1 text-sm text-espresso/60">
                    {entry.remarks}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
};

export default OrderDetails;

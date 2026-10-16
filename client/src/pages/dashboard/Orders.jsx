import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Plus,
  Search,
  Eye,
  Clock,
  ArrowRight,
  Truck,
  XCircle,
  Undo2,
} from "lucide-react";
import api from "../../utils/axios";
import { toast } from "sonner";
import DispatchModal from "../../components/DispatchModal";
import RefuseOrderModal from "../../components/RefuseOrderModal";
import {
  ORDER_TABS,
  formatOrderStatus,
  getOrderStatusStyle,
  matchesOrderTab,
  getNextStep,
  needsAction,
  canRefuse,
  isReturnRequested,
  RETURN_ANSWERS,
} from "../../utils/orderStatus";

/**
 * Goods already out on a challan against this order.
 *
 * Sits next to the product line so they can see at a glance which orders have
 * stock away from the godown while money is still owed, without opening each
 * one. Nothing shows when there are none, which is the ordinary case.
 */
const ChallanCount = ({ count }) => {
  const n = Number(count || 0);
  if (n <= 0) return null;
  return (
    <span className="ml-1.5 inline-flex items-center gap-1 text-amber-700">
      <Truck className="h-3 w-3" />
      {n} {n === 1 ? "challan" : "challans"}
    </span>
  );
};

const Orders = () => {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("All Orders");
  const [searchQuery, setSearchQuery] = useState("");
  // The order id currently being advanced, so only its own button waits.
  const [working, setWorking] = useState(null);
  const [dispatching, setDispatching] = useState(null);
  const [refusing, setRefusing] = useState(null);

  useEffect(() => {
    const fetchOrders = async () => {
      try {
        const response = await api.get("/api/orders/supplier");
        setOrders(response.data);
      } catch (error) {
        console.error("Failed to fetch orders:", error);
        toast.error("Could not load your orders.");
      } finally {
        setLoading(false);
      }
    };
    fetchOrders();
  }, []);

  const applyStatus = (orderId, status) =>
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status } : o)),
    );

  /**
   * Move one order to its next step.
   *
   * The row updates from what the server accepted, not from what the button
   * hoped for. A wholesaler with the page open on two phones would otherwise
   * see a step succeed locally that the server had refused.
   */
  const advance = async (order) => {
    const step = getNextStep(order.status);
    if (!step) return;
    if (step.dispatch) {
      setDispatching(order);
      return;
    }

    setWorking(order.id);
    try {
      await api.patch(`/api/orders/${order.id}/status`, { status: step.to });
      applyStatus(order.id, step.to);
      toast.success(`${order.order_number || "Order"}: ${step.label.toLowerCase()} done.`);
    } catch (err) {
      toast.error(
        err.response?.data?.message ||
          "Could not update this order. Refresh and try again.",
      );
    } finally {
      setWorking(null);
    }
  };

  /**
   * Answer a return the buyer has asked for.
   *
   * Separate from advance() because this is a choice rather than a step, and
   * because accepting a return is the point where the money unwinds: the
   * server cancels the sale so the customer stops owing for goods that are
   * coming back. Worth saying out loud in the toast, because a wholesaler
   * who does not realise customer khata just changed will go looking for the
   * difference later.
   */
  const answerReturn = async (order, answer) => {
    setWorking(order.id);
    try {
      await api.patch(`/api/orders/${order.id}/status`, { status: answer.to });
      applyStatus(order.id, answer.to);
      toast.success(
        answer.to === "return_approved"
          ? "Return accepted. Mark it once the goods are back with you."
          : "Return refused. This order stays owed.",
      );
    } catch (err) {
      toast.error(
        err.response?.data?.message ||
          "Could not answer this return. Refresh and try again.",
      );
    } finally {
      setWorking(null);
    }
  };

  const tabs = ORDER_TABS.map((t) => t.label);

  const getStatusStyle = getOrderStatusStyle;

  // Filter orders based on Tab and Search Input
  const displayedOrders = orders.filter((order) => {
    const matchesTab = matchesOrderTab(order.status, filter);
    const matchesSearch =
      searchQuery === "" ||
      order.id.toString().includes(searchQuery) ||
      order.buyer.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.product.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesTab && matchesSearch;
  });

  const waitingCount = orders.filter((o) => needsAction(o.status)).length;

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="w-8 h-8 border-4 border-clay border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-espresso">Orders</h2>
          {/* The count that matters is not how many orders exist, it is how
              many are waiting on them. */}
          <p className="text-sm text-slate-500 mt-1">
            {waitingCount > 0 ? (
              <>
                <span className="font-bold text-clay">
                  {waitingCount} order{waitingCount === 1 ? "" : "s"}
                </span>{" "}
                waiting for you.
              </>
            ) : (
              "Nothing waiting on you right now."
            )}
          </p>
        </div>

        {/* An order taken on the phone or at the counter. Everything else on
            this screen arrived from the shop page, so until now a wholesaler
            whose customer rang up had nowhere to put it. */}
        <Link
          to="/seller/orders/new"
          className="flex shrink-0 items-center gap-2 rounded-lg bg-clay px-4 py-2.5 text-sm font-bold text-cream transition-colors hover:bg-espresso"
        >
          <Plus className="h-4 w-4" />
          Take an order
        </Link>
      </div>

      {/* Filters and Search */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        {/* Scrolls sideways on a phone, wraps on a wide screen. Adding a
            seventh tab pushed the last one under the search box, where it
            read "Cance" and could not be clicked. Wrapping is the only one of
            the two that cannot hide a tab. */}
        <div className="flex flex-nowrap lg:flex-wrap items-center gap-2 w-full min-w-0 lg:w-auto overflow-x-auto lg:overflow-visible pb-2 lg:pb-0 hide-scrollbar">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-colors cursor-pointer ${
                filter === tab
                  ? "bg-slate-100 text-espresso"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* There was a funnel button here that did nothing at all, and an
            Export CSV button beside the heading that did nothing either. The
            tabs above are the filter. */}
        <div className="flex items-center gap-3 w-full lg:w-auto">
          <div className="relative w-full sm:w-64 shrink-0">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search order number or buyer..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:bg-white focus:border-clay focus:ring-1 focus:ring-clay outline-none transition-all"
            />
          </div>
        </div>
      </div>

      {/* Phone gets cards. Five columns on a 390px screen put the action
          button off the right edge behind a sideways scroll, and this is the
          screen a wholesaler uses standing in their godown with one hand. */}
      <div className="space-y-3 sm:hidden">
        {displayedOrders.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 shadow-sm">
            No orders found.
          </div>
        ) : (
          displayedOrders.map((order) => {
            const step = getNextStep(order.status);
            const busy = working === order.id;
            const Icon = step?.dispatch ? Truck : ArrowRight;
            return (
              <div
                key={order.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm font-bold text-espresso">
                      {order.order_number || `ORD-${order.id}`}
                    </p>
                    <p className="mt-0.5 truncate text-sm font-bold text-slate-800">
                      {order.buyer}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {order.product}
                      {order.item_count > 1 && (
                        <span className="text-slate-400">
                          {" "}+ {order.item_count - 1} more
                        </span>
                      )}
                      <ChallanCount count={order.challan_count} />
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${getStatusStyle(order.status)}`}
                  >
                    {formatOrderStatus(order.status)}
                  </span>
                </div>

                <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                  <div>
                    <span className="text-base font-bold text-clay">
                      ₹{Number(order.amount).toLocaleString("en-IN")}
                    </span>
                    <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      {order.qty} units
                    </span>
                  </div>
                  <button
                    onClick={() => navigate(`/seller/orders/${order.id}`)}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700"
                  >
                    View
                  </button>
                </div>

                {isReturnRequested(order.status) && (
                  <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
                    {RETURN_ANSWERS.map((answer) => (
                      <button
                        key={answer.to}
                        onClick={() => answerReturn(order, answer)}
                        disabled={busy}
                        className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-bold transition-colors disabled:opacity-60 ${
                          answer.tone === "primary"
                            ? "bg-clay text-cream hover:bg-espresso"
                            : "border border-slate-200 text-slate-600 hover:border-rose-300 hover:text-rose-600"
                        }`}
                      >
                        <Undo2 className="h-4 w-4" />
                        {busy ? "Saving..." : answer.label}
                      </button>
                    ))}
                  </div>
                )}

                {(step || canRefuse(order.status)) && (
                  <div className="mt-3 flex gap-2">
                    {step && (
                      <button
                        onClick={() => advance(order)}
                        disabled={busy}
                        className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg bg-clay px-4 py-2.5 text-sm font-bold text-cream transition-colors hover:bg-espresso disabled:opacity-60"
                      >
                        <Icon className="h-4 w-4" />
                        {busy ? "Saving..." : step.label}
                      </button>
                    )}
                    {/* Quiet, and never the wider of the two. Refusing is the
                        rarer answer and should not sit level with getting the
                        order out. */}
                    {canRefuse(order.status) && (
                      <button
                        onClick={() => setRefusing(order)}
                        className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 transition-colors hover:border-rose-300 hover:text-rose-600 ${step ? "" : "flex-1"}`}
                      >
                        <XCircle className="h-4 w-4" />
                        Refuse
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Orders Table */}
      <div className="hidden bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden sm:block">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="px-6 py-4 font-bold text-xs uppercase tracking-wider text-slate-500">
                  Order Details
                </th>
                <th className="px-6 py-4 font-bold text-xs uppercase tracking-wider text-slate-500">
                  Buyer
                </th>
                <th className="px-6 py-4 font-bold text-xs uppercase tracking-wider text-slate-500">
                  Amount
                </th>
                <th className="px-6 py-4 font-bold text-xs uppercase tracking-wider text-slate-500">
                  Status
                </th>
                <th className="px-6 py-4 font-bold text-xs uppercase tracking-wider text-slate-500 text-right">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayedOrders.length === 0 ? (
                <tr>
                  <td
                    colSpan="5"
                    className="px-6 py-10 text-center text-slate-500"
                  >
                    No orders found.
                  </td>
                </tr>
              ) : (
                displayedOrders.map((order) => (
                  <tr
                    key={order.id}
                    className="hover:bg-slate-50/50 transition-colors group"
                  >
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <span className="font-mono font-bold text-espresso">
                          {order.order_number || `ORD-${order.id}`}
                        </span>
                        <span className="text-xs text-slate-500 max-w-50 sm:max-w-50 truncate">
                          {order.product}
                          {order.item_count > 1 && (
                            <span className="font-normal text-slate-400">
                              {" "}+ {order.item_count - 1} more
                            </span>
                          )}
                          <ChallanCount count={order.challan_count} />
                        </span>
                        <span className="text-xs font-semibold text-slate-400 flex items-center gap-1 mt-0.5">
                          <Clock className="w-3 h-3" />
                          {new Date(order.date).toLocaleDateString("en-IN", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-bold text-slate-800">
                          {order.buyer}
                        </span>
                        <span className="text-xs text-slate-500">
                          {order.contact}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="font-bold text-clay text-base">
                          ₹{Number(order.amount).toLocaleString("en-IN")}
                        </span>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mt-0.5">
                          {order.qty} units
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`px-3 py-1.5 rounded border text-xs font-bold uppercase tracking-wider ${getStatusStyle(order.status)}`}
                      >
                        {formatOrderStatus(order.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {/* One button, the next real step. Nothing shows when
                            the order is waiting on the buyer to pay or is
                            already finished, because there is nothing they can
                            do to it. */}
                        {isReturnRequested(order.status) &&
                          RETURN_ANSWERS.map((answer) => (
                            <button
                              key={answer.to}
                              onClick={() => answerReturn(order, answer)}
                              disabled={working === order.id}
                              className={`inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-colors disabled:opacity-60 ${
                                answer.tone === "primary"
                                  ? "bg-clay text-cream hover:bg-espresso"
                                  : "border border-slate-200 bg-white text-slate-600 hover:border-rose-300 hover:text-rose-600"
                              }`}
                            >
                              <Undo2 className="h-3.5 w-3.5" />
                              {answer.label}
                            </button>
                          ))}
                        {(() => {
                          const step = getNextStep(order.status);
                          if (!step) return null;
                          const busy = working === order.id;
                          const Icon = step.dispatch ? Truck : ArrowRight;
                          return (
                            <button
                              onClick={() => advance(order)}
                              disabled={busy}
                              className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-clay px-3 py-2 text-xs font-bold text-cream transition-colors hover:bg-espresso disabled:opacity-60"
                            >
                              <Icon className="h-3.5 w-3.5" />
                              {busy ? "Saving..." : step.label}
                            </button>
                          );
                        })()}
                        {canRefuse(order.status) && (
                          <button
                            onClick={() => setRefusing(order)}
                            className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition-colors hover:border-rose-300 hover:text-rose-600"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            Refuse
                          </button>
                        )}
                        <button
                          onClick={() => navigate(`/seller/orders/${order.id}`)}
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold rounded-lg border border-slate-200 transition-colors cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          View
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {dispatching && (
        <DispatchModal
          order={dispatching}
          onClose={() => setDispatching(null)}
          onDispatched={applyStatus}
        />
      )}

      {refusing && (
        <RefuseOrderModal
          order={refusing}
          onClose={() => setRefusing(null)}
          onCancelled={applyStatus}
        />
      )}
    </div>
  );
};

export default Orders;

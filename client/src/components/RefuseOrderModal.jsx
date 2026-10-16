import { useState } from "react";
import { XCircle, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import api from "../utils/axios";
import ModalShell from "./ModalShell";
import { money as fmt } from "../utils/money";

/**
 * Refusing an order, or calling one off.
 *
 * The same screen serves both sides, because the thing being done is the same
 * and only the wording changes. A wholesaler refuses an order they cannot fill;
 * a buyer calls off an order they no longer wants.
 *
 * It asks for a reason and it will not proceed without one. The reason goes
 * into the order's history and is the only thing the other side has to go on,
 * so an order that simply turns to "Cancelled" with no explanation is how a
 * customer is lost. It is one line of typing, and it is worth insisting on.
 *
 * It warns about money before anything is pressed, because that is the part
 * people get wrong. Refusing does not refund anybody. Money already taken
 * stays on the books as the customer's credit until somebody actually hands
 * it back or sets it against their next order. Saying so here is the difference
 * between a wholesaler who knows they owe ₹2,100 and one who finds out when
 * the customer telephones.
 */
const RefuseOrderModal = ({ order, asSeller = true, onClose, onCancelled }) => {
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(false);

  const paid = Number(order?.amount_paid ?? order?.paid ?? 0);
  const money = paid > 0 ? `₹${fmt(paid)}` : null;

  const submit = async (e) => {
    e.preventDefault();
    const text = reason.trim();
    if (!text) {
      toast.error("Please say why. Your customer only sees this.");
      return;
    }

    setWorking(true);
    try {
      const { data } = await api.post(`/api/orders/${order.id}/cancel`, {
        reason: text,
      });
      onCancelled?.(order.id, "cancelled");
      if (data?.paymentLeftInPlace) {
        toast.success(
          asSeller
            ? "Order refused. The money already paid is still owed back to your customer."
            : "Order cancelled. The money you paid is still with the seller.",
        );
      } else {
        toast.success(asSeller ? "Order refused." : "Order cancelled.");
      }
      onClose();
    } catch (err) {
      toast.error(
        err.response?.data?.message ||
          "Could not cancel this order. Refresh and try again.",
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <ModalShell
      onClose={onClose}
      maxWidth="sm:max-w-md"
      labelledBy="refuse-order-title"
      closeOnOverlayClick={false}
      title={
        <>
          <h3 className="flex items-center gap-2 text-lg font-black text-espresso">
            <XCircle className="h-5 w-5 text-rose-500" />
            {asSeller ? "Refuse this order" : "Cancel this order"}
          </h3>
          <p className="mt-0.5 truncate text-xs font-semibold text-slate-400">
            {order.order_number} &middot; {order.buyer || order.supplier_name}
          </p>
        </>
      }
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-200"
          >
            Keep it
          </button>
          {/* Closing an order cannot be undone, so the cursor does not land
              here on open and a stray Enter cannot do it. */}
          <button
            type="submit"
            form="refuse-order-form"
            data-autofocus="off"
            disabled={working}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-rose-700 disabled:opacity-60"
          >
            <XCircle className="h-4 w-4" />
            {working ? "Please wait..." : asSeller ? "Refuse it" : "Cancel it"}
          </button>
        </div>
      }
    >
      <form id="refuse-order-form" onSubmit={submit} className="space-y-4 px-5 py-5">
          <p className="text-sm text-slate-600">
            {asSeller
              ? "This order will be closed and your customer will be told. It cannot be reopened, so they will have to place a fresh order."
              : "This order will be closed. You will have to place a fresh order if you change your mind."}
          </p>

          {money && (
            <div className="flex gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p className="text-xs text-amber-900">
                {asSeller ? (
                  <>
                    <strong>{money}</strong> has already been paid for this
                    order. Cancelling does not send it back. It stays in your
                    khata as this customer's credit until you refund them or put
                    it against their next order.
                  </>
                ) : (
                  <>
                    You have already paid <strong>{money}</strong>. Cancelling
                    does not return it automatically. It stays as credit with
                    the seller, so speak to them about a refund.
                  </>
                )}
              </p>
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-600">
              Why? {asSeller ? "Your customer sees this" : "The seller sees this"}
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              autoFocus
              placeholder={
                asSeller
                  ? "This colour is finished, new lot comes next week"
                  : "Ordered the wrong size"
              }
              className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none transition-colors focus:border-clay focus:bg-white"
            />
          </div>

      </form>
    </ModalShell>
  );
};

export default RefuseOrderModal;

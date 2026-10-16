import { AlertTriangle, Store } from "lucide-react";
import ModalShell from "./ModalShell";

/**
 * An order ships from a single wholesaler on a single truck, so a cart cannot
 * mix sellers. Shown when a buyer adds a product from a different wholesaler.
 *
 * Escape keeps the current order rather than clearing it. Backing out of a
 * question should never be the destructive answer, and this one throws away a
 * cart the buyer has already filled.
 */
const CartConflictModal = ({
  currentSeller,
  incomingSeller,
  productName,
  onKeep,
  onReplace,
}) => (
  <ModalShell
    onClose={onKeep}
    maxWidth="sm:max-w-md"
    labelledBy="cart-conflict-title"
    title={
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
          <AlertTriangle className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-black text-espresso">
            Start a new order?
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">
            Each order ships from one wholesaler, so your cart can only hold
            items from a single seller.
          </p>
        </div>
      </div>
    }
    footer={
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          onClick={onKeep}
          className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50"
        >
          Keep current order
        </button>
        {/* Not focused on open. This one empties a cart, and landing the
            cursor on it means a stray Enter throws the order away. */}
        <button
          onClick={onReplace}
          data-autofocus="off"
          className="rounded-xl bg-clay px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-espresso"
        >
          Clear and start new
        </button>
      </div>
    }
  >
    <div className="space-y-3 p-5">
      <div className="rounded-xl border border-slate-200 p-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Your current order
        </p>
        <p className="mt-1 flex items-center gap-2 text-sm font-bold text-espresso">
          <Store className="h-4 w-4 text-slate-400" />
          {currentSeller?.name || "Current wholesaler"}
        </p>
      </div>

      <div className="rounded-xl border border-clay/30 bg-clay/5 p-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-clay">
          Adding from
        </p>
        <p className="mt-1 flex items-center gap-2 text-sm font-bold text-espresso">
          <Store className="h-4 w-4 text-clay" />
          {incomingSeller?.name || "New wholesaler"}
        </p>
        {productName && (
          <p className="mt-1 truncate text-xs text-slate-500">{productName}</p>
        )}
      </div>
    </div>
  </ModalShell>
);

export default CartConflictModal;

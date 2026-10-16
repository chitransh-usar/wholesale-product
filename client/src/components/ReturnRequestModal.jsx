import { useState } from "react";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";
import api from "../utils/axios";
import ModalShell from "./ModalShell";

/**
 * Asking to send goods back.
 *
 * There was no screen for this at all. The route existed, set a flag nobody
 * read, and left the order sitting at "delivered", so a buyer had no way to
 * ask and a wholesaler had no way to hear.
 *
 * A reason is required and the box is the whole point of the screen. It is
 * the only thing the wholesaler has to go on when they decide, and the
 * difference between "short by four metres, dyeing is off on the second
 * piece" and no explanation at all is the difference between a return settled
 * on WhatsApp in a minute and an argument.
 *
 * It is careful not to promise money back. Accepting a return stops the
 * customer owing for the goods; whether cash already handed over comes back,
 * and when, is between the two of them.
 */
const ReturnRequestModal = ({ order, onClose, onRequested }) => {
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const text = reason.trim();
    if (!text) {
      toast.error("Please say what is wrong with the goods.");
      return;
    }

    setWorking(true);
    try {
      await api.post(`/api/orders/${order.id}/return`, { reason: text });
      onRequested?.(order.id, "return_requested");
      toast.success("The seller has been asked about this return.");
      onClose();
    } catch (err) {
      toast.error(
        err.response?.data?.message ||
          "Could not ask for this return. Refresh and try again.",
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <ModalShell
      onClose={onClose}
      maxWidth="sm:max-w-md"
      labelledBy="return-request-title"
      closeOnOverlayClick={false}
      title={
        <>
          <h3 className="flex items-center gap-2 text-lg font-black text-espresso">
            <Undo2 className="h-5 w-5 text-clay" />
            Send this back
          </h3>
          <p className="mt-0.5 truncate text-xs font-semibold text-slate-400">
            {order.order_number} &middot; {order.supplier_name}
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
            Keep them
          </button>
          <button
            type="submit"
            form="return-request-form"
            disabled={working}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-clay px-4 py-2.5 text-sm font-bold text-cream transition-colors hover:bg-espresso disabled:opacity-60"
          >
            <Undo2 className="h-4 w-4" />
            {working ? "Please wait..." : "Ask to return"}
          </button>
        </div>
      }
    >
      <form id="return-request-form" onSubmit={submit} className="space-y-4 px-5 py-5">
          <p className="text-sm text-slate-600">
            The seller decides whether to take the goods back. They will see what
            you write here, so say what is wrong with them.
          </p>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-600">
              What is the problem?
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              autoFocus
              placeholder="Short by four metres, and the dyeing is off on the second piece"
              className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none transition-colors focus:border-clay focus:bg-white"
            />
          </div>

          {/* Said plainly, because this is the part people assume. */}
          <p className="text-xs text-slate-500">
            If they accept, you stop owing for these goods. Money you have
            already paid comes back by whatever you two arrange, so speak to
            them about it.
          </p>

      </form>
    </ModalShell>
  );
};

export default ReturnRequestModal;

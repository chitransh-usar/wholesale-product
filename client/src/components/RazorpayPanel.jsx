import { useState } from "react";
import { Loader2, Lock, ShieldCheck, TriangleAlert } from "lucide-react";
import api from "../utils/axios";
import { toast } from "sonner";
import { loadRazorpay } from "../utils/razorpay";
import { trimmed as money } from "../utils/money";

/**
 * Paying online, through Razorpay's own checkout window.
 *
 * THE PRIMARY WAY TO PAY, and drawn like it. Nothing confirms a UPI QR payment
 * today: the buyer scans, pays in their bank app, comes back and presses a button
 * to say they did, and the cap on what is owed is the entire check. This path is
 * the only one where the money is actually confirmed before the order moves,
 * so it leads and the QR code sits underneath as the fallback.
 *
 * IT IS RAZORPAY'S WINDOW, not ours. There was a local imitation here and it
 * has been deleted. Card numbers and UPI PINs belong inside an iframe served
 * by the people who are PCI certified to collect them; a copy of that screen
 * in our markup gets the appearance right and the security exactly backwards,
 * and the fields would have to become real eventually.
 *
 * The sequence, and only the middle step is theirs:
 *
 *   POST razorpay/order    the server opens an order for an amount IT chose
 *   checkout.open()        their iframe, their fields, their network
 *   POST razorpay/verify   the handler payload, signature checked before
 *                          anything moves
 *
 * WITHOUT KEYS THERE IS NO BUTTON. Razorpay's script authenticates the key id
 * against their servers, so it cannot be opened with a made up one, and a
 * button that always fails is worse than one that explains itself. Test keys
 * are free: rzp_test_... from the dashboard, set as RAZORPAY_KEY_ID and
 * RAZORPAY_KEY_SECRET on the server, and this lights up against their sandbox.
 */
const RazorpayPanel = ({ orderId, amount, merchant, buyer, onPaid }) => {
  const [busy, setBusy] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);

  const pay = async () => {
    setBusy(true);
    try {
      // The script first. Opening an order and then failing to draw a window
      // leaves a live gateway order behind for nothing.
      const ready = await loadRazorpay();
      if (!ready) {
        toast.error(
          "Could not reach the payment window. Check your connection, or any ad blocker, and try again.",
        );
        setBusy(false);
        return;
      }

      const { data } = await api.post(`/api/orders/${orderId}/razorpay/order`);

      // No real keys: their script would refuse the key id anyway, so say so
      // rather than opening a window that cannot work.
      if (data.stub) {
        setNotConfigured(true);
        setBusy(false);
        return;
      }

      const checkout = new window.Razorpay({
        key: data.keyId,
        order_id: data.orderId,
        // Razorpay checks these against the order it holds, so they are
        // display values here, not the amount being charged.
        amount: data.amount,
        currency: data.currency || "INR",
        name: merchant || "KhazanaBMS",
        description: `Order payment`,
        prefill: {
          name: buyer?.name || undefined,
          email: buyer?.email || undefined,
          contact: buyer?.phone || undefined,
        },
        theme: { color: "#c56b4a" },

        /**
         * Razorpay hands the payment back here. NOTHING IS TRUSTED YET: this
         * is the browser reporting its own success, and the server checks the
         * signature before a rupee moves.
         */
        handler: async (response) => {
          try {
            const verified = await api.post(
              `/api/orders/${orderId}/razorpay/verify`,
              {
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              },
            );
            if (verified.data?.success) {
              toast.success("Payment received.");
              onPaid?.(verified.data);
            } else {
              toast.error(
                verified.data?.message || "That payment could not be verified.",
              );
            }
          } catch (err) {
            // The money may well have left their account. Telling them it failed
            // would be a lie, so this says what is actually true.
            toast.error(
              err.response?.data?.message ||
                "The payment went through but we could not confirm it here. Do not pay again; it will be reconciled.",
            );
          }
          setBusy(false);
        },

        modal: {
          // They closed the window. Not a failure, and nothing to record.
          ondismiss: () => setBusy(false),
        },
      });

      checkout.on("payment.failed", (event) => {
        toast.error(
          event?.error?.description || "That payment did not go through.",
        );
        setBusy(false);
      });

      checkout.open();
    } catch (err) {
      toast.error(
        err.response?.data?.message || "Could not start the payment.",
      );
      setBusy(false);
    }
  };

  if (notConfigured) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-amber-900">
              Online payment is not switched on for this server
            </p>
            <p className="mt-1 text-xs text-amber-800">
              Razorpay keys have not been set, so the payment window cannot
              open. Use the UPI QR code below in the meantime.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border-2 border-clay bg-white shadow-sm">
      <div className="border-b border-clay/15 bg-clay/5 px-5 py-2.5">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-clay">
          <ShieldCheck className="h-3.5 w-3.5" />
          Recommended
        </p>
      </div>

      <div className="p-5">
        <h3 className="text-base font-bold text-espresso">Pay online</h3>
        <p className="mt-1 text-sm text-slate-500">
          Card, netbanking, UPI or a wallet. Confirmed the moment it goes
          through, so your order moves straight away.
        </p>

        <button
          onClick={pay}
          disabled={busy}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-clay px-6 py-4 text-base font-black text-cream transition-colors hover:bg-espresso disabled:opacity-60"
        >
          {busy ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Opening...
            </>
          ) : (
            <>Pay ₹{money(amount)}</>
          )}
        </button>

        <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
          <Lock className="h-3 w-3" />
          Card details are entered on Razorpay, never on this site
        </p>
      </div>
    </div>
  );
};

export default RazorpayPanel;

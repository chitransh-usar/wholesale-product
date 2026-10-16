import { useState } from "react";
import { TransportGrid } from "./TransportFields";
import { blankTransport, hasTransport } from "../utils/transport";
import { Truck, Copy, Check, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import api from "../utils/axios";
import ModalShell from "./ModalShell";

/**
 * Sending an order out.
 *
 * Two things happen at once here, and they are separate on purpose. The order
 * moves to "shipped", which is the record. And a link is made for the driver
 * to broadcast their location from, which is what lets the buyer follow the
 * delivery on their own order page.
 *
 * That link goes to the DRIVER and to nobody else. Opening it and pressing its
 * one button starts reporting that phone as the vehicle, so a buyer given the
 * link would be broadcasting their own position as the delivery.
 *
 * The link is optional. Plenty of goods go out with a man on a scooter who has
 * no smartphone, and the order still has to be dispatchable. So the driver
 * details can be left blank and the order goes out anyway.
 *
 * The order is moved first and the link made second. If the link fails, the
 * goods have still left the godown and the record says so, which is the
 * truthful order of events. The reverse would leave a live tracking link on an
 * order the system thinks is still sitting in the shop.
 */
const DispatchModal = ({ order, onClose, onDispatched }) => {
  const [driverName, setDriverName] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  /**
   * The e-way bill block, sent with the despatch.
   *
   * The driver's name, phone and vehicle above are for the TRACKING LINK the
   * customer opens to watch the lorry. That is a courtesy, it expires, and a
   * tax document must not be built out of it. These are the fields that go on
   * the bill, and they are stamped onto the order and onto the invoice already
   * raised from it.
   *
   * The vehicle number is typed once, above, and fed into both.
   */
  const [transport, setTransport] = useState(blankTransport());
  const [showTransport, setShowTransport] = useState(false);
  const setTransportField = (name, value) =>
    setTransport((prev) => ({ ...prev, [name]: value }));
  const [sending, setSending] = useState(false);
  const [trackUrl, setTrackUrl] = useState(null);
  const [copied, setCopied] = useState(false);

  const send = async (e) => {
    e.preventDefault();
    setSending(true);
    try {
      await api.patch(`/api/orders/${order.id}/status`, {
        status: "shipped",
        remarks: driverName
          ? `Sent out with ${driverName}${vehicleNumber ? `, ${vehicleNumber}` : ""}`
          : "Sent out",
        ...transport,
        // Typed once at the top of this form, and wanted by both.
        vehicleNumber: vehicleNumber || transport.vehicleNumber || "",
      });

      // The order is out. Anything below this point is a convenience.
      let url = null;
      try {
        const { data } = await api.post(`/api/orders/${order.id}/driver-link`, {
          driverName: driverName || null,
          driverPhone: driverPhone || null,
          vehicleNumber: vehicleNumber || null,
        });
        if (data?.path) url = `${window.location.origin}${data.path}`;
      } catch {
        toast.info("Order sent out. The tracking link could not be made.");
      }

      onDispatched(order.id, "shipped");
      if (url) {
        setTrackUrl(url);
        toast.success("Order sent out.");
      } else {
        toast.success("Order sent out.");
        onClose();
      }
    } catch (err) {
      toast.error(
        err.response?.data?.message || "Could not send this order out.",
      );
    } finally {
      setSending(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(trackUrl);
      setCopied(true);
      toast.success("Link copied.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is blocked outside a secure context, so show the link
      // rather than failing quietly.
      toast.info(trackUrl);
    }
  };

  // Addressed to the driver, and opened on their number when we have it, so it
  // is harder to send to the wrong person by accident.
  const whatsapp = () => {
    const text =
      `Delivery for ${order.buyer}. Open this and press "Start sharing my location", ` +
      `then keep the page open until you reach: ${trackUrl}`;
    const digits = String(driverPhone || "").replace(/\D/g, "");
    const to = digits.length >= 10 ? `91${digits.slice(-10)}` : "";
    window.open(
      `https://wa.me/${to}?text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener",
    );
  };

  return (
    <ModalShell
      onClose={onClose}
      maxWidth="sm:max-w-md"
      labelledBy="dispatch-title"
      closeOnOverlayClick={false}
      title={
        <>
          <h3 className="flex items-center gap-2 text-lg font-black text-espresso">
            <Truck className="h-5 w-5 text-clay" />
            {trackUrl ? "On its way" : "Send this order out"}
          </h3>
          <p className="mt-0.5 truncate text-xs font-semibold text-slate-400">
            {order.order_number} &middot; {order.buyer}
          </p>
        </>
      }
    >
        {trackUrl ? (
          <div className="space-y-4 px-5 py-5">
            {/* This link belongs to the driver, not the customer. Opening it
                and pressing the button starts broadcasting that phone's
                location as the vehicle, so sending it to the buyer would have
                them reporting their own position as the delivery. The customer
                follows the delivery from their own order page instead. */}
            <p className="text-sm text-slate-600">
              Send this to{" "}
              <strong className="text-espresso">
                {driverName || "the driver"}
              </strong>
              , not to your customer. They open it and presses one button, and
              then {order.buyer} can watch the delivery on their own order page.
            </p>
            <p className="text-xs text-slate-500">
              The link stops working on its own after the delivery.
            </p>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <p className="break-all font-mono text-xs text-slate-600">
                {trackUrl}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={whatsapp}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-700"
              >
                <MessageCircle className="h-4 w-4" />
                Send to driver
              </button>
              <button
                onClick={copy}
                className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 transition-colors hover:border-clay hover:text-clay"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-emerald-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                Copy
              </button>
            </div>
            <button
              onClick={onClose}
              className="w-full rounded-lg bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-200"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={send} className="space-y-4 px-5 py-5">
            <p className="text-sm text-slate-600">
              Who is taking it? Fill this in and you get a link to send the
              driver, so your customer can follow the delivery on a map. You
              can leave it blank and send the order out anyway.
            </p>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-600">
                Driver's name
              </label>
              <input
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                placeholder="Ramesh"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none transition-colors focus:border-clay focus:bg-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-600">
                  Their phone
                </label>
                <input
                  value={driverPhone}
                  onChange={(e) => setDriverPhone(e.target.value)}
                  inputMode="tel"
                  placeholder="98765 43210"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none transition-colors focus:border-clay focus:bg-white"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-600">
                  Vehicle number
                </label>
                <input
                  value={vehicleNumber}
                  onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
                  placeholder="GJ 05 AB 1234"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none transition-colors focus:border-clay focus:bg-white"
                />
              </div>
            </div>

            {/*
              Closed by default. Most orders go out without a transporter's
              paperwork, and opening on eight more boxes turns a two field
              despatch into a form.
            */}
            <div className="rounded-lg border border-slate-200">
              <button
                type="button"
                onClick={() => setShowTransport((o) => !o)}
                aria-expanded={showTransport}
                className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left"
              >
                <span className="text-xs font-semibold text-slate-600">
                  Transporter's paperwork
                  {hasTransport(transport) ? " (filled in)" : ""}
                </span>
                <span className="text-xs font-bold text-clay">
                  {showTransport ? "Hide" : "Add"}
                </span>
              </button>
              {showTransport && (
                <div className="border-t border-slate-100 p-4">
                  <p className="mb-3 text-[11px] text-slate-500">
                    These print on the bill for this order. Leave them blank if
                    there is no transporter.
                  </p>
                  <TransportGrid value={transport} onChange={setTransportField} />
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-200"
              >
                Not yet
              </button>
              <button
                type="submit"
                disabled={sending}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-clay px-4 py-2.5 text-sm font-bold text-cream transition-colors hover:bg-espresso disabled:opacity-60"
              >
                <Truck className="h-4 w-4" />
                {sending ? "Sending out..." : "Send it out"}
              </button>
            </div>
          </form>
        )}
    </ModalShell>
  );
};

export default DispatchModal;

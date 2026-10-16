import { useCallback, useEffect, useState } from "react";
import { Copy, Link2, MapPin, Navigation, Plus, Radio, Truck, X } from "lucide-react";
import { toast } from "sonner";
import api from "../utils/axios";
import { useSocket } from "../context/SocketContext";
import DeliveryMap from "./DeliveryMap";
import { canSendOut } from "../utils/orderStatus";

/**
 * Delivery tracking for one order. The retailer reads it; the wholesaler can
 * add checkpoints from the same panel when they are the seller on the order.
 */

const COMMON_LABELS = [
  "Loaded at warehouse",
  "Dispatched",
  "In transit",
  "Out for delivery",
  "Delivered",
];

const formatWhen = (value) =>
  value
    ? new Date(value).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

const CheckpointForm = ({ orderId, onAdded, onClose }) => {
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [coords, setCoords] = useState({ lat: "", lng: "" });
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);

  // Lets a wholesaler standing with the consignment drop an exact point.
  const useMyLocation = () => {
    if (!navigator.geolocation) {
      toast.error("This browser cannot share a location");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          lat: pos.coords.latitude.toFixed(6),
          lng: pos.coords.longitude.toFixed(6),
        });
        setLocating(false);
        toast.success("Location captured");
      },
      () => {
        setLocating(false);
        toast.error("Could not read your location");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!label.trim()) return toast.error("Add a label for this checkpoint");
    setSaving(true);
    try {
      await api.post(`/api/orders/${orderId}/checkpoints`, {
        label: label.trim(),
        note: note.trim() || undefined,
        lat: coords.lat || undefined,
        lng: coords.lng || undefined,
      });
      toast.success("Checkpoint added");
      onAdded();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not add checkpoint");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border border-sage/30 bg-sage/5 p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-bold text-espresso">Add a checkpoint</p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-espresso/40 hover:bg-white hover:text-espresso"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5">
        {COMMON_LABELS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => setLabel(preset)}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
              label === preset
                ? "border-clay bg-clay text-white"
                : "border-sage/30 bg-white text-espresso/60 hover:border-clay/40"
            }`}
          >
            {preset}
          </button>
        ))}
      </div>

      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Where is the consignment? e.g. Crossed Nashik"
        className="mb-2 w-full rounded-lg border border-sage/30 bg-white px-3 py-2 text-sm outline-none focus:border-clay"
      />
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note for the buyer"
        className="mb-2 w-full rounded-lg border border-sage/30 bg-white px-3 py-2 text-sm outline-none focus:border-clay"
      />

      <div className="mb-3">
        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-sage/30 bg-white px-3 py-2 text-xs font-bold text-espresso transition-colors hover:bg-sage/10 disabled:opacity-60"
        >
          <Navigation className="h-3.5 w-3.5" />
          {coords.lat
            ? `Pinned at ${Number(coords.lat).toFixed(4)}, ${Number(coords.lng).toFixed(4)}`
            : locating
              ? "Locating..."
              : "Attach my current location (optional)"}
        </button>
      </div>

      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-lg bg-clay py-2.5 text-sm font-bold text-white transition-colors hover:bg-espresso disabled:opacity-60"
      >
        {saving ? "Saving..." : "Add checkpoint"}
      </button>
    </form>
  );
};


/**
 * Live location without the wholesaler typing coordinates: generate a link,
 * send it to whoever is driving, and their taps become checkpoints.
 */
const DriverLinkPanel = ({ orderId, status }) => {
  const [link, setLink] = useState(null);
  const [creating, setCreating] = useState(false);
  const [driverName, setDriverName] = useState("");
  const [vehicle, setVehicle] = useState("");

  useEffect(() => {
    api
      .get(`/api/orders/${orderId}/driver-link`)
      .then((res) => setLink(res.data.link))
      .catch(() => {});
  }, [orderId]);

  const fullUrl = link ? `${window.location.origin}${link.path}` : "";

  const create = async () => {
    setCreating(true);
    try {
      const res = await api.post(`/api/orders/${orderId}/driver-link`, {
        driverName: driverName.trim() || undefined,
        vehicleNumber: vehicle.trim() || undefined,
      });
      setLink({ ...res.data, driver_name: driverName, vehicle_number: vehicle });
      toast.success("Driver link ready");
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not create link");
    } finally {
      setCreating(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fullUrl);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy - select the link manually");
    }
  };

  // Before the goods are packed there is nothing to follow, and the link
  // would expire before it was any use. Say so plainly instead of offering a
  // button that the server will refuse.
  if (!canSendOut(status)) {
    return (
      <div className="mb-4 rounded-xl border border-sage/30 bg-sage/5 p-4">
        <p className="mb-1 flex items-center gap-2 text-sm font-bold text-espresso">
          <Radio className="h-4 w-4 text-espresso/30" />
          Live location from the driver
        </p>
        <p className="text-xs leading-relaxed text-espresso/50">
          Pack this order first. Once it is packed you can make a link, send it
          to whoever is driving, and your customer can follow the delivery.
        </p>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-xl border border-sage/30 bg-white p-4">
      <p className="mb-1 flex items-center gap-2 text-sm font-bold text-espresso">
        <Radio className="h-4 w-4 text-clay" />
        Live location from the driver
      </p>
      <p className="mb-3 text-xs leading-relaxed text-espresso/50">
        Send this link to whoever is driving. They tap once to share location -
        no app, no account. Their position becomes checkpoints automatically.
      </p>

      {link ? (
        <>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={fullUrl}
              onFocus={(e) => e.target.select()}
              className="min-w-0 flex-1 rounded-lg border border-sage/30 bg-sage/5 px-3 py-2 text-xs text-espresso/70"
            />
            <button
              onClick={copy}
              className="shrink-0 rounded-lg border border-sage/30 p-2 text-espresso/60 transition-colors hover:bg-sage/10"
              aria-label="Copy link"
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <a
              href={`https://wa.me/?text=${encodeURIComponent(
                `Delivery tracking - tap to share your location: ${fullUrl}`,
              )}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-bold text-emerald-700 hover:underline"
            >
              Send on WhatsApp
            </a>
            <button onClick={create} className="text-xs font-semibold text-espresso/50 hover:underline">
              Regenerate
            </button>
            {link.last_ping_at && (
              <span className="text-xs text-espresso/40">
                Last ping {formatWhen(link.last_ping_at)}
              </span>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="mb-2 flex flex-col gap-2 sm:flex-row">
            <input
              value={driverName}
              onChange={(e) => setDriverName(e.target.value)}
              placeholder="Driver name (optional)"
              className="w-full rounded-lg border border-sage/30 px-3 py-2 text-sm outline-none focus:border-clay"
            />
            <input
              value={vehicle}
              onChange={(e) => setVehicle(e.target.value)}
              placeholder="Vehicle number (optional)"
              className="w-full rounded-lg border border-sage/30 px-3 py-2 text-sm outline-none focus:border-clay"
            />
          </div>
          <button
            onClick={create}
            disabled={creating}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-espresso py-2.5 text-sm font-bold text-cream transition-colors hover:bg-clay disabled:opacity-60"
          >
            <Link2 className="h-4 w-4" />
            {creating ? "Creating..." : "Create driver link"}
          </button>
        </>
      )}
    </div>
  );
};

const OrderTracking = ({ orderId }) => {
  const socket = useSocket();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/api/orders/${orderId}/tracking`);
      setData(res.data);
    } catch {
      // tracking is supplementary; the order page still works without it
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  // Live updates when the wholesaler records a checkpoint.
  useEffect(() => {
    if (!socket) return;
    const onUpdate = (payload) => {
      if (String(payload.orderId) !== String(orderId)) return;
      load();
      toast.info(`Delivery update: ${payload.checkpoint?.label ?? "moved"}`);
    };
    socket.on("tracking_update", onUpdate);
    return () => socket.off("tracking_update", onUpdate);
  }, [socket, orderId, load]);

  if (loading) {
    return (
      <section className="rounded-2xl border border-sage/20 bg-white/80 p-5 shadow-sm">
        <div className="h-6 w-40 animate-pulse rounded bg-sage/20" />
      </section>
    );
  }

  if (!data) return null;

  const { checkpoints = [], canRecord } = data;
  const latest = [...checkpoints].reverse()[0];

  return (
    <section className="rounded-2xl border border-sage/20 bg-white/80 p-5 shadow-sm sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-bold text-espresso">
          <Truck className="h-5 w-5 text-clay" />
          Delivery tracking
        </h2>
        {canRecord && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 rounded-xl bg-espresso px-3 py-2 text-xs font-bold text-cream transition-colors hover:bg-clay"
          >
            <Plus className="h-3.5 w-3.5" />
            Add checkpoint
          </button>
        )}
      </div>

      {latest && (
        <div className="mb-4 flex items-start gap-3 rounded-xl bg-clay/5 p-3">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-clay" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-espresso">{latest.label}</p>
            <p className="text-xs text-espresso/50">
              {formatWhen(latest.recordedAt)}
              {latest.note ? ` · ${latest.note}` : ""}
            </p>
          </div>
        </div>
      )}

      {canRecord && <DriverLinkPanel orderId={orderId} status={data.status} />}

      {showForm && (
        <div className="mb-4">
          <CheckpointForm
            orderId={orderId}
            onAdded={load}
            onClose={() => setShowForm(false)}
          />
        </div>
      )}

      <DeliveryMap
        origin={data.origin}
        destination={data.destination}
        checkpoints={checkpoints}
      />

      <p className="mt-2 text-[11px] text-espresso/40">
        Lines show the corridor between stops, not the exact road route.
      </p>

      <div className="mt-5">
        <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-espresso/40">
          Journey
        </p>
        {checkpoints.length === 0 ? (
          <p className="text-sm text-espresso/50">
            {canRecord
              ? "No checkpoints yet - add one when the consignment moves."
              : "The wholesaler has not posted an update yet."}
          </p>
        ) : (
          <ol className="relative space-y-4 border-l border-sage/30 pl-6">
            {checkpoints.map((c) => (
              <li key={c.id} className="relative">
                <span className="absolute -left-[1.9rem] top-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-white bg-clay" />
                <p className="text-sm font-bold text-espresso">{c.label}</p>
                <p className="text-xs text-espresso/50">
                  {formatWhen(c.recordedAt)}
                  {c.recordedBy ? ` · ${c.recordedBy}` : ""}
                </p>
                {c.note && (
                  <p className="mt-0.5 text-xs text-espresso/60">{c.note}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
};

export default OrderTracking;

import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { MapPin, Navigation, Radio, Truck, TriangleAlert } from "lucide-react";
import api from "../utils/axios";

/**
 * The driver's page, opened from a link sent over WhatsApp or SMS.
 *
 * No account and no app install: the token in the URL is the credential. It
 * only reports while the page is open and the screen is awake, which is a
 * deliberate trade - background location in a mobile browser is not reliable
 * enough to promise, so this promises less and actually works.
 */

const PING_INTERVAL_MS = 30000;

const DriverTracking = () => {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [sharing, setSharing] = useState(false);
  const [lastSent, setLastSent] = useState(null);
  const [pingCount, setPingCount] = useState(0);
  const watchIdRef = useRef(null);
  const lastSentAtRef = useRef(0);
  const wakeLockRef = useRef(null);

  useEffect(() => {
    api
      .get(`/api/track/${token}`)
      .then((res) => setInfo(res.data))
      .catch((err) =>
        setError(err.response?.data?.message || "This link is not valid"),
      );
  }, [token]);

  // Stop watching and release the screen lock when leaving.
  useEffect(
    () => () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      wakeLockRef.current?.release?.().catch(() => {});
    },
    [],
  );

  const send = async (lat, lng) => {
    try {
      await api.post(`/api/track/${token}/ping`, { lat, lng });
      setLastSent(new Date());
      setPingCount((n) => n + 1);
    } catch {
      // A dropped ping is not worth interrupting the driver over; the next
      // position update will carry the latest location anyway.
    }
  };

  const startSharing = async () => {
    if (!navigator.geolocation) {
      setError("This phone's browser cannot share location");
      return;
    }

    // Best-effort: keeps the screen on so watching continues.
    try {
      if ("wakeLock" in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
      }
    } catch {
      /* not critical */
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        // watchPosition can fire very often; throttle what we upload.
        if (now - lastSentAtRef.current < PING_INTERVAL_MS) return;
        lastSentAtRef.current = now;
        send(pos.coords.latitude, pos.coords.longitude);
      },
      () => setError("Location permission was denied"),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 },
    );

    // Send one immediately so the wholesaler sees it working.
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        lastSentAtRef.current = Date.now();
        send(pos.coords.latitude, pos.coords.longitude);
      },
      () => {},
      { enableHighAccuracy: true },
    );

    setSharing(true);
  };

  const stopSharing = () => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    wakeLockRef.current?.release?.().catch(() => {});
    wakeLockRef.current = null;
    setSharing(false);
  };

  if (error && !info) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-espresso p-6 text-center">
        <div>
          <TriangleAlert className="mx-auto mb-3 h-10 w-10 text-clay" />
          <p className="text-lg font-bold text-cream">{error}</p>
          <p className="mt-1 text-sm text-cream/50">
            Ask the wholesaler to send a fresh link.
          </p>
        </div>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-espresso">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-espresso px-5 py-8 text-cream">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-8 text-center">
          <Truck className="mx-auto mb-3 h-10 w-10 text-clay" />
          <h1 className="text-xl font-black">Delivery {info.orderNumber}</h1>
          <p className="mt-1 text-sm text-cream/60">{info.supplierName}</p>
        </div>

        {info.deliveryArea && (
          <div className="mb-6 flex items-start gap-3 rounded-2xl bg-white/5 p-4">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-clay" />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-cream/40">
                Deliver to
              </p>
              <p className="text-sm font-semibold">{info.deliveryArea}</p>
            </div>
          </div>
        )}

        {sharing ? (
          <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-6 text-center">
            <Radio className="mx-auto mb-3 h-8 w-8 animate-pulse text-emerald-300" />
            <p className="text-lg font-black text-emerald-200">
              Sharing your location
            </p>
            <p className="mt-1 text-sm text-cream/60">
              {pingCount > 0
                ? `${pingCount} update${pingCount === 1 ? "" : "s"} sent`
                : "Waiting for your first position..."}
            </p>
            {lastSent && (
              <p className="mt-1 text-xs text-cream/40">
                Last sent {lastSent.toLocaleTimeString("en-IN")}
              </p>
            )}
            <p className="mt-4 text-xs leading-relaxed text-cream/50">
              Keep this page open while you drive. You can lock nothing else -
              closing the tab stops sharing.
            </p>
            <button
              onClick={stopSharing}
              className="mt-5 w-full rounded-xl border border-white/20 py-3 text-sm font-bold text-cream/80 transition-colors hover:bg-white/10"
            >
              Stop sharing
            </button>
          </div>
        ) : (
          <button
            onClick={startSharing}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-clay py-5 text-base font-black text-white shadow-lg transition-transform active:scale-[0.99]"
          >
            <Navigation className="h-5 w-5" />
            Start sharing my location
          </button>
        )}

        {error && sharing && (
          <p className="mt-4 text-center text-sm text-rose-300">{error}</p>
        )}

        <p className="mt-8 text-center text-xs leading-relaxed text-cream/40">
          Your location is shared only with this wholesaler and their customer,
          only for this delivery, and only while this page is open.
        </p>
      </div>
    </div>
  );
};

export default DriverTracking;

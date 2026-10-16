import { useEffect, useRef, useState } from "react";
import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Crosshair, MapPin } from "lucide-react";
import { toast } from "sonner";

/**
 * Pin drop for a delivery address.
 *
 * Geocoding a typed address is unreliable for Indian addresses - lanes and
 * building names often do not resolve - so the buyer confirms the exact point
 * themselves. Coordinates captured here are authoritative and skip geocoding
 * entirely.
 */

const OSM_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

const pinElement = () => {
  const el = document.createElement("div");
  el.style.cssText = `
    width:24px;height:24px;border-radius:9999px;background:#c56b4a;
    border:4px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);
  `;
  return el;
};

const LocationPicker = ({ value, onChange }) => {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    const start = value?.lat != null ? [value.lng, value.lat] : [78.9629, 20.5937];
    const map = new MapLibreMap({
      container: containerRef.current,
      style: OSM_STYLE,
      center: start,
      zoom: value?.lat != null ? 14 : 3.5,
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");

    const place = (lng, lat) => {
      if (markerRef.current) {
        markerRef.current.setLngLat([lng, lat]);
      } else {
        markerRef.current = new Marker({ element: pinElement(), draggable: true })
          .setLngLat([lng, lat])
          .addTo(map);
        markerRef.current.on("dragend", () => {
          const p = markerRef.current.getLngLat();
          onChangeRef.current?.({ lat: Number(p.lat.toFixed(7)), lng: Number(p.lng.toFixed(7)) });
        });
      }
      onChangeRef.current?.({ lat: Number(lat.toFixed(7)), lng: Number(lng.toFixed(7)) });
    };

    map.on("click", (e) => place(e.lngLat.lng, e.lngLat.lat));
    if (value?.lat != null) place(value.lng, value.lat);

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Intentionally mounted once; `value` is only the initial position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      toast.error("This browser cannot share a location");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const map = mapRef.current;
        if (map) {
          map.easeTo({ center: [longitude, latitude], zoom: 15 });
          if (markerRef.current) {
            markerRef.current.setLngLat([longitude, latitude]);
          } else {
            markerRef.current = new Marker({ element: pinElement(), draggable: true })
              .setLngLat([longitude, latitude])
              .addTo(map);
            markerRef.current.on("dragend", () => {
              const p = markerRef.current.getLngLat();
              onChangeRef.current?.({
                lat: Number(p.lat.toFixed(7)),
                lng: Number(p.lng.toFixed(7)),
              });
            });
          }
        }
        onChange?.({
          lat: Number(latitude.toFixed(7)),
          lng: Number(longitude.toFixed(7)),
        });
        setLocating(false);
      },
      () => {
        setLocating(false);
        toast.error("Could not read your location - drop the pin manually");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs text-slate-500">
          <MapPin className="h-3.5 w-3.5 text-clay" />
          Tap the map to place your delivery pin, or drag it to adjust
        </p>
        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
        >
          <Crosshair className="h-3.5 w-3.5" />
          {locating ? "Locating..." : "Use my location"}
        </button>
      </div>

      <div
        ref={containerRef}
        className="h-56 w-full overflow-hidden rounded-xl border border-slate-200 sm:h-64"
      />

      {value?.lat != null ? (
        <p className="mt-2 text-xs font-semibold text-emerald-700">
          Pin set · {Number(value.lat).toFixed(5)}, {Number(value.lng).toFixed(5)}
        </p>
      ) : (
        <p className="mt-2 text-xs text-slate-400">
          No pin yet - we'll estimate from your address, which is less accurate.
        </p>
      )}
    </div>
  );
};

export default LocationPicker;

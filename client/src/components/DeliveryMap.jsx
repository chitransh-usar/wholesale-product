import { useEffect, useRef } from "react";
// maplibre-gl v6 ships named exports only - there is no default export.
import {
  Map as MapLibreMap,
  Marker,
  Popup,
  NavigationControl,
  LngLatBounds,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * Delivery map: warehouse at one end, drop-off at the other, and the
 * consignment's last known position between them.
 *
 * Built on MapLibre with OpenStreetMap raster tiles - no API key, no billing.
 * The path is drawn as two segments: the ground already covered is solid, the
 * remainder dashed, so progress reads at a glance without pretending to know
 * the exact road route.
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

const COLOURS = {
  origin: "#7a8b6f", // sage
  truck: "#c56b4a", // clay
  destination: "#3d2e24", // espresso
  passed: "#a8a29e",
};

// Endpoint pins: a labelled disc, sized so they read above the truck.
const endpointEl = (colour, glyph) => {
  const el = document.createElement("div");
  el.style.cssText = `
    display:flex;align-items:center;justify-content:center;
    width:30px;height:30px;border-radius:9999px;background:${colour};
    border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);
    color:#fff;font-size:13px;font-weight:700;cursor:pointer;
  `;
  el.textContent = glyph;
  return el;
};

// The truck gets a halo so the current position is obvious at a glance.
const truckEl = () => {
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:relative;width:38px;height:38px;cursor:pointer;";
  wrap.innerHTML = `
    <span style="
      position:absolute;inset:0;border-radius:9999px;
      background:${COLOURS.truck};opacity:.25;animation:dm-pulse 2s ease-out infinite;
    "></span>
    <span style="
      position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
      display:flex;align-items:center;justify-content:center;
      width:28px;height:28px;border-radius:9999px;background:${COLOURS.truck};
      border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.4);font-size:14px;
    ">🚚</span>
  `;
  return wrap;
};

// Small dots for places the consignment has already left.
const passedEl = () => {
  const el = document.createElement("div");
  el.style.cssText = `
    width:12px;height:12px;border-radius:9999px;background:${COLOURS.passed};
    border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3);cursor:pointer;
  `;
  return el;
};

const DeliveryMap = ({ origin, destination, checkpoints = [] }) => {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: OSM_STYLE,
      center: [78.9629, 20.5937], // India
      zoom: 3.5,
      attributionControl: true,
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const draw = () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      const add = (element, lng, lat, popupText) => {
        const m = new Marker({ element })
          .setLngLat([lng, lat])
          .setPopup(new Popup({ offset: 18 }).setText(popupText))
          .addTo(map);
        markersRef.current.push(m);
      };

      const located = checkpoints.filter((c) => c.lat != null && c.lng != null);
      const current = located.length ? located[located.length - 1] : null;
      const passed = located.slice(0, -1);

      const all = [];

      if (origin) {
        add(endpointEl(COLOURS.origin, "▲"), origin.lng, origin.lat, "Warehouse - start");
        all.push([origin.lng, origin.lat]);
      }

      passed.forEach((c) => {
        add(passedEl(), c.lng, c.lat, c.label);
        all.push([c.lng, c.lat]);
      });

      if (current) {
        add(
          truckEl(),
          current.lng,
          current.lat,
          `${current.label} - last known position`,
        );
        all.push([current.lng, current.lat]);
      }

      if (destination) {
        add(
          endpointEl(COLOURS.destination, "■"),
          destination.lng,
          destination.lat,
          "Delivery address - destination",
        );
        all.push([destination.lng, destination.lat]);
      }

      // Ground covered so far: warehouse through to the truck.
      const travelled = [];
      if (origin) travelled.push([origin.lng, origin.lat]);
      passed.forEach((c) => travelled.push([c.lng, c.lat]));
      if (current) travelled.push([current.lng, current.lat]);

      // What is left: truck (or warehouse) to the destination.
      const remaining = [];
      const from = current
        ? [current.lng, current.lat]
        : origin
          ? [origin.lng, origin.lat]
          : null;
      if (from && destination) {
        remaining.push(from, [destination.lng, destination.lat]);
      }

      const setLine = (id, coords, paint) => {
        const data = {
          type: "Feature",
          geometry: { type: "LineString", coordinates: coords },
        };
        if (map.getSource(id)) {
          map.getSource(id).setData(data);
        } else if (coords.length > 1) {
          map.addSource(id, { type: "geojson", data });
          map.addLayer({
            id,
            type: "line",
            source: id,
            layout: { "line-cap": "round", "line-join": "round" },
            paint,
          });
        }
      };

      setLine("route-remaining", remaining, {
        "line-color": COLOURS.destination,
        "line-width": 3,
        "line-dasharray": [2, 2],
        "line-opacity": 0.35,
      });
      setLine("route-travelled", travelled, {
        "line-color": COLOURS.truck,
        "line-width": 4,
        "line-opacity": 0.85,
      });

      if (all.length === 1) {
        map.easeTo({ center: all[0], zoom: 10 });
      } else if (all.length > 1) {
        const bounds = all.reduce(
          (b, p) => b.extend(p),
          new LngLatBounds(all[0], all[0]),
        );
        map.fitBounds(bounds, { padding: 64, maxZoom: 12, duration: 600 });
      }
    };

    if (map.isStyleLoaded()) draw();
    else map.once("load", draw);
  }, [origin, destination, checkpoints]);

  const located = checkpoints.filter((c) => c.lat != null && c.lng != null);
  const hasAnyPoint = origin || destination || located.length > 0;

  return (
    <div className="relative">
      <style>{`@keyframes dm-pulse{0%{transform:scale(.7);opacity:.5}70%{transform:scale(1.6);opacity:0}100%{opacity:0}}`}</style>

      <div
        ref={containerRef}
        className="h-72 w-full overflow-hidden rounded-2xl border border-sage/20 sm:h-96"
      />

      {!hasAnyPoint && (
        <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-white/85 text-center">
          <p className="max-w-xs px-6 text-sm text-espresso/50">
            The map appears once the delivery location has been set.
          </p>
        </div>
      )}

      {hasAnyPoint && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-espresso/50">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: COLOURS.origin }}
            />
            Warehouse
          </span>
          {located.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: COLOURS.truck }}
              />
              Consignment now
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: COLOURS.destination }}
            />
            Delivery address
          </span>
        </div>
      )}
    </div>
  );
};

export default DeliveryMap;

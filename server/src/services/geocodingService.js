const pool = require("../config/db");

/**
 * Address -> coordinates, using OpenStreetMap's Nominatim.
 *
 * Chosen to match the MapLibre/OSM stack on the client: no API key, no
 * billing. In return it is rate limited (roughly one request per second) and
 * requires an identifying User-Agent, so every caller here treats geocoding
 * as best-effort - an order must never fail because a lookup did.
 */

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT =
  process.env.GEOCODER_USER_AGENT ||
  "WholesaleMarketplace/1.0 (order delivery geocoding)";

const buildQuery = (address) => {
  if (!address) return null;
  let value = address;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return value.trim() || null;
    }
  }
  if (typeof value !== "object") return String(value);

  // Street-level detail first, then the parts Nominatim matches most reliably.
  const parts = [
    value.house,
    value.street,
    value.area,
    value.city,
    value.state,
    value.pincode,
    value.country || "India",
  ].filter((part) => part && String(part).trim());

  return parts.length ? parts.join(", ") : null;
};

/**
 * Resolve a free-form address or address object to { lat, lng }.
 * Returns null when the address cannot be resolved, or on any network error.
 */
const geocodeAddress = async (address) => {
  const query = buildQuery(address);
  if (!query) return null;

  try {
    const url = `${NOMINATIM_URL}?format=json&limit=1&countrycodes=in&q=${encodeURIComponent(query)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`Geocoding failed (${response.status}) for: ${query}`);
      return null;
    }

    const results = await response.json();
    if (!Array.isArray(results) || results.length === 0) return null;

    const lat = Number(results[0].lat);
    const lng = Number(results[0].lon);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return null;

    return { lat, lng, label: results[0].display_name };
  } catch (error) {
    if (error.name !== "AbortError") {
      console.warn("Geocoding error:", error.message);
    }
    return null;
  }
};

/**
 * Fill in an order's destination coordinates. Fire-and-forget: called after
 * the order is committed so a slow or failed lookup never blocks checkout.
 */
const geocodeOrderDestination = async (orderId, address) => {
  const point = await geocodeAddress(address);
  if (!point) return null;

  try {
    await pool.query(
      "UPDATE orders SET delivery_lat = $1, delivery_lng = $2 WHERE id = $3",
      [point.lat, point.lng, orderId],
    );
    return point;
  } catch (error) {
    console.warn("Could not store order coordinates:", error.message);
    return null;
  }
};

/**
 * Coordinates for a wholesaler's base, cached on their profile so the same
 * city is not looked up on every order.
 */
const ensureSupplierCoordinates = async (supplierId) => {
  if (!supplierId) return null;

  try {
    const existing = await pool.query(
      "SELECT lat, lng, city, country FROM wholesaler_profiles WHERE user_id = $1",
      [supplierId],
    );
    if (existing.rows.length === 0) return null;

    const row = existing.rows[0];
    if (row.lat != null && row.lng != null) {
      return { lat: Number(row.lat), lng: Number(row.lng) };
    }

    const point = await geocodeAddress({
      city: row.city,
      country: row.country || "India",
    });
    if (!point) return null;

    await pool.query(
      `UPDATE wholesaler_profiles
       SET lat = $1, lng = $2, geocoded_at = CURRENT_TIMESTAMP
       WHERE user_id = $3`,
      [point.lat, point.lng, supplierId],
    );
    return { lat: point.lat, lng: point.lng };
  } catch (error) {
    console.warn("Could not resolve supplier coordinates:", error.message);
    return null;
  }
};

module.exports = {
  geocodeAddress,
  geocodeOrderDestination,
  ensureSupplierCoordinates,
};

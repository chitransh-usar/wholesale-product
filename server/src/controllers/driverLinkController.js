const crypto = require("crypto");
const pool = require("../config/db");
const { businessId } = require("../middlewares/businessContext");

/**
 * Driver tracking links.
 *
 * A wholesaler creates a link for an order and shares it with whoever is
 * driving. Opening it and tapping once starts posting positions. The token in
 * the URL is the only credential, so links are per-order, expiring and
 * revocable, and the endpoints below expose nothing beyond what a driver
 * needs to see.
 */

const LINK_TTL_HOURS = 72;

const loadLink = async (token) => {
  const result = await pool.query(
    `SELECT l.id, l.order_id, l.driver_name, l.vehicle_number, l.expires_at,
            l.revoked_at, o.order_number, o.delivery_address,
            o.delivery_lat, o.delivery_lng,
            COALESCE(wp.company_name, u.first_name || ' ' || u.last_name) AS supplier_name
     FROM shipment_tracking_links l
     JOIN orders o ON o.id = l.order_id
     LEFT JOIN users u ON u.id = o.supplier_id
     LEFT JOIN wholesaler_profiles wp ON wp.user_id = o.supplier_id
     WHERE l.token = $1`,
    [token],
  );
  if (result.rows.length === 0) return { error: "not_found" };

  const link = result.rows[0];
  if (link.revoked_at) return { error: "revoked" };
  if (new Date(link.expires_at) < new Date()) return { error: "expired" };
  return { link };
};

/**
 * When an order is far enough along to be handed to a driver.
 *
 * A live tracking link on an order still sitting at "payment received" is
 * wrong twice over. The goods have not been packed, so there is nothing for
 * anyone to follow, and the link is a working key: whoever holds it can start
 * reporting a phone as the vehicle for an order that has not left the shop.
 * The link also expires on a timer, so one made days early is dead by the time
 * the goods actually move.
 *
 * Allowed from "packed", where a wholesaler is genuinely arranging transport,
 * through to the delivery attempt. failed_delivery is included so a second
 * attempt can be sent out with a fresh link.
 */
const DISPATCHABLE = new Set([
  "packed",
  "ready_for_pickup",
  "shipped",
  "in_transit",
  "out_for_delivery",
  "failed_delivery",
]);

// What to tell a wholesaler who asks too early or too late. Lifecycle names
// mean nothing to them, so the message talks about the goods.
const notDispatchableReason = (status) => {
  switch (status) {
    case "delivered":
    case "completed":
      return "This order has already been delivered.";
    case "cancelled":
    case "refunded":
    case "payment_failed":
    case "return_completed":
      return "This order is closed, so it cannot be sent out.";
    default:
      return "Pack this order first. You can make a driver link once it is packed and ready to go.";
  }
};

/** Wholesaler creates a link for one of their orders. */
const createLink = async (req, res) => {
  const { orderId } = req.params;
  const { driverName, driverPhone, vehicleNumber } = req.body || {};

  try {
    const order = await pool.query(
      "SELECT id, supplier_id, status FROM orders WHERE id = $1",
      [orderId],
    );
    if (order.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    if (String(order.rows[0].supplier_id) !== String(businessId(req))) {
      return res
        .status(403)
        .json({ success: false, message: "Only the supplier can create a driver link" });
    }

    const status = order.rows[0].status;
    if (!DISPATCHABLE.has(status)) {
      return res.status(409).json({
        success: false,
        code: "ORDER_NOT_READY_TO_SEND",
        status,
        message: notDispatchableReason(status),
      });
    }

    // Replace any live link so an old one cannot keep reporting.
    await pool.query(
      `UPDATE shipment_tracking_links
       SET revoked_at = CURRENT_TIMESTAMP
       WHERE order_id = $1 AND revoked_at IS NULL`,
      [orderId],
    );

    const token = crypto.randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + LINK_TTL_HOURS * 3600 * 1000);

    const inserted = await pool.query(
      `INSERT INTO shipment_tracking_links
         (order_id, token, driver_name, driver_phone, vehicle_number, created_by, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING token, expires_at`,
      [
        orderId,
        token,
        driverName || null,
        driverPhone || null,
        vehicleNumber || null,
        req.user.id,
        expiresAt,
      ],
    );

    res.status(201).json({
      success: true,
      token: inserted.rows[0].token,
      expiresAt: inserted.rows[0].expires_at,
      // Path only: the client knows its own origin.
      path: `/track/${inserted.rows[0].token}`,
    });
  } catch (err) {
    console.error("Error creating driver link:", err);
    res.status(500).json({ success: false, message: "Could not create driver link" });
  }
};

/** Public: what the driver's page needs. Intentionally minimal. */
const getLinkInfo = async (req, res) => {
  const { error, link } = await loadLink(req.params.token);
  if (error) {
    const message =
      error === "expired"
        ? "This tracking link has expired"
        : error === "revoked"
          ? "This tracking link is no longer active"
          : "Tracking link not found";
    return res.status(error === "not_found" ? 404 : 410).json({ success: false, message });
  }

  let destination = null;
  if (link.delivery_lat != null && link.delivery_lng != null) {
    destination = { lat: Number(link.delivery_lat), lng: Number(link.delivery_lng) };
  }

  let address = link.delivery_address;
  if (typeof address === "string") {
    try {
      address = JSON.parse(address);
    } catch {
      /* leave as text */
    }
  }

  res.json({
    success: true,
    orderNumber: link.order_number,
    supplierName: link.supplier_name,
    driverName: link.driver_name,
    vehicleNumber: link.vehicle_number,
    destination,
    // Enough to find the drop-off, without exposing the buyer's identity.
    deliveryArea: address
      ? [address.area, address.city, address.state, address.pincode]
          .filter(Boolean)
          .join(", ")
      : null,
  });
};

/** Public: a position from the driver's browser. */
const recordPing = async (req, res) => {
  const { lat, lng, label } = req.body || {};
  const latitude = Number(lat);
  const longitude = Number(lng);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return res.status(400).json({ success: false, message: "Valid coordinates are required" });
  }

  const { error, link } = await loadLink(req.params.token);
  if (error) {
    return res.status(error === "not_found" ? 404 : 410).json({ success: false, message: "Link not active" });
  }

  try {
    const inserted = await pool.query(
      `INSERT INTO shipment_checkpoints
         (order_id, label, lat, lng, kind, source)
       VALUES ($1, $2, $3, $4, 'actual', 'driver_link')
       RETURNING id, label, lat, lng, recorded_at`,
      [
        link.order_id,
        label?.trim() ||
          (link.driver_name ? `${link.driver_name} en route` : "Driver location"),
        latitude,
        longitude,
      ],
    );

    await pool.query(
      "UPDATE shipment_tracking_links SET last_ping_at = CURRENT_TIMESTAMP WHERE token = $1",
      [req.params.token],
    );
    await pool.query(
      "UPDATE orders SET dispatched_at = COALESCE(dispatched_at, CURRENT_TIMESTAMP) WHERE id = $1",
      [link.order_id],
    );

    // Push to both parties so open order pages move without a refresh.
    const io = req.app.get("io");
    if (io) {
      const parties = await pool.query(
        "SELECT buyer_id, supplier_id FROM orders WHERE id = $1",
        [link.order_id],
      );
      const row = parties.rows[0];
      const checkpoint = inserted.rows[0];
      const payload = {
        orderId: link.order_id,
        checkpoint: {
          ...checkpoint,
          lat: Number(checkpoint.lat),
          lng: Number(checkpoint.lng),
        },
      };
      if (row) {
        io.to(`user:${row.buyer_id}`).emit("tracking_update", payload);
        io.to(`user:${row.supplier_id}`).emit("tracking_update", payload);
      }
    }

    res.status(201).json({ success: true });
  } catch (err) {
    console.error("Error recording driver ping:", err);
    res.status(500).json({ success: false, message: "Could not record location" });
  }
};

/** Wholesaler view of the current link for an order. */
const getOrderLink = async (req, res) => {
  const { orderId } = req.params;
  try {
    const order = await pool.query(
      "SELECT supplier_id FROM orders WHERE id = $1",
      [orderId],
    );
    if (order.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    if (String(order.rows[0].supplier_id) !== String(businessId(req))) {
      return res.status(403).json({ success: false, message: "Not your order" });
    }

    const link = await pool.query(
      `SELECT token, driver_name, vehicle_number, expires_at, last_ping_at
       FROM shipment_tracking_links
       WHERE order_id = $1 AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP
       ORDER BY created_at DESC LIMIT 1`,
      [orderId],
    );

    res.json({
      success: true,
      link: link.rows[0]
        ? { ...link.rows[0], path: `/track/${link.rows[0].token}` }
        : null,
    });
  } catch (err) {
    console.error("Error loading driver link:", err);
    res.status(500).json({ success: false, message: "Could not load driver link" });
  }
};

module.exports = { createLink, getLinkInfo, recordPing, getOrderLink };

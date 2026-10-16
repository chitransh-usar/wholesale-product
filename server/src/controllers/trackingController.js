const pool = require("../config/db");
const { ensureSupplierCoordinates } = require("../services/geocodingService");

/**
 * Delivery tracking for an order.
 *
 * The wholesaler records checkpoints; the retailer reads them. There is no
 * dependence on a driver device, which is what makes this workable - drivers
 * are rarely platform users and background location on a phone browser is not
 * reliable enough to build on.
 */

// Both parties to the order may read its tracking; nobody else.
const loadOrderForParty = async (orderId, userId, role) => {
  const result = await pool.query(
    `SELECT o.id, o.buyer_id, o.supplier_id, o.status, o.delivery_address,
            o.delivery_lat, o.delivery_lng, o.dispatched_at, o.eta_at,
            o.expected_delivery_date, o.order_number,
            COALESCE(wp.company_name, su.first_name || ' ' || su.last_name) AS supplier_name,
            wp.city AS supplier_city, wp.lat AS supplier_lat, wp.lng AS supplier_lng
     FROM orders o
     LEFT JOIN users su ON su.id = o.supplier_id
     LEFT JOIN wholesaler_profiles wp ON wp.user_id = o.supplier_id
     WHERE o.id = $1`,
    [orderId],
  );
  if (result.rows.length === 0) return { error: 404 };

  const order = result.rows[0];
  const isBuyer = String(order.buyer_id) === String(userId);
  const isSupplier = String(order.supplier_id) === String(userId);
  if (!isBuyer && !isSupplier && role !== "admin") return { error: 403 };

  return { order, isBuyer, isSupplier };
};

const getTracking = async (req, res) => {
  const { orderId } = req.params;
  try {
    const { order, error, isSupplier } = await loadOrderForParty(
      orderId,
      req.user?.id,
      req.user?.role,
    );
    if (error === 404) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    if (error === 403) {
      return res.status(403).json({ success: false, message: "Not your order" });
    }

    // Resolve the warehouse lazily so existing profiles gain coordinates
    // without a backfill job.
    let origin = null;
    if (order.supplier_lat != null && order.supplier_lng != null) {
      origin = { lat: Number(order.supplier_lat), lng: Number(order.supplier_lng) };
    } else {
      origin = await ensureSupplierCoordinates(order.supplier_id);
    }

    const checkpoints = await pool.query(
      `SELECT c.id, c.label, c.note, c.lat, c.lng, c.kind, c.source, c.recorded_at,
              u.first_name || ' ' || u.last_name AS recorded_by_name
       FROM shipment_checkpoints c
       LEFT JOIN users u ON u.id = c.recorded_by
       WHERE c.order_id = $1
       ORDER BY c.recorded_at ASC`,
      [orderId],
    );

    const destination =
      order.delivery_lat != null && order.delivery_lng != null
        ? { lat: Number(order.delivery_lat), lng: Number(order.delivery_lng) }
        : null;

    const actual = checkpoints.rows.filter((c) => c.kind === "actual");
    const lastKnown = [...actual].reverse().find((c) => c.lat != null && c.lng != null) || null;

    res.json({
      success: true,
      orderId: order.id,
      orderNumber: order.order_number,
      status: order.status,
      canRecord: isSupplier,
      supplierName: order.supplier_name,
      supplierCity: order.supplier_city,
      origin,
      destination,
      deliveryAddress: order.delivery_address,
      dispatchedAt: order.dispatched_at,
      etaAt: order.eta_at || order.expected_delivery_date,
      lastKnown: lastKnown
        ? {
            lat: Number(lastKnown.lat),
            lng: Number(lastKnown.lng),
            label: lastKnown.label,
            recordedAt: lastKnown.recorded_at,
          }
        : null,
      checkpoints: checkpoints.rows.map((c) => ({
        id: c.id,
        label: c.label,
        note: c.note,
        lat: c.lat != null ? Number(c.lat) : null,
        lng: c.lng != null ? Number(c.lng) : null,
        kind: c.kind,
        source: c.source,
        recordedAt: c.recorded_at,
        recordedBy: c.recorded_by_name,
      })),
    });
  } catch (err) {
    console.error("Error fetching tracking:", err);
    res.status(500).json({ success: false, message: "Could not load tracking" });
  }
};

const addCheckpoint = async (req, res) => {
  const { orderId } = req.params;
  const { label, note, lat, lng, kind = "actual" } = req.body;

  if (!label || !String(label).trim()) {
    return res.status(400).json({ success: false, message: "A label is required" });
  }

  try {
    const { order, error, isSupplier } = await loadOrderForParty(
      orderId,
      req.user?.id,
      req.user?.role,
    );
    if (error === 404) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    // Only the wholesaler shipping the consignment may record its progress.
    if (error === 403 || !isSupplier) {
      return res
        .status(403)
        .json({ success: false, message: "Only the supplier can update tracking" });
    }

    const inserted = await pool.query(
      `INSERT INTO shipment_checkpoints
         (order_id, label, note, lat, lng, kind, source, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'wholesaler', $7)
       RETURNING id, label, note, lat, lng, kind, source, recorded_at`,
      [
        orderId,
        String(label).trim(),
        note ? String(note).trim() : null,
        lat != null && lat !== "" ? Number(lat) : null,
        lng != null && lng !== "" ? Number(lng) : null,
        kind === "planned" ? "planned" : "actual",
        req.user.id,
      ],
    );

    // The first checkpoint marks dispatch, which anchors the ETA.
    if (!order.dispatched_at) {
      await pool.query(
        "UPDATE orders SET dispatched_at = CURRENT_TIMESTAMP WHERE id = $1 AND dispatched_at IS NULL",
        [orderId],
      );
    }

    const checkpoint = inserted.rows[0];

    // Push to the buyer if they have the order open.
    const io = req.app.get("io");
    if (io) {
      io.to(`user:${order.buyer_id}`).emit("tracking_update", {
        orderId,
        checkpoint: {
          ...checkpoint,
          lat: checkpoint.lat != null ? Number(checkpoint.lat) : null,
          lng: checkpoint.lng != null ? Number(checkpoint.lng) : null,
        },
      });
    }

    res.status(201).json({ success: true, checkpoint });
  } catch (err) {
    console.error("Error adding checkpoint:", err);
    res.status(500).json({ success: false, message: "Could not save checkpoint" });
  }
};

module.exports = { getTracking, addCheckpoint };

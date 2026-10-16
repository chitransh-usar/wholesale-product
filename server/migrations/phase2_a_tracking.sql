-- =====================================================
-- DELIVERY TRACKING
--
-- Nothing could be plotted on a map because addresses were stored as JSON
-- with no coordinates. This adds coordinates for both ends of a delivery and
-- a checkpoint log for the journey between them.
--
-- Checkpoints are deliberately source-agnostic: the wholesaler records them
-- today, a driver link or a carrier API can write the same rows later without
-- any schema change.
-- =====================================================

-- Destination coordinates, resolved when the order is placed.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_lat NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS delivery_lng NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS eta_at TIMESTAMP;

-- Origin coordinates for the wholesaler's warehouse.
ALTER TABLE wholesaler_profiles
  ADD COLUMN IF NOT EXISTS lat NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS lng NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS geocoded_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS shipment_checkpoints (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id     uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    label        VARCHAR(120) NOT NULL,
    note         TEXT,
    lat          NUMERIC(10,7),
    lng          NUMERIC(10,7),
    -- 'actual' is somewhere the consignment has been. 'planned' is a
    -- projected waypoint drawn on the route.
    kind         VARCHAR(20) NOT NULL DEFAULT 'actual'
                 CHECK (kind IN ('actual', 'planned')),
    -- who produced it, so a driver ping is distinguishable from a manual entry
    source       VARCHAR(20) NOT NULL DEFAULT 'wholesaler'
                 CHECK (source IN ('wholesaler', 'driver_link', 'carrier_api', 'system')),
    recorded_by  uuid REFERENCES users(id) ON DELETE SET NULL,
    recorded_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_shipment_checkpoints_order
  ON shipment_checkpoints(order_id, recorded_at DESC);

COMMENT ON TABLE shipment_checkpoints IS 'Journey log for an order, one row per confirmed or projected location';
COMMENT ON COLUMN shipment_checkpoints.kind IS 'actual = consignment was here; planned = projected waypoint';
COMMENT ON COLUMN shipment_checkpoints.source IS 'Origin of the record, so manual entries and GPS pings stay distinguishable';
COMMENT ON COLUMN orders.delivery_lat IS 'Destination latitude, geocoded from delivery_address at checkout';
COMMENT ON COLUMN orders.eta_at IS 'Projected arrival, set when the consignment is dispatched';

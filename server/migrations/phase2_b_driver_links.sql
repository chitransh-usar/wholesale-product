-- =====================================================
-- DRIVER TRACKING LINKS
--
-- Live location without asking a driver to install anything, and without the
-- wholesaler typing coordinates by hand.
--
-- The wholesaler generates a link and sends it over WhatsApp/SMS. The driver
-- opens it in whatever browser their phone has and taps once to share
-- location. The page then posts positions while it stays open. No account, no
-- app, no background-location permission - which is what makes it realistic,
-- since drivers are rarely platform users.
--
-- The token is the credential, so links are scoped to one order and expire.
-- =====================================================

CREATE TABLE IF NOT EXISTS shipment_tracking_links (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id    uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    token       VARCHAR(64) NOT NULL UNIQUE,
    driver_name VARCHAR(120),
    driver_phone VARCHAR(20),
    vehicle_number VARCHAR(40),
    created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
    expires_at  TIMESTAMP NOT NULL,
    revoked_at  TIMESTAMP,
    last_ping_at TIMESTAMP,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tracking_links_token ON shipment_tracking_links(token);
CREATE INDEX IF NOT EXISTS idx_tracking_links_order ON shipment_tracking_links(order_id);

COMMENT ON TABLE shipment_tracking_links IS 'Tokenised, expiring links that let a driver share location without an account';
COMMENT ON COLUMN shipment_tracking_links.token IS 'Bearer credential embedded in the shared URL';
COMMENT ON COLUMN shipment_tracking_links.last_ping_at IS 'Most recent position received through this link';

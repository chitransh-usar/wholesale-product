-- =====================================================
-- WAREHOUSE / DISPATCH ADDRESS
--
-- Deliveries start somewhere. Until now the origin shown on the tracking map
-- was geocoded from the wholesaler's city alone, which lands a pin in the
-- middle of a city rather than at the yard the truck actually leaves from.
--
-- The warehouse belongs to the business, not to any single product, so it is
-- stored once on the profile. lat/lng already exist from phase2_a_tracking;
-- these are the human-readable parts plus a flag for whether the coordinates
-- came from a pin the wholesaler placed or from geocoding the text.
-- =====================================================

ALTER TABLE wholesaler_profiles
  ADD COLUMN IF NOT EXISTS warehouse_address  TEXT,
  ADD COLUMN IF NOT EXISTS warehouse_city     VARCHAR(100),
  ADD COLUMN IF NOT EXISTS warehouse_state    VARCHAR(100),
  ADD COLUMN IF NOT EXISTS warehouse_pincode  VARCHAR(10),
  ADD COLUMN IF NOT EXISTS warehouse_pinned   BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN wholesaler_profiles.warehouse_address IS 'Street address the consignment is dispatched from';
COMMENT ON COLUMN wholesaler_profiles.warehouse_pinned IS 'True when lat/lng came from a pin placed on the map rather than geocoded text';

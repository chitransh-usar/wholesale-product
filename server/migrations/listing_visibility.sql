-- =====================================================
-- LISTING VISIBILITY
--
-- Until now every listing a wholesaler created went straight into the public
-- catalogue, side by side with every competitor selling the same product.
-- There was no way to opt out. A wholesaler with a distinctive range had to
-- choose between showing it and protecting it.
--
-- This adds a per-listing visibility setting with three levels:
--
--   public      Catalogue, search and the product comparison page, exactly as
--               before. Also shown on the wholesaler's storefront.
--
--   storefront  Never in the catalogue, never in comparison. Shown only on
--               the wholesaler's own storefront page at /wholesaler/:id.
--               This is the "wholesaler only space".
--
--   private     Not shown anywhere public. Visible to the wholesaler in their
--               own dashboard only, so they can quote it by phone or WhatsApp
--               without publishing it at all.
--
-- Every existing listing becomes 'public', so nothing on the site changes
-- until a wholesaler deliberately moves something.
--
-- Safe to run more than once.
-- =====================================================

BEGIN;

ALTER TABLE supplier_inventory
  ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) NOT NULL DEFAULT 'public';

-- Existing rows: an explicit backfill as well as the default, so a column
-- added by an earlier partial run is still corrected.
UPDATE supplier_inventory
   SET visibility = 'public'
 WHERE visibility IS NULL OR visibility NOT IN ('public', 'storefront', 'private');

ALTER TABLE supplier_inventory
  DROP CONSTRAINT IF EXISTS supplier_inventory_visibility_check;

ALTER TABLE supplier_inventory
  ADD CONSTRAINT supplier_inventory_visibility_check
  CHECK (visibility IN ('public', 'storefront', 'private'));

-- The catalogue queries filter on visibility while already filtering on
-- status and stock, and the storefront filters by supplier. Both are covered
-- here.
CREATE INDEX IF NOT EXISTS idx_supplier_inventory_visibility
  ON supplier_inventory (visibility, status);

CREATE INDEX IF NOT EXISTS idx_supplier_inventory_supplier_visibility
  ON supplier_inventory (supplier_id, visibility);

COMMIT;

-- =====================================================
-- Verification
-- =====================================================
-- SELECT visibility, COUNT(*) FROM supplier_inventory GROUP BY visibility;
--   expected: every row on 'public' immediately after this migration.
-- =====================================================

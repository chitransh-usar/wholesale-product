-- ---------------------------------------------------------------
-- Shop listings learn what a bill needs
-- ---------------------------------------------------------------
-- There are two product lists today and they mean the same thing to the
-- wholesaler: something he sells. They are split because each grew for one
-- half of the job and neither is a superset of the other.
--
--   items               unit, pack size, HSN code, GST rate. The sale screen
--                       and the invoice read these.
--   supplier_inventory  price, bulk price, MOQ, image, visibility. The
--                       catalogue and orders read these.
--
-- This adds the billing half to the listing, so one row can do both jobs and
-- the rate list can retire into it. Nothing reads these columns yet: adding
-- them is its own step so that the data move and the screen change land
-- separately and can be judged separately.
--
-- RUN this before scripts/merge_items_into_listings.js.

ALTER TABLE supplier_inventory
    -- Wholesale does not sell "1 item". It sells a case, a dozen, a metre.
    ADD COLUMN IF NOT EXISTS unit VARCHAR(20) NOT NULL DEFAULT 'pcs',
    ADD COLUMN IF NOT EXISTS pack_size NUMERIC(12, 3),
    ADD COLUMN IF NOT EXISTS hsn_code VARCHAR(20),
    ADD COLUMN IF NOT EXISTS gst_percent NUMERIC(5, 2),
    -- The wholesaler's own note on the product. Private, like parties.notes:
    -- it is for him, and no buyer ever sees it.
    ADD COLUMN IF NOT EXISTS notes TEXT,
    -- Which rate list row this listing came from, so the move can be checked,
    -- repeated safely, and undone. Dropped once the rate list is gone.
    ADD COLUMN IF NOT EXISTS source_item_id UUID;

-- MOQ is an INTEGER here and NUMERIC(12,3) on items, because you can sell 2.5
-- metres of cloth and cannot sell 2.5 shirts. Rounding a wholesaler's minimum
-- down to a whole number would quietly change his terms, so the wider type
-- wins. This is the same widening invoice_items.quantity needed.
ALTER TABLE supplier_inventory
    ALTER COLUMN moq TYPE NUMERIC(12, 3);

-- order_items copies the MOQ off the listing at checkout. Widening only the
-- listing breaks every order: the driver hands back NUMERIC as a string, and
-- "10.000" going into an INTEGER column is a 400 on the checkout button. The
-- two columns have to move together.
ALTER TABLE order_items
    ALTER COLUMN moq TYPE NUMERIC(12, 3);

-- One listing per rate list row, so running the move twice cannot duplicate a
-- product. Partial, because listings created directly in the shop have no
-- source row and there can be any number of those.
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_inventory_source_item
    ON supplier_inventory (source_item_id)
    WHERE source_item_id IS NOT NULL;

COMMENT ON COLUMN supplier_inventory.notes IS
    'The wholesaler''s private note on this product. Never shown to a buyer.';
COMMENT ON COLUMN supplier_inventory.source_item_id IS
    'The items row this listing was created from, if it came from the rate list.';

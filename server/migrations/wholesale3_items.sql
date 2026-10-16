-- Wholesale 3.0: the wholesaler's own rate list.
--
-- The marketplace model had a shared `products` table with a row per seller
-- in `supplier_inventory`, so two wholesalers listing the same shirting were
-- rows against one product. That is what made cross seller price comparison
-- possible, and it is exactly what a closed network must not do.
--
-- Here an item belongs to one wholesaler, full stop. His rate list is his own
-- and nobody else can see it. The old tables are left alone: the marketplace
-- is switched off by a flag, not deleted.
--
-- Note that sale_lines stores item_name as text rather than referencing this
-- table. That is deliberate. A sale must be recordable for something not on
-- the rate list, and an old bill must not change when a rate is edited.
--
-- Run by hand against Neon, like every other file in this directory.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wholesaler_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    name VARCHAR(255) NOT NULL,
    category VARCHAR(100),

    -- Wholesale does not sell "1 item". It sells a case, a dozen, a metre.
    unit VARCHAR(20) NOT NULL DEFAULT 'pcs',
    pack_size NUMERIC(12, 3),

    rate NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (rate >= 0),

    -- Minimum order quantity. Real in wholesale, and nothing enforces it yet.
    moq NUMERIC(12, 3),

    -- For the GST work later. Nothing reads this column today, and invoices
    -- still stamp a hardcoded HSN. Adding the column now is free and saves a
    -- migration when that gets fixed.
    hsn_code VARCHAR(20),

    notes TEXT,

    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_items_wholesaler ON items (wholesaler_id, name);

-- The same item should not appear twice in one rate list. Compared without
-- case so "Cotton Shirting" and "cotton shirting" collide, which is what a
-- wholesaler typing quickly would expect. Two different wholesalers may of
-- course both stock it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_wholesaler_name
    ON items (wholesaler_id, lower(name));

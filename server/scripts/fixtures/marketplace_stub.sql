-- Test fixture. Not a migration. Never run this against Neon.
--
-- There is no committed baseline for the marketplace tables, so a local test
-- database gets built by hand and is always missing something. Every time a
-- test drives checkout it dies on a different absent column, one round trip at
-- a time. This file is the list of what the marketplace code actually requires,
-- gathered by running checkout until it stopped complaining.
--
-- It is idempotent, so a local database can be brought up to date by running
-- it again after adding a table.
--
-- Replace all of this the day someone commits a real schema dump:
--     pg_dump --schema-only --no-owner --no-privileges "$DATABASE_URL" \
--         > server/migrations/000_baseline.sql

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS quantity INTEGER,
    ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS payment_plan VARCHAR(30) DEFAULT 'full',
    ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(20),
    ADD COLUMN IF NOT EXISTS delivery_lat DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS delivery_lng DOUBLE PRECISION;

ALTER TABLE order_items
    ADD COLUMN IF NOT EXISTS inventory_item_id UUID,
    ADD COLUMN IF NOT EXISTS moq INTEGER,
    ADD COLUMN IF NOT EXISTS shipping_days INTEGER,
    ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'pending';

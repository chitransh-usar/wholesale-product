-- =====================================================
-- FIX UUID / INTEGER COLUMN TYPE MISMATCHES
--
-- users, products, orders and supplier_inventory use UUID primary keys, but
-- enterprise_order_management.sql declared several referencing columns as
-- INTEGER. Writing a UUID into them fails with:
--   invalid input syntax for type integer: "c82559bf-..."
--
-- The offending integer values cannot be cast to UUID and never matched a
-- real row (an FK was impossible across mismatched types), so the columns are
-- rebuilt as UUID with proper foreign keys. orders.supplier_id is then
-- backfilled from supplier_inventory, which holds the authoritative seller.
--
-- Idempotent: each block only acts when the column is not already UUID.
-- =====================================================

-- 1. orders.supplier_id -> UUID
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'supplier_id'
      AND data_type <> 'uuid'
  ) THEN
    ALTER TABLE orders DROP COLUMN supplier_id;
    ALTER TABLE orders
      ADD COLUMN supplier_id UUID REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 2. order_status_history.order_id -> UUID
--    Existing rows point at integer order ids that cannot exist in a UUID
--    orders table, so they are orphans and are removed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'order_status_history' AND column_name = 'order_id'
      AND data_type <> 'uuid'
  ) THEN
    DELETE FROM order_status_history;
    ALTER TABLE order_status_history DROP COLUMN order_id;
    ALTER TABLE order_status_history
      ADD COLUMN order_id UUID REFERENCES orders(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 3. order_status_history.updated_by -> UUID (added if missing)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'order_status_history' AND column_name = 'updated_by'
  ) THEN
    ALTER TABLE order_status_history ADD COLUMN updated_by UUID;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'order_status_history' AND column_name = 'updated_by'
      AND data_type <> 'uuid'
  ) THEN
    ALTER TABLE order_status_history DROP COLUMN updated_by;
    ALTER TABLE order_status_history ADD COLUMN updated_by UUID;
  END IF;
END $$;

-- 4. payment_transactions.order_id -> UUID
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_transactions' AND column_name = 'order_id'
      AND data_type <> 'uuid'
  ) THEN
    DELETE FROM payment_transactions;
    ALTER TABLE payment_transactions DROP COLUMN order_id;
    ALTER TABLE payment_transactions
      ADD COLUMN order_id UUID REFERENCES orders(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 5. Columns createOrder writes, added only if absent
ALTER TABLE order_status_history
  ADD COLUMN IF NOT EXISTS status VARCHAR(50),
  ADD COLUMN IF NOT EXISTS previous_status VARCHAR(50),
  ADD COLUMN IF NOT EXISTS updated_by_role VARCHAR(20),
  ADD COLUMN IF NOT EXISTS remarks TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE payment_transactions
  ADD COLUMN IF NOT EXISTS amount DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50),
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50),
  ADD COLUMN IF NOT EXISTS gateway_response JSONB,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- 6. Recover supplier_id on any existing orders from their inventory item
UPDATE orders o
SET supplier_id = si.supplier_id
FROM supplier_inventory si
WHERE o.inventory_item_id = si.id
  AND o.supplier_id IS NULL;

-- 7. Indexes on the rebuilt columns
CREATE INDEX IF NOT EXISTS idx_orders_supplier_id ON orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_order_history_order_id ON order_status_history(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_tx_order_id ON payment_transactions(order_id);

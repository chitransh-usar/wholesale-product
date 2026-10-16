-- =====================================================
-- ALIGN THE DATABASE WITH THE APPLICATION
--
-- The database was built from an older schema than this repo's migrations.
-- Two families of mismatch remain after fix_uuid_column_types.sql:
--
--   1. Satellite tables (promotions, notifications, analytics, order_items,
--      shipments, ...) still declare their user/product/order/inventory
--      references as INTEGER, while those tables use UUID primary keys.
--      Any query passing a real id fails with
--        invalid input syntax for type integer: "<uuid>"
--
--   2. Legacy NOT NULL columns duplicate newer ones. order_status_history
--      carries both to_status/changed_by and status/updated_by. The app only
--      writes the latter, so inserts fail with a not-null violation on the
--      former. Same for payment_transactions.payment_type/status.
--
-- Columns pointing at SERIAL-keyed tables (coupons.id, flash_sales.id,
-- gift_cards.id, loyalty_accounts.id, referrals.id, order_items.id) correctly
-- stay INTEGER and are untouched.
--
-- NOTE: converting a column drops and re-adds it, so any values it holds are
-- lost. These columns hold integers that cannot reference a UUID row, so they
-- are meaningless already. Check row counts first if unsure.
--
-- Idempotent: every step only acts when the column is not already correct.
-- =====================================================

-- ---------------------------------------------------------------
-- 1. Convert INTEGER reference columns to UUID
-- ---------------------------------------------------------------
DO $$
DECLARE
  target RECORD;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      -- -> users(id)
      ('coupons',                'supplier_id'),
      ('coupons',                'created_by'),
      ('coupon_usage',           'user_id'),
      ('flash_sales',            'created_by'),
      ('flash_sale_products',    'supplier_id'),
      ('gift_cards',             'user_id'),
      ('gift_card_transactions', 'user_id'),
      ('loyalty_accounts',       'user_id'),
      ('referrals',              'referrer_id'),
      ('referrals',              'referee_id'),
      ('wishlist_notifications', 'user_id'),
      ('notifications',          'user_id'),
      ('order_analytics',        'supplier_id'),
      ('order_analytics',        'buyer_id'),
      ('order_items',            'supplier_id'),
      ('return_requests',        'requested_by'),
      ('return_requests',        'approved_by'),
      ('inventory_log',          'performed_by'),
      ('orders',                 'cancelled_by'),
      ('payment_transactions',   'created_by'),
      -- -> products(id)
      ('coupons',                'product_id'),
      ('flash_sale_products',    'product_id'),
      ('order_items',            'product_id'),
      ('wishlist_notifications', 'product_id'),
      -- -> orders(id)
      ('coupon_usage',           'order_id'),
      ('invoices',               'order_id'),
      ('notifications',          'order_id'),
      ('order_analytics',        'order_id'),
      ('order_items',            'order_id'),
      ('return_requests',        'order_id'),
      ('return_requests',        'replacement_order_id'),
      ('shipments',              'order_id'),
      ('inventory_log',          'order_id'),
      -- -> supplier_inventory(id)
      ('order_items',            'inventory_item_id'),
      ('inventory_log',          'inventory_item_id')
    ) AS t(tbl, col)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name  = target.tbl
        AND column_name = target.col
        AND data_type  <> 'uuid'
    ) THEN
      EXECUTE format('ALTER TABLE %I DROP COLUMN %I', target.tbl, target.col);
      EXECUTE format('ALTER TABLE %I ADD COLUMN %I UUID', target.tbl, target.col);
      RAISE NOTICE 'Converted %.% to UUID', target.tbl, target.col;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------
-- 2. Relax legacy NOT NULL columns the application does not write
-- ---------------------------------------------------------------
DO $$
DECLARE
  target RECORD;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('order_status_history', 'to_status'),
      ('order_status_history', 'changed_by'),
      ('order_status_history', 'from_status'),
      ('payment_transactions', 'payment_type'),
      ('payment_transactions', 'status'),
      ('payment_transactions', 'transaction_id')
    ) AS t(tbl, col)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = target.tbl
        AND column_name  = target.col
        AND is_nullable  = 'NO'
    ) THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP NOT NULL', target.tbl, target.col);
      RAISE NOTICE 'Made %.% nullable', target.tbl, target.col;
    END IF;
  END LOOP;
END $$;

-- Keep the legacy status columns populated so old readers still work.
-- (order_status_history.to_status mirrors status.)
CREATE OR REPLACE FUNCTION sync_order_status_history_legacy()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.to_status IS NULL THEN
    NEW.to_status := NEW.status;
  END IF;
  IF NEW.from_status IS NULL THEN
    NEW.from_status := NEW.previous_status;
  END IF;
  IF NEW.changed_by IS NULL THEN
    NEW.changed_by := NEW.updated_by;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  -- changed_by must be UUID for the trigger to copy updated_by into it
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'order_status_history'
      AND column_name = 'changed_by'
      AND data_type <> 'uuid'
  ) THEN
    ALTER TABLE order_status_history DROP COLUMN changed_by;
    ALTER TABLE order_status_history ADD COLUMN changed_by UUID;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_order_status_history_legacy ON order_status_history;
CREATE TRIGGER trg_order_status_history_legacy
  BEFORE INSERT ON order_status_history
  FOR EACH ROW EXECUTE FUNCTION sync_order_status_history_legacy();

-- payment_transactions.status mirrors payment_status
CREATE OR REPLACE FUNCTION sync_payment_transactions_legacy()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS NULL THEN
    NEW.status := COALESCE(NEW.payment_status, 'pending');
  END IF;
  IF NEW.payment_type IS NULL THEN
    NEW.payment_type := COALESCE(NEW.payment_method, 'upi');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_transactions_legacy ON payment_transactions;
CREATE TRIGGER trg_payment_transactions_legacy
  BEFORE INSERT ON payment_transactions
  FOR EACH ROW EXECUTE FUNCTION sync_payment_transactions_legacy();

-- ---------------------------------------------------------------
-- 3. Indexes on the converted reference columns
-- ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_order_items_order_id     ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_accounts_user    ON loyalty_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_gift_cards_user          ON gift_cards(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user       ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_coupon_usage_user        ON coupon_usage(user_id);

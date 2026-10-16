-- =====================================================
-- REALIGN ORDER STATUS / PAYMENT STATUS CHECK CONSTRAINTS
--
-- The database carries check constraints written for the original, small
-- status vocabulary ('Processing', 'Shipped', ...). The application now drives
-- orders through the full lifecycle in src/services/orderStatusService.js, so
-- inserting 'payment_pending' fails with:
--   new row for relation "orders" violates check constraint "chk_order_status"
--
-- Drop the stale constraints and recreate them from the lifecycle the code
-- actually uses. Statuses below are every key and transition target in
-- ORDER_STATUS_FLOW, so validateStatusTransition can never produce a value the
-- database rejects.
-- =====================================================

-- Drop any existing status constraints regardless of how they were named.
DO $$
DECLARE
  con RECORD;
BEGIN
  FOR con IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'orders'::regclass
      AND contype = 'c'
      AND (
        pg_get_constraintdef(oid) ILIKE '%status%'
      )
  LOOP
    EXECUTE format('ALTER TABLE orders DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

-- Normalise any legacy values so the new constraint can be applied.
UPDATE orders SET status = 'processing'  WHERE lower(status) = 'processing';
UPDATE orders SET status = 'shipped'     WHERE lower(status) = 'shipped';
UPDATE orders SET status = 'delivered'   WHERE lower(status) = 'delivered';
UPDATE orders SET status = 'cancelled'   WHERE lower(status) IN ('cancelled', 'canceled');
UPDATE orders SET status = 'completed'   WHERE lower(status) = 'completed';
UPDATE orders SET status = 'pending'     WHERE lower(status) = 'pending';
UPDATE orders SET status = 'payment_pending'
  WHERE status IS NULL OR status NOT IN (
    'pending', 'payment_pending', 'payment_completed', 'payment_failed',
    'supplier_accepted', 'processing', 'packed', 'ready_for_pickup',
    'shipped', 'in_transit', 'out_for_delivery', 'delivered',
    'failed_delivery', 'completed', 'return_requested', 'return_approved',
    'return_rejected', 'return_completed', 'replacement_requested',
    'replacement_issued', 'cancelled', 'refunded'
  );

ALTER TABLE orders
  ADD CONSTRAINT chk_order_status CHECK (status IN (
    'pending', 'payment_pending', 'payment_completed', 'payment_failed',
    'supplier_accepted', 'processing', 'packed', 'ready_for_pickup',
    'shipped', 'in_transit', 'out_for_delivery', 'delivered',
    'failed_delivery', 'completed', 'return_requested', 'return_approved',
    'return_rejected', 'return_completed', 'replacement_requested',
    'replacement_issued', 'cancelled', 'refunded'
  ));

-- payment_status uses its own vocabulary (see updatePaymentStatus).
DO $$
DECLARE
  con RECORD;
BEGIN
  FOR con IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'orders'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%payment_status%'
  LOOP
    EXECUTE format('ALTER TABLE orders DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

UPDATE orders SET payment_status = lower(payment_status)
  WHERE payment_status IS NOT NULL;
UPDATE orders SET payment_status = 'pending'
  WHERE payment_status IS NULL
     OR payment_status NOT IN ('pending', 'paid', 'partial', 'failed', 'cod', 'refunded');

ALTER TABLE orders
  ADD CONSTRAINT chk_order_payment_status CHECK (payment_status IN (
    'pending', 'paid', 'partial', 'failed', 'cod', 'refunded'
  ));

-- order_status_history mirrors the same vocabulary.
DO $$
DECLARE
  con RECORD;
BEGIN
  FOR con IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'order_status_history'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE order_status_history DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

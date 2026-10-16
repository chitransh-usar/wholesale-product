-- Re-align payment_status CHECK constraint at the end of migrations
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
     OR payment_status NOT IN ('pending', 'payment_pending', 'paid', 'partial', 'partially_paid', 'failed', 'cod', 'refunded');

ALTER TABLE orders
  ADD CONSTRAINT chk_order_payment_status CHECK (payment_status IN (
    'pending', 'payment_pending', 'paid', 'partial', 'partially_paid', 'failed', 'cod', 'refunded'
  ));

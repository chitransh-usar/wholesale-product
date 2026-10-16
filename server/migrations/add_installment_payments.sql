-- Migration: Add Partial Payment / Installment Payment System fields

-- 1. Extend orders table
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS payment_plan VARCHAR(50) DEFAULT 'full';

ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12,2) DEFAULT 0;

ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(12,2);

-- Re-align payment_status CHECK constraint to include 'partially_paid' and 'payment_pending'
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

ALTER TABLE orders
  ADD CONSTRAINT chk_order_payment_status CHECK (payment_status IN (
    'pending', 'payment_pending', 'paid', 'partial', 'partially_paid', 'failed', 'cod', 'refunded'
  ));

-- Backfill existing orders safely
UPDATE orders
SET remaining_amount = CASE 
  WHEN LOWER(COALESCE(payment_status, '')) IN ('paid', 'completed') THEN 0
  ELSE COALESCE(total_amount, 0)
END,
amount_paid = CASE 
  WHEN LOWER(COALESCE(payment_status, '')) IN ('paid', 'completed') THEN COALESCE(total_amount, 0)
  ELSE 0
END
WHERE remaining_amount IS NULL;

-- 2. Extend payment_transactions table
ALTER TABLE payment_transactions
ADD COLUMN IF NOT EXISTS buyer_id UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE payment_transactions
ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE payment_transactions
ADD COLUMN IF NOT EXISTS installment_number INT DEFAULT 1;

ALTER TABLE payment_transactions
ADD COLUMN IF NOT EXISTS payment_type VARCHAR(50) DEFAULT 'full'; -- 'full', 'initial', 'remaining'

ALTER TABLE payment_transactions
ADD COLUMN IF NOT EXISTS upi_transaction_reference VARCHAR(100);

ALTER TABLE payment_transactions
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_orders_payment_plan ON orders(payment_plan);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_payment_tx_order_installment ON payment_transactions(order_id, installment_number);

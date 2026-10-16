-- 1. Add delivery_address column safely if it doesn't exist
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS delivery_address JSONB;

-- 2. Add contact_phone column safely if it doesn't exist
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(20);

-- 3. Set structural defaults to lowercase 'pending' for new rows
ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE orders ALTER COLUMN payment_status SET DEFAULT 'pending';

-- 4. CLEANUP STEP: Force all legacy/existing rows to lowercase 'pending' 
-- This stops PostgreSQL from throwing validation/type match errors on older records.
UPDATE orders SET status = 'pending' WHERE status IS NULL OR status = 'Processing';
UPDATE orders SET payment_status = 'pending' WHERE payment_status IS NULL OR payment_status = 'Pending';

-- 5. Build performance optimization indexes
CREATE INDEX IF NOT EXISTS idx_orders_buyer_id ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);

-- 6. Add structural comments for documentation
COMMENT ON COLUMN orders.delivery_address IS 'Stores delivery address as JSON: {name, phone, house, street, area, city, state, country, pincode}';
COMMENT ON COLUMN orders.contact_phone IS 'Contact phone number for delivery';
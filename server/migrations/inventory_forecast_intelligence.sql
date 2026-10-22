ALTER TABLE supplier_inventory
  ADD COLUMN IF NOT EXISTS reorder_level integer,
  ADD COLUMN IF NOT EXISTS reorder_quantity integer,
  ADD COLUMN IF NOT EXISTS safety_stock integer,
  ADD COLUMN IF NOT EXISTS lead_time_days integer DEFAULT 7,
  ADD COLUMN IF NOT EXISTS inventory_status varchar(30) DEFAULT 'healthy',
  ADD COLUMN IF NOT EXISTS last_restocked_at timestamp with time zone;

CREATE TABLE IF NOT EXISTS inventory_forecasts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id uuid NOT NULL,
  product_id uuid NOT NULL,
  current_stock integer NOT NULL DEFAULT 0,
  average_daily_sales numeric(12,3) NOT NULL DEFAULT 0,
  predicted_days_remaining numeric(12,3),
  recommended_reorder_quantity integer NOT NULL DEFAULT 0,
  forecast_status varchar(30) NOT NULL DEFAULT 'healthy',
  generated_at timestamp with time zone NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_forecasts_seller_id
  ON inventory_forecasts (seller_id);

CREATE INDEX IF NOT EXISTS idx_inventory_forecasts_product_id
  ON inventory_forecasts (product_id);

CREATE INDEX IF NOT EXISTS idx_inventory_forecasts_generated_at
  ON inventory_forecasts (generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_supplier_inventory_restock_health
  ON supplier_inventory (supplier_id, inventory_status, stock);

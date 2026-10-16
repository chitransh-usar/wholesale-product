-- Retail / promotions feature tables.
-- NOTE: users(id), products(id) and orders(id) are UUID in this database, so
-- every column that references them is declared UUID. Each table's own primary
-- key stays SERIAL (it is only ever used as an opaque handle by the API).

CREATE TABLE IF NOT EXISTS flash_sales (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  discount_type VARCHAR(50) DEFAULT 'percentage',
  discount_value NUMERIC(10,2) NOT NULL,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS flash_sale_products (
  id SERIAL PRIMARY KEY,
  flash_sale_id INTEGER REFERENCES flash_sales(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coupons (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  title VARCHAR(255),
  coupon_type VARCHAR(50) DEFAULT 'percentage',
  discount_type VARCHAR(50) DEFAULT 'percentage',
  value NUMERIC(10,2) NOT NULL,
  max_discount_amount NUMERIC(10,2) DEFAULT 0,
  min_order_amount NUMERIC(10,2) DEFAULT 0,
  max_usage INTEGER DEFAULT 100,
  per_user_usage INTEGER DEFAULT 1,
  start_date TIMESTAMPTZ DEFAULT NOW(),
  end_date TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN DEFAULT true,
  first_order_only BOOLEAN DEFAULT false,
  new_customer_only BOOLEAN DEFAULT false,
  loyalty_only BOOLEAN DEFAULT false,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  category VARCHAR(100),
  supplier_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coupon_usage (
  id SERIAL PRIMARY KEY,
  coupon_id INTEGER REFERENCES coupons(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loyalty_accounts (
  id SERIAL PRIMARY KEY,
  user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  points_balance INTEGER DEFAULT 0,
  lifetime_earned INTEGER DEFAULT 0,
  lifetime_redeemed INTEGER DEFAULT 0,
  membership_tier VARCHAR(30) DEFAULT 'Bronze',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id SERIAL PRIMARY KEY,
  account_id INTEGER REFERENCES loyalty_accounts(id) ON DELETE CASCADE,
  transaction_type VARCHAR(50) NOT NULL,
  points INTEGER NOT NULL,
  description TEXT,
  reference_type VARCHAR(50),
  reference_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referrals (
  id SERIAL PRIMARY KEY,
  referrer_id UUID REFERENCES users(id) ON DELETE CASCADE,
  referee_id UUID REFERENCES users(id) ON DELETE CASCADE,
  referral_code VARCHAR(50) NOT NULL,
  status VARCHAR(30) DEFAULT 'pending',
  reward_status VARCHAR(30) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referral_rewards (
  id SERIAL PRIMARY KEY,
  referral_id INTEGER REFERENCES referrals(id) ON DELETE CASCADE,
  reward_type VARCHAR(50) DEFAULT 'points',
  reward_value INTEGER DEFAULT 0,
  status VARCHAR(30) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gift_cards (
  id SERIAL PRIMARY KEY,
  gift_card_code VARCHAR(100) UNIQUE NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  recipient_email VARCHAR(255),
  amount NUMERIC(12,2) NOT NULL,
  balance NUMERIC(12,2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'INR',
  expires_at TIMESTAMPTZ,
  status VARCHAR(30) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gift_card_transactions (
  id SERIAL PRIMARY KEY,
  gift_card_id INTEGER REFERENCES gift_cards(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  transaction_type VARCHAR(50) NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  reference_type VARCHAR(50),
  reference_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wishlist_notifications (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  notification_type VARCHAR(50) DEFAULT 'price-drop',
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flash_sales_active ON flash_sales(is_active, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_loyalty_accounts_user ON loyalty_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id, status);
CREATE INDEX IF NOT EXISTS idx_gift_cards_code ON gift_cards(gift_card_code);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'coupon_code') THEN
    ALTER TABLE orders ADD COLUMN coupon_code VARCHAR(100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'discount_amount') THEN
    ALTER TABLE orders ADD COLUMN discount_amount NUMERIC(12,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'loyalty_points_used') THEN
    ALTER TABLE orders ADD COLUMN loyalty_points_used INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'gift_card_code') THEN
    ALTER TABLE orders ADD COLUMN gift_card_code VARCHAR(100);
  END IF;
END $$;

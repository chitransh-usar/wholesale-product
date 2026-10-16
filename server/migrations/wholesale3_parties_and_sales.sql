-- Wholesale 3.0: the management spine.
--
-- The product is moving from a marketplace to a sales management tool for
-- wholesalers. The trunk of that model is four things: a party (the
-- wholesaler's customer), a sale, the lines on that sale, and the money
-- received against it. Everything else in the new product hangs off these.
--
-- Deliberate choices, made so that open product questions do not force a
-- rewrite later:
--
--   * A party is PRIVATE to one wholesaler. Two wholesalers who both deal
--     with the same shop get one row each. Linking two rows later is easy,
--     un-leaking the fact that they share a customer is not.
--   * A party does not need a login. Most will never open the app, and the
--     wholesaler still has to record sales against them. user_id links a
--     party to a real account if and when they ever sign up.
--   * A payment MAY reference a sale but does not have to. Traders pay a
--     lump sum against several old bills without saying which, so the
--     nullable sale_id supports both "against this bill" and "against the
--     running balance" without a schema change.
--   * A sale carries `source` rather than living in two tables. A sale the
--     wholesaler types and an order a retailer sends are the same record,
--     so the ledger and the reports never have to reconcile two shapes.
--
-- Run by hand against Neon, like every other file in this directory.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------
-- Parties: the wholesaler's customer book
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wholesaler_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- What the wholesaler calls them, which is often a person, not a firm.
    name VARCHAR(255) NOT NULL,
    business_name VARCHAR(255),
    phone VARCHAR(20),
    city VARCHAR(100),
    address TEXT,
    gstin VARCHAR(20),
    notes TEXT,

    -- Set only if this party ever creates an account of their own.
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,

    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_parties_wholesaler ON parties (wholesaler_id);
CREATE INDEX IF NOT EXISTS idx_parties_user ON parties (user_id);

-- One phone number should not appear twice in the same book. Partial, because
-- a party added from a diary may have no phone number at all.
CREATE UNIQUE INDEX IF NOT EXISTS idx_parties_wholesaler_phone
    ON parties (wholesaler_id, phone)
    WHERE phone IS NOT NULL AND phone <> '';

-- ---------------------------------------------------------------
-- Sales: one row whether the wholesaler typed it or a retailer sent it
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wholesaler_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    party_id UUID NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,

    sale_number VARCHAR(50),
    sale_date DATE NOT NULL DEFAULT CURRENT_DATE,

    -- Who created it. Retailer ordering is not built yet, so every row is
    -- 'wholesaler' for now, but the column exists so it never has to be
    -- backfilled.
    source VARCHAR(20) NOT NULL DEFAULT 'wholesaler'
        CHECK (source IN ('wholesaler', 'retailer')),

    -- A short spine on purpose. The real stages come from watching a
    -- wholesaler work, and adding to this list is cheap.
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'confirmed', 'delivered', 'cancelled')),

    subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    discount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    notes TEXT,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sales_wholesaler ON sales (wholesaler_id, sale_date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_party ON sales (party_id, sale_date DESC);

CREATE TABLE IF NOT EXISTS sale_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,

    -- Item name is stored on the line, not referenced. A rate list exists to
    -- save typing, but a sale must still be recordable for something that is
    -- not on it, and an old bill must not change when a rate is edited.
    item_name VARCHAR(255) NOT NULL,
    quantity NUMERIC(12, 3) NOT NULL DEFAULT 1,
    unit VARCHAR(20),
    rate NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sale_lines_sale ON sale_lines (sale_id);

-- ---------------------------------------------------------------
-- Money received. The khata is these rows against the sales above.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS party_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wholesaler_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    party_id UUID NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,

    -- Nullable on purpose. See the note at the top of this file.
    sale_id UUID REFERENCES sales(id) ON DELETE SET NULL,

    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    method VARCHAR(20) NOT NULL DEFAULT 'cash'
        CHECK (method IN ('cash', 'upi', 'bank', 'cheque', 'other')),
    paid_on DATE NOT NULL DEFAULT CURRENT_DATE,
    note TEXT,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_party_payments_party ON party_payments (party_id, paid_on DESC);
CREATE INDEX IF NOT EXISTS idx_party_payments_wholesaler ON party_payments (wholesaler_id, paid_on DESC);

-- ---------------------------------------------------------------
-- Sale numbering, one running series per wholesaler
-- ---------------------------------------------------------------
-- Each wholesaler counts his own sales from 1, the way a bill book does.
-- The row is locked inside the same transaction that inserts the sale, so
-- two sales recorded at the same moment cannot take the same number.
CREATE TABLE IF NOT EXISTS sale_sequences (
    wholesaler_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    last_number INTEGER NOT NULL DEFAULT 0
);

-- A number is only unique within one wholesaler's book, never globally.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_number_per_wholesaler
    ON sales (wholesaler_id, sale_number)
    WHERE sale_number IS NOT NULL;

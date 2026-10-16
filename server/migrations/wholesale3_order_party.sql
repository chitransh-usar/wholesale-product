-- ---------------------------------------------------------------
-- Orders join the customer book
-- ---------------------------------------------------------------
-- Until now a retailer who ordered through the marketplace did not exist in
-- the wholesaler's customer book. He had a buyer account and an order, and
-- separately the wholesaler had a diary of parties with balances. Same shop,
-- same person, two records, two balances.
--
-- This adds the link. An order now points at a party, the same party a hand
-- written sale points at, so one customer has one page and one balance no
-- matter which way the business came in.
--
-- Nullable on purpose. Orders placed before this ran have no party until the
-- backfill script assigns one, and an order should never fail to save because
-- the customer book could not be updated.
--
-- RUN wholesale3_parties_and_sales.sql FIRST. This file references parties.
--
-- After running, assign parties to the orders that already exist:
--     node scripts/backfill_order_parties.js
-- It is safe to run more than once.

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS party_id UUID REFERENCES parties(id) ON DELETE SET NULL;

-- The customer page asks "show me this party's orders", so the index is on
-- party_id alone rather than on the pair.
CREATE INDEX IF NOT EXISTS idx_orders_party ON orders (party_id);

COMMENT ON COLUMN orders.party_id IS
    'The wholesaler customer book entry this order belongs to. Null only for orders placed before the customer book existed.';

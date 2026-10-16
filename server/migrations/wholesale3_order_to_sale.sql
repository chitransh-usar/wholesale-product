-- ---------------------------------------------------------------
-- An accepted order becomes a sale
-- ---------------------------------------------------------------
-- Orders and sales are not the same thing and should not be one table. An
-- order is a fulfilment record: twenty two states, a driver, a tracking link,
-- stock reserved. A sale is a commercial record: what went out, for how much,
-- what is owed. Forcing them together would either burden a hand written sale
-- with twenty two states or strip an order of the ones it needs.
--
-- So they connect instead. The moment a wholesaler accepts an order, the same
-- goods are written into his sales book as a sale, and from there the invoice,
-- the statement and the credit note flows work on it for free, because they
-- all already read sales.
--
-- Nullable, because most sales are still typed in by hand and have no order
-- behind them. Unique, because one order must never produce two sales: a
-- wholesaler who accepts, cancels and accepts again would otherwise have the
-- same goods in his book twice and a customer owing double.
--
-- RUN wholesale3_parties_and_sales.sql AND wholesale3_order_party.sql FIRST.

ALTER TABLE sales
    ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES orders(id) ON DELETE SET NULL;

-- Partial, because hand written sales have no order and there are many of them.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_order
    ON sales (order_id)
    WHERE order_id IS NOT NULL;

COMMENT ON COLUMN sales.order_id IS
    'The marketplace order this sale was raised from, if it came through the shop rather than being written by hand. Unique: one order, one sale.';

-- After running, write sales for the orders already accepted:
--     node scripts/backfill_order_sales.js
-- It is safe to run more than once.

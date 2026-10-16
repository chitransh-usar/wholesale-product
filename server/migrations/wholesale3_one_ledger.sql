-- ---------------------------------------------------------------
-- One ledger: marketplace money lands in the khata
-- ---------------------------------------------------------------
-- A wholesaler's customer book answers one question: how much does this man
-- owe me. Until now it could only answer it for business he typed in by hand.
--
--   A hand written sale    ->  sales, and party_payments against it
--   A marketplace order    ->  orders.amount_paid, payment_transactions
--
-- Same customer, two pots, and the khata only knew about one of them. A
-- retailer could pay half of a large order through the shop and still show
-- his full old balance on the customer page and on the statement.
--
-- This adds the link that lets a marketplace payment sit in the same ledger
-- as a hand written one, exactly the way invoices already carry both an
-- order_id and a sale_id and the readers COALESCE the two.
--
-- RUN wholesale3_parties_and_sales.sql AND wholesale3_order_party.sql FIRST.
-- This file references parties, party_payments and orders.
--
-- After running, bring the payments that already exist into the ledger:
--     node scripts/backfill_order_payments.js
-- It is safe to run more than once.

ALTER TABLE party_payments
    -- Which order this money came in against. Null for a payment the
    -- wholesaler recorded himself, which is most of them.
    ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES orders(id) ON DELETE SET NULL,

    -- Which settled payment attempt produced this row. This is the thing that
    -- stops the same instalment being counted twice: a buyer double clicking
    -- the "I have paid" button, or the backfill being run again, both land on
    -- the same transaction id and the unique index below refuses the second.
    --
    -- INTEGER, not UUID. payment_transactions is one of the older tables and
    -- its primary key is a serial, unlike everything around it. No foreign key
    -- for the same reason a payment must survive its transaction row being
    -- tidied away: the money still changed hands.
    ADD COLUMN IF NOT EXISTS payment_transaction_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_party_payments_order
    ON party_payments (order_id);

-- Partial, because a payment the wholesaler wrote down by hand has no
-- transaction behind it and there can be any number of those.
CREATE UNIQUE INDEX IF NOT EXISTS idx_party_payments_transaction
    ON party_payments (payment_transaction_id)
    WHERE payment_transaction_id IS NOT NULL;

-- The audit found this missing. Every customer page and every statement asks
-- for the payments against a sale, and without it that is a sequential scan
-- of the whole payments table per customer.
CREATE INDEX IF NOT EXISTS idx_party_payments_sale
    ON party_payments (sale_id);

COMMENT ON COLUMN party_payments.order_id IS
    'The marketplace order this payment settled, if it came in through the shop rather than by hand.';
COMMENT ON COLUMN party_payments.payment_transaction_id IS
    'The settled payment_transactions row behind this money. Unique, so one payment cannot enter the ledger twice.';

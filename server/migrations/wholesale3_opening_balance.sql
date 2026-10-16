-- Wholesale 3.0: what was already owed on the day he started using this.
--
-- Taken from Busy's Account master, which carries `Op. Bal` with a Dr/Cr flag
-- and a previous year balance beside it. It is the single thing that stops a
-- real wholesaler moving onto this product.
--
-- Until now every customer's khata starts at zero. A man who has been trading
-- for twenty years opens his customer book on day one and it tells him nobody
-- owes him anything, which is not a gap in a report, it is the product being
-- wrong about the only number he cares about. The alternatives he is left with
-- are entering a fake sale for the old balance, which puts goods in his books
-- that he never sold and tax on a bill he never raised, or not using it.
--
-- SIGNED, not a separate Dr/Cr column. Busy needs the flag because it is a
-- double entry system where the same field serves both sides of a ledger. Here
-- the sign carries it: POSITIVE means he owed you on that date, which is the
-- ordinary case, and NEGATIVE means you were holding his money. One column
-- cannot disagree with itself the way a number and a flag can.
--
-- The DATE matters as much as the figure. A balance of 2 lakh means nothing
-- without "as at", and the statement has to draw a line at that date and start
-- from it, or the opening figure and the transactions after it double count
-- the same goods.
--
-- Run by hand against Neon, like every other file in this directory.
-- Safe to run more than once.

ALTER TABLE parties
    ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    -- Null and a zero balance are the same thing to every reader, so this is
    -- only filled in when there is actually an opening figure.
    ADD COLUMN IF NOT EXISTS opening_balance_on DATE;

COMMENT ON COLUMN parties.opening_balance IS
    'What this customer owed on opening_balance_on, before anything in this product. Positive: he owes you. Negative: you are holding his money.';
COMMENT ON COLUMN parties.opening_balance_on IS
    'The date the opening balance is as at. The statement starts here.';

-- The same on the purchase side, with the sign meaning the same thing it means
-- everywhere else on that side: POSITIVE is money YOU owe the supplier, which
-- is how supplierBalance already reads a balance.
--
-- `suppliers` arrives with wholesale3_purchases.sql and the runner applies
-- these files in alphabetical order, which puts this one FIRST. So on a fresh
-- database this ALTER fails on pass 1, and the runner retries it on pass 2
-- once purchases has created the table. That retry is what run_migrations.js
-- is built around: a file that is not ready yet fails, and a file that fails
-- for a real reason fails on every pass and is reported at the end.
--
-- It used to be a DO block that asked `to_regclass` first and raised a NOTICE
-- when the table was missing. That turned "not ready yet" into SUCCESS, so the
-- runner marked the file applied on pass 1 and never came back to it, and a
-- database built from these migrations had no suppliers.opening_balance at
-- all. Adding a supplier answered 500 on a schema the runner called complete.
-- ALTER TABLE IF EXISTS has the same fault for the same reason. A guard that
-- turns a missing prerequisite into a quiet success defeats the retry.
ALTER TABLE suppliers
    ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS opening_balance_on DATE;

COMMENT ON COLUMN suppliers.opening_balance IS
    'What you owed this supplier on opening_balance_on, before anything in this product. Positive: you owe him. Negative: he is holding your money.';

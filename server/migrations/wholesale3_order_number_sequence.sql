-- Order numbers that cannot collide.
--
-- The old generate_order_number() built ORD, then the timestamp to the
-- second, then four random digits, and looped until the number was unused.
-- Two things are wrong with that, and the second one is the dangerous one.
--
-- There are only 10,000 numbers per second. Inside a transaction
-- CURRENT_TIMESTAMP never advances, so a bulk insert of more than 10,000
-- orders can never find a free number and the loop spins forever. Measured:
-- 11,000 rows in one statement wrote zero and had to be killed.
--
-- Worse in ordinary use, the WHILE cannot see rows other sessions have
-- inserted but not committed. Two checkouts landing in the same second can
-- therefore pick the same number, both believe it is free, and the unique
-- index rejects the second one. The buyer sees a 500 on a payment page. With
-- a hundred orders inside one second that is roughly a two in five chance of
-- at least one failing, which is a festival sale rather than a normal Tuesday,
-- but it fails silently until it does not.
--
-- A sequence has neither problem. It is atomic, it is visible across sessions
-- before commit, and it never repeats.
--
-- The shape becomes ORD + YYYYMMDD + six digits, so ORD20260903000042.
-- Old numbers are ORD followed by eighteen digits and new ones by fourteen,
-- so the two shapes cannot collide with each other and nothing has to be
-- rewritten. Existing orders keep the numbers already printed on their bills.
--
-- One trade off, stated plainly: a sequence is guessable, so a buyer who
-- places two orders a week apart can tell roughly how many orders the whole
-- site took in between. The date prefix leaks nothing extra. That is the
-- normal bargain for sequential document numbers and it is the same bargain
-- invoice numbering already makes, which the GST rules require anyway.
--
-- Safe to run twice.

CREATE SEQUENCE IF NOT EXISTS order_number_seq;

-- The counter is never reset, not even daily, so the six digits are unique on
-- their own and the date in front is only there to make a number readable.
-- Resetting per day would need a lock held across the whole day's checkouts,
-- which is the thing this migration exists to get rid of.
--
-- Past a million orders the tail simply grows to seven digits. It stays
-- unique. It is only the padding that assumes six.
--
-- It starts at 1 even on a database full of orders, and that is safe: every
-- number issued by the old function is ORD followed by eighteen digits, and
-- every number issued by the new one is ORD followed by fourteen. Different
-- lengths, so a new number cannot land on an old one however low the counter
-- starts.
--
-- There is deliberately no "resume from the highest existing number" step
-- here. Reading a starting point back out of mixed old and new shapes is easy
-- to get subtly wrong, and getting it wrong hands out a duplicate, which is
-- the exact failure this file exists to remove. IF NOT EXISTS means the
-- counter survives this file being run again. If anyone ever drops it by
-- hand, setval it by hand too.

CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS VARCHAR(50) AS $$
BEGIN
  -- No loop and no lookup. nextval is atomic, so there is nothing to retry
  -- and nothing another session can be holding uncommitted.
  RETURN 'ORD'
      || TO_CHAR(CURRENT_DATE, 'YYYYMMDD')
      || LPAD(nextval('order_number_seq')::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  RAISE NOTICE 'Order numbers now come from a sequence. Numbers already issued are unchanged.';
END $$;

-- ---------------------------------------------------------------
-- Remove the credit figures nothing keeps up to date
-- ---------------------------------------------------------------
-- parties carries seven credit columns that no code in this repository reads
-- or writes, and that no migration here created. Five of them are derived
-- figures, so they sit at their defaults forever while the real numbers move:
--
--     outstanding_balance   0.00 next to a customer who really owes 250
--     available_credit      0.00
--     credit_status         'inactive'
--     overdue_amount        0.00
--     last_payment_date     null
--
-- A number that is wrong and looks right is worse than no number. The
-- outstanding balance is computed from sales, orders and party_payments every
-- time it is asked for, which is the only way it can be right, and one day
-- somebody would have joined this column instead and quietly shipped a khata
-- that reads zero.
--
-- credit_limit and credit_period_days are kept. Those are not derived from
-- anything: they are what the wholesaler decides to allow a customer, so they
-- cannot go stale, and they are where "let this retailer pay later" starts.
--
-- This will not destroy anything it does not recognise. If any row holds a
-- value other than the default, the columns are left alone and the migration
-- says so instead, because that would mean something outside this repository
-- is writing them.

DO $$
DECLARE
    present INTEGER;
    stray   INTEGER;
BEGIN
    SELECT count(*) INTO present
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'parties'
       AND column_name IN ('outstanding_balance', 'available_credit',
                           'credit_status', 'overdue_amount', 'last_payment_date');

    IF present = 0 THEN
        RAISE NOTICE 'Stale credit columns already removed. Nothing to do.';
        RETURN;
    END IF;

    IF present < 5 THEN
        RAISE NOTICE 'Only % of the 5 stale credit columns are present. Leaving them alone: look before dropping the rest by hand.', present;
        RETURN;
    END IF;

    -- Dynamic, so this file still parses on a database where the columns have
    -- already gone.
    EXECUTE $check$
        SELECT count(*) FROM parties
         WHERE outstanding_balance <> 0
            OR available_credit <> 0
            OR overdue_amount <> 0
            OR credit_status <> 'inactive'
            OR last_payment_date IS NOT NULL
    $check$ INTO stray;

    IF stray > 0 THEN
        RAISE NOTICE 'Kept the stale credit columns: % row(s) hold something other than the default, so something is writing them. Look before dropping.', stray;
        RETURN;
    END IF;

    ALTER TABLE parties
        DROP COLUMN IF EXISTS outstanding_balance,
        DROP COLUMN IF EXISTS available_credit,
        DROP COLUMN IF EXISTS credit_status,
        DROP COLUMN IF EXISTS overdue_amount,
        DROP COLUMN IF EXISTS last_payment_date;

    RAISE NOTICE 'Removed 5 stale credit columns from parties. The balance is computed, not stored.';
END $$;

COMMENT ON COLUMN parties.credit_limit IS
    'How much this customer is allowed to owe. Set by the wholesaler, not derived. Nothing enforces it yet.';
COMMENT ON COLUMN parties.credit_period_days IS
    'How long this customer has to pay. Set by the wholesaler, not derived. Nothing enforces it yet.';

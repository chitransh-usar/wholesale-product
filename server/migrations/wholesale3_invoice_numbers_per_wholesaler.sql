-- ---------------------------------------------------------------
-- Every wholesaler gets his own run of invoice numbers
-- ---------------------------------------------------------------
-- invoice_sequences was keyed on the year alone, so one counter served the
-- whole platform. Ram raised his first bill and got INV-2026-000001, Suresh
-- raised the next one and got 000002, and Ram's second bill was 000003.
--
-- Each wholesaler therefore saw gaps in his own book, and the size of the gap
-- told him how much business everyone else had done that week.
--
-- Rule 46(b) of the CGST Rules wants a consecutive serial number, unique
-- within a financial year, for one supplier. Gaps are exactly what an officer
-- asks about, and "the software gave that number to another firm" is not an
-- answer a wholesaler can give about his own books.
--
-- Two things have to change together. The counter becomes per wholesaler, and
-- the global unique index on invoices.invoice_number has to go, because once
-- two wholesalers both count from 1 with the default INV prefix they will both
-- want INV-2026-000001. Uniqueness moves to where GST actually requires it:
-- one number, once, per supplier.
--
-- Existing counters are carried over rather than reset. Each wholesaler starts
-- from the highest number he has really used, so no new bill can collide with
-- one he has already given a customer.
--
-- RUN enterprise_invoice_module.sql FIRST. This file reshapes the table it
-- creates.

-- ---------------------------------------------------------------
-- 1. The counter becomes per wholesaler
-- ---------------------------------------------------------------
ALTER TABLE invoice_sequences
    ADD COLUMN IF NOT EXISTS wholesaler_id UUID REFERENCES users(id) ON DELETE CASCADE;

DO $$
BEGIN
    -- The old primary key was on year alone. It has to go before rows can be
    -- split per wholesaler.
    IF EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'invoice_sequences'::regclass
           AND contype IN ('p', 'u')
           AND pg_get_constraintdef(oid) = 'PRIMARY KEY (year)'
    ) THEN
        ALTER TABLE invoice_sequences DROP CONSTRAINT invoice_sequences_pkey;
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'invoice_sequences'::regclass
           AND contype = 'u'
           AND pg_get_constraintdef(oid) = 'UNIQUE (year)'
    ) THEN
        ALTER TABLE invoice_sequences DROP CONSTRAINT invoice_sequences_year_key;
    END IF;
END $$;

-- ---------------------------------------------------------------
-- 2. Seed each wholesaler from what he has actually used
-- ---------------------------------------------------------------
-- Read off the invoices themselves rather than off the old shared counter.
-- The number is the last dash separated piece of PREFIX-YYYY-NNNNNN, and only
-- invoices whose number really has that shape are counted, so a hand entered
-- number cannot push a counter somewhere strange.
INSERT INTO invoice_sequences (wholesaler_id, year, last_number)
SELECT i.supplier_id,
       EXTRACT(YEAR FROM i.issue_date)::int AS year,
       MAX((regexp_replace(i.invoice_number, '^.*-', ''))::int) AS last_number
  FROM invoices i
 WHERE i.supplier_id IS NOT NULL
   AND i.invoice_number ~ '^[A-Za-z]+-[0-9]{4}-[0-9]+$'
 GROUP BY i.supplier_id, EXTRACT(YEAR FROM i.issue_date)::int
    ON CONFLICT DO NOTHING;

-- The old platform wide rows have no owner and nothing can read them now.
DELETE FROM invoice_sequences WHERE wholesaler_id IS NULL;

ALTER TABLE invoice_sequences
    ALTER COLUMN wholesaler_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_sequences_owner_year
    ON invoice_sequences (wholesaler_id, year);

-- ---------------------------------------------------------------
-- 3. Uniqueness moves to where GST wants it
-- ---------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'invoices'::regclass
           AND conname = 'invoices_invoice_number_key'
    ) THEN
        ALTER TABLE invoices DROP CONSTRAINT invoices_invoice_number_key;
        RAISE NOTICE 'Invoice numbers are now unique per wholesaler rather than across the whole platform.';
    END IF;
END $$;

-- One number, once, per supplier. This is the rule that actually matters, and
-- it still catches the thing the old constraint was there to catch: the same
-- wholesaler issuing one number twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_number_per_supplier
    ON invoices (supplier_id, invoice_number);

COMMENT ON TABLE invoice_sequences IS
    'One running invoice number per wholesaler per year. Shared across the platform until wholesale3_invoice_numbers_per_wholesaler.sql split it.';

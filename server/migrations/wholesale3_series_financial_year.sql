-- Sale and delivery challan numbers restart each financial year, like the
-- invoice already does.
--
-- WHY. The three documents were numbered three different ways:
--
--   invoice   INV-000001   counter keyed on wholesaler AND financial year
--   sale      S-0001       counter keyed on wholesaler only, never restarts
--   challan   DC-0001      counter keyed on wholesaler only, never restarts
--
-- so a wholesaler saw three shapes with three padding widths, none of them
-- saying which year the document belonged to. Asked about on 12 Sept, in his
-- words: "invoice dc, sales just starts with random 001 and then 002, so
-- weird".
--
-- The invoice now reads INV/1/26-27, which is the shape every Indian
-- accounting package writes and which Busy's own sample uses. This gives the
-- other two the same treatment: S/1/26-27 and DC/1/26-27, restarting each
-- 1 April.
--
-- Unlike the invoice series this is NOT a legal requirement. Rule 46(b)
-- constrains the tax invoice. A sale is the wholesaler's own record and a
-- delivery challan under this product's rule is explicitly not a tax document.
-- The reason to do it is that three documents describing the same goods should
-- not be numbered three different ways.
--
-- WHAT HAPPENS TO NUMBERS ALREADY ISSUED. Nothing. Rows already in `sales` and
-- `delivery_challans` keep the number printed on them. A document that has
-- gone out cannot be renumbered. Only the counter changes, and existing
-- counters are carried into the CURRENT financial year rather than reset, so
-- nobody's next sale collides with one he issued last week.
--
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- Sales
-- ---------------------------------------------------------------------------

ALTER TABLE sale_sequences ADD COLUMN IF NOT EXISTS financial_year VARCHAR(7);

-- Existing rows belong to the year they are being used in, which is now.
-- Computed rather than typed, so running this in March and in April both do
-- the right thing: the Indian financial year starts on 1 April.
UPDATE sale_sequences
   SET financial_year = to_char(CURRENT_DATE, 'YY') ||
                        CASE WHEN EXTRACT(MONTH FROM CURRENT_DATE) >= 4
                             THEN '-' || to_char(CURRENT_DATE + INTERVAL '1 year', 'YY')
                             ELSE '' END
 WHERE financial_year IS NULL;

-- A row written before April carries the PREVIOUS year as its start.
UPDATE sale_sequences
   SET financial_year = to_char(CURRENT_DATE - INTERVAL '1 year', 'YY') || '-' ||
                        to_char(CURRENT_DATE, 'YY')
 WHERE financial_year NOT LIKE '%-%';

ALTER TABLE sale_sequences ALTER COLUMN financial_year SET NOT NULL;

DO $$
BEGIN
  -- The old key was the wholesaler alone. It has to become the pair, or the
  -- first sale of the new year would collide with the counter row of the old.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'sale_sequences'::regclass AND contype = 'p'
       AND pg_get_constraintdef(oid) = 'PRIMARY KEY (wholesaler_id)'
  ) THEN
    ALTER TABLE sale_sequences DROP CONSTRAINT sale_sequences_pkey;
    ALTER TABLE sale_sequences ADD PRIMARY KEY (wholesaler_id, financial_year);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Delivery challans
-- ---------------------------------------------------------------------------

ALTER TABLE delivery_challan_sequences ADD COLUMN IF NOT EXISTS financial_year VARCHAR(7);

UPDATE delivery_challan_sequences
   SET financial_year = to_char(CURRENT_DATE, 'YY') ||
                        CASE WHEN EXTRACT(MONTH FROM CURRENT_DATE) >= 4
                             THEN '-' || to_char(CURRENT_DATE + INTERVAL '1 year', 'YY')
                             ELSE '' END
 WHERE financial_year IS NULL;

UPDATE delivery_challan_sequences
   SET financial_year = to_char(CURRENT_DATE - INTERVAL '1 year', 'YY') || '-' ||
                        to_char(CURRENT_DATE, 'YY')
 WHERE financial_year NOT LIKE '%-%';

ALTER TABLE delivery_challan_sequences ALTER COLUMN financial_year SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'delivery_challan_sequences'::regclass AND contype = 'p'
       AND pg_get_constraintdef(oid) = 'PRIMARY KEY (wholesaler_id)'
  ) THEN
    ALTER TABLE delivery_challan_sequences DROP CONSTRAINT delivery_challan_sequences_pkey;
    ALTER TABLE delivery_challan_sequences ADD PRIMARY KEY (wholesaler_id, financial_year);
  END IF;
END $$;

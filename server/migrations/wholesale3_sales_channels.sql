-- A separate run of invoice numbers per sales channel.
--
-- Phase 7 of ROADMAP.md.
--
-- WHY. Rule 46(b) wants an invoice number consecutive WITHIN ITS SERIES and
-- unique within the financial year. A wholesaler selling over the counter, on
-- this marketplace, on Flipkart and on Amazon is keeping four books, and each
-- marketplace reconciles against its own. One shared counter means Flipkart's
-- run reads 4, 9, 11, with the gaps filled by counter sales, and their
-- settlement report cannot be matched against it.
--
-- WHAT THIS IS NOT. Nothing here imports anything from Flipkart or Amazon. It
-- records which book a sale belongs to, because somebody chose it on a form.
-- Pulling orders out of those marketplaces needs a developer account and a
-- seller authorisation, and is its own piece of work.
--
-- NOTHING RENUMBERS. Existing invoices keep their numbers, and the counter
-- channel keeps the wholesaler's own configured prefix, so their existing run
-- carries on exactly as it was. The three new channels start their own run at
-- 1, which is what a new series is allowed to do. Renumbering a bill already
-- handed over would break the customer's GSTR-2B against ours, and the
-- instrument for correcting an issued invoice is a credit note.
--
-- Run by hand against Neon, like every other file in this directory.

-- The channel this sale belongs to. Defaults to counter, which is what every
-- existing sale is: recorded by the wholesaler.
ALTER TABLE IF EXISTS sales
    ADD COLUMN IF NOT EXISTS channel VARCHAR(16) NOT NULL DEFAULT 'counter';

ALTER TABLE IF EXISTS sales
    DROP CONSTRAINT IF EXISTS sales_channel_check;

ALTER TABLE IF EXISTS sales
    ADD CONSTRAINT sales_channel_check
    CHECK (channel IN ('counter', 'shop', 'flipkart', 'amazon'));

-- And on the bill, so a number can always be explained. Nullable, because an
-- invoice raised before this migration drew on the single old counter and
-- saying it was any particular channel would be inventing the answer.
ALTER TABLE IF EXISTS invoices
    ADD COLUMN IF NOT EXISTS channel VARCHAR(16);

ALTER TABLE IF EXISTS invoices
    DROP CONSTRAINT IF EXISTS invoices_channel_check;

ALTER TABLE IF EXISTS invoices
    ADD CONSTRAINT invoices_channel_check
    CHECK (channel IS NULL OR channel IN ('counter', 'shop', 'flipkart', 'amazon'));

-- The counter gains a series key. Existing rows become the counter channel's
-- run, which is what they have been all along, so no number is disturbed.
ALTER TABLE IF EXISTS invoice_sequences
    ADD COLUMN IF NOT EXISTS series VARCHAR(16) NOT NULL DEFAULT 'counter';

-- Uniqueness moves to where GST wants it: one run per wholesaler, per series,
-- per year. The old index is dropped first, and it is an index rather than a
-- constraint, so no DO block is needed to find out its name.
DROP INDEX IF EXISTS idx_invoice_sequences_owner_year;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_sequences_owner_series_year
    ON invoice_sequences (wholesaler_id, series, year);

COMMENT ON COLUMN invoice_sequences.series IS
    'Which sales channel this run belongs to. Existing rows are the counter run, unchanged.';

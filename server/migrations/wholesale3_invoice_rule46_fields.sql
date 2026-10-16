-- Wholesale 3.0: the Rule 46 particulars the invoice was computing and
-- then throwing away.
--
-- Rule 46 of the CGST Rules lists what a tax invoice must carry. Six of them
-- were missing from ours. Three needed no new data at all, only printing:
-- the total quantity, the supplier's PAN (derivable from his GSTIN), and the
-- amount in words. The HSN-wise tax summary is built from the lines. That
-- left two that genuinely had nowhere to live, and they are here.
--
--   place_of_supply   The state the supply is made to, with its code, e.g.
--                     "Haryana (06)". Required, and it is the field that
--                     explains why the invoice charged IGST instead of CGST
--                     plus SGST. gstService has worked this out since 10
--                     Sept and the answer went nowhere.
--
--   reverse_charge    Whether tax is payable by the recipient instead of the
--                     supplier. A required field even when the answer is no,
--                     which it is for almost every wholesale sale. Stored so
--                     the document can say N rather than stay silent.
--
-- round_off is here for the same reason: gstService returns it, the invoice
-- never stored it, and the printed total could therefore differ from
-- taxable + tax by a paisa with nothing on the page explaining the
-- difference. Busy prints it as its own line, "Less: Rounded Off".
--
-- Nothing here changes an existing invoice. The columns are nullable and the
-- PDF falls back to what it printed before when they are empty, so old
-- invoices keep reprinting exactly as they were issued. That matters: a tax
-- document must not change after it has been handed over.
--
-- Run by hand against Neon, like every other file in this directory.

ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS place_of_supply VARCHAR(100),
    ADD COLUMN IF NOT EXISTS place_of_supply_code VARCHAR(2),
    ADD COLUMN IF NOT EXISTS reverse_charge BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS round_off NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    -- The supplier's own state, so the document can show both sides of the
    -- comparison that decided the tax.
    ADD COLUMN IF NOT EXISTS supplier_state VARCHAR(100);

COMMENT ON COLUMN invoices.place_of_supply IS
    'The state the supply is made to, frozen at issue. Rule 46(n).';
COMMENT ON COLUMN invoices.place_of_supply_code IS
    'Its two digit GST state code, e.g. 06 for Haryana.';
COMMENT ON COLUMN invoices.reverse_charge IS
    'Rule 46(p). False for ordinary wholesale; the field is required either way.';
COMMENT ON COLUMN invoices.round_off IS
    'The rounding applied to reach grand_total, so the arithmetic on the page adds up.';

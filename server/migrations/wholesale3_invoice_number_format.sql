-- Wholesale 3.0: the invoice number format becomes a setting.
--
-- Rule 46(b) of the CGST Rules wants a serial that is consecutive per
-- supplier, unique for the FINANCIAL year, and at most sixteen characters
-- made of letters, digits, hyphen and slash.
--
-- Two of those three were broken before this:
--
--   the year   the counter keyed on new Date().getFullYear(), so it rolled
--              over on 1 January. An invoice raised in January 2027 would
--              reuse a number already issued in FY 2026-27, a duplicate
--              serial inside one return period. The code fix keys the counter
--              on the financial year instead. Nothing needs migrating,
--              because for any date from April to December the two keys are
--              the same number and this is being run in September.
--
--   the length the prefix was clipped at 10 characters and the composed
--              number was clipped at none, so a long prefix produced a 22
--              character serial. invoice_number is varchar(50), so the
--              database took it happily.
--
-- These columns let a wholesaler shape his own number the way the Busy
-- voucher numbering dialog does, which is what his stationery and his
-- accountant already expect:
--
--   prefix  OM/        number  2        suffix  /26-27      -> OM/2/26-27
--
-- {FY} anywhere in the prefix or the suffix is replaced with the financial
-- year, so a number can carry it without the wholesaler editing his settings
-- every April.
--
-- Defaults reproduce exactly what the code did before, so running this
-- changes nobody's numbering until they open the screen and change it.
--
-- Run by hand against Neon, like every other file in this directory.

ALTER TABLE invoice_settings
    -- Goes after the number. Usually the financial year.
    ADD COLUMN IF NOT EXISTS number_suffix VARCHAR(16) NOT NULL DEFAULT '',
    -- Busy calls this "Fix Length of Numeric Part". 0 means do not pad.
    ADD COLUMN IF NOT EXISTS number_pad_to INTEGER NOT NULL DEFAULT 6;

-- The prefix column is varchar(10), which was the old clip point. A number
-- like "OM/{FY}/" needs more room than that, and the 16 character rule is
-- what actually limits it now, checked in code against the whole composed
-- number rather than against one part of it.
ALTER TABLE invoice_settings
    ALTER COLUMN prefix TYPE VARCHAR(16);

ALTER TABLE invoice_settings
    DROP CONSTRAINT IF EXISTS chk_invoice_number_pad;
ALTER TABLE invoice_settings
    ADD CONSTRAINT chk_invoice_number_pad
    CHECK (number_pad_to >= 0 AND number_pad_to <= 9);

COMMENT ON COLUMN invoice_settings.number_suffix IS
    'Appended after the sequence. {FY} is replaced with the financial year, e.g. 26-27.';
COMMENT ON COLUMN invoice_settings.number_pad_to IS
    'Zero-pad the sequence to this many digits. 0 means no padding. Busy calls it Fix Length of Numeric Part.';

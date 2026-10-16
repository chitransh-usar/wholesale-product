-- Wholesale 3.0: the platform's own settings, the last part of the master area.
--
-- The four master LISTS landed on 12 Sept: states, units, tax rates, HSN codes.
-- This is the other half of what a master area is for, the settings that decide
-- how every wholesaler's screens and documents are formatted.
--
-- WHY THESE ARE PLATFORM LEVEL AND NOT PER WHOLESALER. Every one of them is a
-- convention rather than a preference. Indian digit grouping is not something
-- one wholesaler should be able to turn off, because 12,00,000 and 1,200,000
-- are the same number written for two different readerships and his customers
-- are all in the first. The same goes for the rupee symbol, for how many
-- decimals a tax figure carries, and for the date order.
--
-- What is NOT here, and stays with each wholesaler on his own Invoice defaults
-- screen: invoice prefix, suffix and padding, payment due days, default GST
-- rate, notes, terms, bank details, GSTIN. If any of those lived here, one
-- wholesaler changing his prefix would change everybody's.
--
-- ONE EXCEPTION, and it is worth the column: default_hsn_min_digits. The
-- minimum number of HSN digits a bill must carry follows the WHOLESALER's
-- turnover, six above 5 crore and four below, so it cannot be one platform
-- answer. What is stored here is the DEFAULT a new wholesaler starts from.
--
-- Run by hand against Neon, like every other file in this directory.
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS master_settings (
    -- Exactly one row, ever. A settings table that can hold two rows is a
    -- settings table that will one day hold two and read the wrong one.
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),

    -- ---------------------------------------------------------------
    -- Money
    -- ---------------------------------------------------------------
    -- How a figure reads on a SCREEN. Zero by default: a wholesaler glancing
    -- at what he is owed wants 27,200, not 27,200.00.
    amount_decimals SMALLINT NOT NULL DEFAULT 0
        CHECK (amount_decimals BETWEEN 0 AND 4),

    -- How a figure reads on a DOCUMENT, where it has to foot exactly. Two,
    -- because an invoice line that does not add up to the total is a query
    -- from the customer's accountant.
    --
    -- Separate from the screen setting on purpose. They were the same number
    -- in eighteen different copies of a format helper, which is why the site
    -- showed 12,000 and the invoice showed 12000.00 for the same amount.
    document_decimals SMALLINT NOT NULL DEFAULT 2
        CHECK (document_decimals BETWEEN 0 AND 4),

    -- 12,00,000 against 1,200,000. A trader reads lakhs and crores by where
    -- the commas fall, and western grouping makes him count digits.
    digit_grouping VARCHAR(10) NOT NULL DEFAULT 'indian'
        CHECK (digit_grouping IN ('indian', 'western')),

    currency_symbol VARCHAR(8) NOT NULL DEFAULT U&'\20B9',

    -- For the amount in words on a tax invoice: "Rupees Twelve Thousand and
    -- Fifty Paise Only". Two columns because the sub unit is not derivable.
    currency_name VARCHAR(40) NOT NULL DEFAULT 'Rupees',
    currency_subunit_name VARCHAR(40) NOT NULL DEFAULT 'Paise',

    -- ---------------------------------------------------------------
    -- Tax
    -- ---------------------------------------------------------------
    -- Kept apart from the money decimals, the way Busy keeps them apart, and
    -- for a real reason: 0.25% is a genuine GST slab, so a tax rate needs two
    -- decimals even where an amount needs none.
    tax_rate_decimals SMALLINT NOT NULL DEFAULT 2
        CHECK (tax_rate_decimals BETWEEN 0 AND 4),

    -- The default for a NEW wholesaler. His own turnover decides his, so this
    -- is a starting point rather than a rule. See the note at the top.
    default_hsn_min_digits SMALLINT NOT NULL DEFAULT 4
        CHECK (default_hsn_min_digits IN (4, 6, 8)),

    -- ---------------------------------------------------------------
    -- Dates
    -- ---------------------------------------------------------------
    -- Named rather than a strftime pattern, so the client does not have to
    -- carry a date formatting language and an admin cannot type one that
    -- throws on render.
    date_format VARCHAR(20) NOT NULL DEFAULT 'dd-mmm-yyyy'
        CHECK (date_format IN ('dd-mmm-yyyy', 'dd/mm/yyyy', 'yyyy-mm-dd')),

    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- The one row. Every column has a default, so this inserts the shipped
-- convention and running the file again changes nothing.
INSERT INTO master_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE master_settings IS
    'Platform wide formatting conventions. Exactly one row. Per wholesaler settings live in invoice_settings.';
COMMENT ON COLUMN master_settings.amount_decimals IS
    'Decimals on a screen. Document totals use document_decimals instead.';
COMMENT ON COLUMN master_settings.default_hsn_min_digits IS
    'Starting point for a new wholesaler. His own turnover decides his: six above 5 crore, four below.';

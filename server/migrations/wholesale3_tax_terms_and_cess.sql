-- Named tax terms, and cess as a levy of its own.
--
-- Phase 6 of ROADMAP.md. Two things, and they belong in one file because the
-- term is what carries the cess rate.
--
-- WHAT A TAX TERM IS
--
-- A named combination a line can be billed under, instead of typing a number.
-- Entering the IGST rate derives the rest: CGST and SGST are half of it each,
-- which is what gstService has always done for a sale inside one state. The
-- term names that combination so it can be picked by name.
--
-- WHAT CESS IS, AND WHAT IT IS NOT
--
-- An additional levy on particular goods, charged on the same taxable value as
-- GST. It is NOT a share of the GST. Eighteen per cent GST plus twelve per
-- cent cess is thirty per cent of the taxable value, not eighteen split three
-- ways. That is the single most important sentence in this file.
--
-- THE TWELVE PER CENT IS A TEST DEFAULT AND MUST NOT SHIP
--
-- Real cess is commodity specific. Twelve per cent on some goods, sixty on
-- others, a flat four hundred rupees a tonne on coal, and nothing at all on
-- the great majority of what a cloth wholesaler sells. A blanket twelve per
-- cent on a live bill is a wrong number on a legal document, which is the one
-- thing this codebase has a standing rule against.
--
-- It is seeded on here because it was asked for so the arithmetic can be
-- tested end to end. Before this goes anywhere near a real customer, set the
-- cess on GST18 back to zero on the Administration screen, or delete the
-- GST18_CESS12 term.
--
-- Run by hand against Neon, like every other file in this directory.

CREATE TABLE IF NOT EXISTS master_tax_terms (
    code        VARCHAR(24) PRIMARY KEY,
    label       VARCHAR(64) NOT NULL,

    -- The full rate. CGST and SGST are derived as half each for a sale inside
    -- one state, so they are not stored: two stored halves are two things that
    -- can disagree with the whole.
    igst_percent  NUMERIC(5, 2) NOT NULL CHECK (igst_percent >= 0 AND igst_percent <= 100),

    -- On top of the GST, on the same taxable value. Zero for almost everything.
    cess_percent  NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (cess_percent >= 0 AND cess_percent <= 500),

    active      BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The slabs actually in force, as terms. Same list as master_tax_rates, which
-- stays: that one is the bare rate a line can carry, this one is the named
-- combination including any cess.
INSERT INTO master_tax_terms (code, label, igst_percent, cess_percent, sort_order) VALUES
  ('NIL',     'Nil rated',        0.00,  0.00, 10),
  ('GST0_25', 'GST 0.25%',        0.25,  0.00, 20),
  ('GST3',    'GST 3%',           3.00,  0.00, 30),
  ('GST5',    'GST 5%',           5.00,  0.00, 40),
  ('GST12',   'GST 12%',         12.00,  0.00, 50),
  ('GST18',   'GST 18%',         18.00,  0.00, 60),
  ('GST28',   'GST 28%',         28.00,  0.00, 70),
  ('GST28_CESS12', 'GST 28% plus cess 12%', 28.00, 12.00, 80)
ON CONFLICT (code) DO NOTHING;

-- The cess rate a sale line was billed at, snapshot onto the line like the GST
-- rate beside it, so changing a term next year cannot restate a sale from this
-- one.
ALTER TABLE IF EXISTS sale_lines
    ADD COLUMN IF NOT EXISTS cess_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS cess_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;

-- The same on a purchase, so input cess is recorded rather than folded into
-- the GST figure and lost.
ALTER TABLE IF EXISTS purchase_lines
    ADD COLUMN IF NOT EXISTS cess_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS cess_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;

-- The cess total on a sale, beside the GST total it sits next to. invoices
-- already has total_cess from wholesale3_invoice_document_block.sql.
ALTER TABLE IF EXISTS sales
    ADD COLUMN IF NOT EXISTS total_cess NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS purchases
    ADD COLUMN IF NOT EXISTS total_cess NUMERIC(12, 2) NOT NULL DEFAULT 0;

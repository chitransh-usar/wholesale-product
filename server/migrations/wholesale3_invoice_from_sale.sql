-- Wholesale 3.0: let an invoice come from a recorded sale.
--
-- The invoice module already handles numbering, GST, PDF and payments, but
-- every row is keyed to a marketplace order. Recording a sale in 3.0 produced
-- no bill at all. Rather than rewrite that module, this widens it: an invoice
-- may point at an order (old marketplace rows) or at a sale (everything from
-- now on). Existing invoices are untouched.
--
-- Two things here are not just plumbing.
--
-- 1. A party does not need a user account, so invoices.buyer_id, which
--    references users(id), cannot identify the recipient of a sale invoice.
--    party_id does that instead.
--N
-- 2. The recipient's details are SNAPSHOT onto the invoice rather than read
--    back through a join. A tax document should say who it was issued to at
--    the time it was issued. Editing a customer's GSTIN today must not
--    silently rewrite a bill raised last year. The columns are named
--    recipient_* rather than buyer_* so they cannot collide with the
--    buyer_name and buyer_gstin aliases the read queries already produce
--    from SELECT i.* plus a join.
--
-- RUN wholesale3_parties_and_sales.sql FIRST. The columns added here point at
-- sales and parties. Run out of order it stops on "relation sales does not
-- exist". Every statement is IF NOT EXISTS, so run it again afterwards and it
-- completes.
--
-- Run by hand against Neon, like every other file in this directory.

ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS sale_id UUID REFERENCES sales(id) ON DELETE SET NULL;

ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS party_id UUID REFERENCES parties(id) ON DELETE SET NULL;

ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS recipient_name VARCHAR(255);
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS recipient_gstin VARCHAR(20);
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS recipient_city VARCHAR(100);
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS recipient_address TEXT;
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS recipient_phone VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_invoices_party ON invoices (party_id);

-- One bill per sale. Raising a second would give the same goods two invoice
-- numbers, which is the sort of thing that is very hard to unpick later.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_sale
    ON invoices (sale_id)
    WHERE sale_id IS NOT NULL;

-- HSN is snapshot onto the line for the same reason the item name and rate
-- already are: editing the rate list must not change a bill already raised.
-- Until this is populated the invoice module stamps a hardcoded 8504, which
-- is the HSN for electrical transformers and wrong for essentially everyone.
ALTER TABLE sale_lines
    ADD COLUMN IF NOT EXISTS hsn_code VARCHAR(20);

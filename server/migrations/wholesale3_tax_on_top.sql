-- GST is added on top of the quoted rate, not backed out of it.
--
-- Until now a sale of 20 metres at 142 stored a total of 2840 and the bill
-- backed the tax out of that figure, so the customer owed 2840 and the
-- invoice said 2840. That was a guess, written down as a guess in
-- saleInvoiceService, and the answer has now come back from a real
-- wholesaler: he quotes 142 a metre PLUS GST. The shop pays 2840 plus tax.
--
-- Which means the tax cannot live only on the invoice. The customer's khata
-- is what he owes, he owes the tax too, and a balance of 2840 against a bill
-- of 3351.20 is the disagreement this was always meant to avoid. So a sale
-- now carries its own tax, and its total is what the customer actually pays.
--
--   subtotal      sum of rate x quantity, before tax
--   discount      taken off the subtotal
--   tax_amount    GST on (subtotal - discount)
--   total         (subtotal - discount) + tax_amount
--
-- The rate per line is snapshot onto the line, for the same reason the item
-- name and the rate already are: changing your default GST rate next year
-- must not silently restate a sale recorded this year, and the invoice reads
-- the line rather than the setting so a bill can never disagree with the
-- sale it came from.
--
-- ROWS ALREADY RECORDED ARE LEFT ALONE. They were entered under the old
-- reading, where the quoted rate included tax, and their totals are what
-- those customers were actually told they owed. tax_amount defaults to zero
-- on them, which reads as "no tax was added on top of this", and that is
-- exactly what happened. Any invoice already raised from one is untouched:
-- an invoice stores its own figures. If a pilot account has test sales that
-- should be restated, delete and re-record them rather than trying to
-- convert, because there is no way from here to know which reading each row
-- was entered under.
--
-- Run by hand against Neon, like every other file in this directory.

ALTER TABLE sales
    ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00;

-- Nullable. A line with no rate of its own falls back to the item's rate,
-- and then to the wholesaler's default in invoice_settings.
ALTER TABLE sale_lines
    ADD COLUMN IF NOT EXISTS gst_percent NUMERIC(5, 2);

-- So a rate list can carry the right rate per item. Cotton fabric and
-- man made fabric are not taxed the same, and one default across a whole
-- book is wrong for most trades.
ALTER TABLE items
    ADD COLUMN IF NOT EXISTS gst_percent NUMERIC(5, 2);

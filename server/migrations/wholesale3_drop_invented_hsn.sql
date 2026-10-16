-- Stop declaring every product as an electrical transformer.
--
-- invoice_items.hsn_code defaulted to '8504' and three places in the code
-- passed that literal in when nothing better was known. 8504 is the HSN for
-- electrical transformers and static converters. A bill for cotton shirting
-- went out declaring the goods as transformers, which on a tax document is
-- not a cosmetic problem.
--
-- The default comes off. From here a line with no HSN stores NULL and prints
-- as a dash, which is a gap the wholesaler can see and fill in from the rate
-- list, rather than a wrong answer he has no reason to look at.
--
-- Rows already written are LEFT ALONE on purpose. Every one of them says
-- 8504, and there is no way from here to tell a line that was defaulted from
-- a line that really is a transformer. Clearing them would be guessing at
-- documents that have already been issued. If a wholesaler's book is known to
-- contain no electrical goods at all, this clears the invented ones:
--
--   UPDATE invoice_items ii SET hsn_code = NULL
--     FROM invoices i
--    WHERE i.id = ii.invoice_id
--      AND ii.hsn_code = '8504'
--      AND i.supplier_id = '<that wholesaler's user id>';
--
-- Run by hand against Neon, like every other file in this directory.

ALTER TABLE invoice_items
    ALTER COLUMN hsn_code DROP DEFAULT;

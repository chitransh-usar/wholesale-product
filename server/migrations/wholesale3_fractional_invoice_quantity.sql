-- An invoice line could not hold a fraction.
--
-- invoice_items.quantity was declared INTEGER by the marketplace-era invoice
-- module, where a quantity was always a count of packets. A sale recorded in
-- 3.0 has NUMERIC(12,3) quantities, because cloth is sold by the metre, wire
-- by the kilo and oil by the litre. Raising a bill for 2.5 metres therefore
-- did not round, it failed outright:
--
--   invalid input syntax for type integer: "2.5"
--
-- and the wholesaler got "Server error" with no bill and no way to get one.
-- The sale itself was fine, which made it look like the invoice module was
-- broken rather than the line.
--
-- Widening the column is safe in both directions: every existing row holds a
-- whole number and stays exactly what it was, and the CHECK (quantity > 0)
-- carries over unchanged.
--
-- Run by hand against Neon, like every other file in this directory.

ALTER TABLE invoice_items
    ALTER COLUMN quantity TYPE NUMERIC(12, 3);

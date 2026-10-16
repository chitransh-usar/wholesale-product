-- The customer's state, so the tax on his bill is decided by what he told us.
--
-- placeOfSupply asks three things in order: the state somebody declared, the
-- state his GST number carries, then his city. The parties table had no state
-- column at all, so for every khata customer the first and strongest of those
-- could not be answered. A customer with no GSTIN, in a town that is not one
-- of the ninety or so in STATE_BY_CITY, resolved to null, and null is read as
-- the same state. That bills CGST plus SGST.
--
-- For local trade, which is most of this book, that is the right answer and
-- this changes nothing. It is wrong for the wholesaler in Surat selling to a
-- shop in Raipur who has not registered for GST: that owes IGST and was
-- billed CGST plus SGST, on a legal document, with no way for him to correct
-- it because there was nowhere to say which state the customer is in.
--
-- Deliberately nullable with no default. An unset state has to stay
-- distinguishable from a declared one: "not told" is a fact placeOfSupply
-- knows what to do with, and a default of any real state would be the same
-- invented location the service was written to get rid of.
--
-- Safe to re-run.

ALTER TABLE parties
    ADD COLUMN IF NOT EXISTS state VARCHAR(100);

COMMENT ON COLUMN parties.state IS
    'Declared state, for CGST plus SGST against IGST. NULL means not told, which placeOfSupply reads as the same state as the wholesaler.';

-- An order number is unique to ITS WHOLESALER, not to the whole platform.
--
-- WHY THIS IS NEEDED. Orders were numbered `ORD-<timestamp>-<8 chars of the
-- buyer id>`, which is unique everywhere by accident of containing a clock
-- reading. They now draw on `order_sequences`, which is a real series and
-- restarts at 1 for every wholesaler, so the first order of the year for two
-- different wholesalers is `SO/1/26-27` for both. Against a platform wide
-- unique index the second one is refused outright, and phase2_check caught
-- exactly that: "duplicate key value violates unique constraint".
--
-- Every other series here is already per wholesaler. Invoice numbers get away
-- with a global index only because each wholesaler's own prefix is baked into
-- the number, which is not something to rely on.
--
-- NULL supplier_id sorts itself out: a unique index treats NULLs as distinct,
-- so rows from before orders carried a supplier are untouched.

DROP INDEX IF EXISTS idx_orders_order_number_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_number_per_owner
    ON orders (supplier_id, order_number);

COMMENT ON INDEX idx_orders_number_per_owner IS
    'One run of order numbers per wholesaler. Two wholesalers both having SO/1/26-27 is correct and expected.';

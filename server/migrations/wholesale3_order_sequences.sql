-- Orders get their own run of numbers, and a manual order gets a marker.
--
-- WHY A SERIES. Every other document here already has one: sales, invoices,
-- challans per kind, purchases, credit notes. Orders did not. They were
-- numbered `ORD-<timestamp>-<8 chars of the buyer id>` in the controller,
-- which is unique but is not a series: it cannot be read out over a phone, it
-- does not restart on 1 April, and two orders a second apart look unrelated.
--
-- This is also how every system in this trade works. In Tally a sales order
-- is its own voucher type and carries its own numbering, so an order number
-- and an invoice number never share a run.
--
-- The financial year is IN THE KEY, the same as the other counters, because
-- the run restarts on 1 April and the upsert has to have a constraint to
-- match. The challan migration learned this the hard way.

CREATE TABLE IF NOT EXISTS order_sequences (
    wholesaler_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    financial_year VARCHAR(10) NOT NULL,
    last_number INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (wholesaler_id, financial_year)
);

COMMENT ON TABLE order_sequences IS
    'One run of order numbers per wholesaler per financial year. SO/1/26-27.';

-- Where the order came from.
--
-- A shop order is placed by a buyer with an account. A MANUAL order is typed
-- by the wholesaler for an order taken on the phone or at the counter, so it
-- has a party but no buyer user at all. Marked explicitly rather than inferred
-- from a null buyer_id, because "this row has no buyer" and "this order was
-- taken by hand" are different statements and only one of them survives
-- somebody later making buyer_id nullable for another reason.

ALTER TABLE IF EXISTS orders
    ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'shop';

COMMENT ON COLUMN orders.source IS
    'shop is placed by a buyer through the marketplace. manual is typed by the wholesaler for an order taken on the phone or at the counter, and has no buyer_id.';

-- What the customer asked for, per line, so a part shipment can be measured
-- against it. Tally closes a sales order fully when it is completely billed
-- and leaves it PARTIALLY closed otherwise, which is the behaviour to match:
-- part shipment is normal in this trade.

ALTER TABLE IF EXISTS order_items
    ADD COLUMN IF NOT EXISTS quantity_billed NUMERIC(14, 3) NOT NULL DEFAULT 0;

COMMENT ON COLUMN order_items.quantity_billed IS
    'How much of this line has been billed. Less than quantity means the order is part billed, which is a normal state and not an error.';

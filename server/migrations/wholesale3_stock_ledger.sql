-- The stock ledger.
--
-- WHAT WAS WRONG. Until this file, nothing in the khata moved stock.
-- supplier_inventory.stock was written in exactly two places, orderController
-- and orderStatusService, both on the marketplace order path. A sale did not
-- lower it, a purchase did not raise it, and a challan did not touch it. The
-- figure was therefore meaningless for a wholesaler who works from the sales
-- book, which is most of them.
--
-- WHY A LEDGER AND NOT A COUNTER. supplier_inventory.stock is a stored number
-- updated from a handful of places. A stored counter written from six
-- documents is how a figure silently drifts, and there is no way afterwards to
-- ask WHY it says what it says. A ledger answers both: the quantity on hand is
-- the sum of the rows, and every row names the document that caused it.
--
-- The two numbers are NOT the same thing and this file does not merge them.
-- supplier_inventory.stock is what the wholesaler offers on his shop page, a
-- reservation counter the marketplace decrements when an order is placed. The
-- ledger is his own book stock, built from his own documents. Screens that
-- show both say which is which.
--
-- THE DOUBLE COUNTING PROBLEM, AND HOW IT IS AVOIDED. Goods leave on a sale
-- challan, and the bill is raised from that challan afterwards. If both the
-- challan and the bill move stock, the goods leave twice, and each entry looks
-- correct on its own. Tally solves this with a Tracking Number tying the
-- delivery note to the invoice.
--
-- The same idea here: a sale line remembers the challan it came from, in
-- from_challan_id. The challan moves the stock when the goods go. The bill
-- raised from it moves nothing, because the goods already left. A line typed
-- straight onto a bill has no challan and moves the stock itself. The client
-- has tracked this per line since the challan rework, it simply never sent it.

CREATE TABLE IF NOT EXISTS stock_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wholesaler_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- The listing this movement is against, supplier_inventory.id. The same id
    -- the item picker hands back on every form. Nullable on purpose: a line
    -- typed as free text, which every form still allows, is recorded with the
    -- name alone so the register is not silently short of movements it cannot
    -- attribute. A register for one product reads the rows that name it.
    product_id UUID,
    item_name TEXT NOT NULL,

    -- Signed. Positive is goods coming in, negative is goods going out. One
    -- signed column rather than separate in and out columns, because the
    -- balance is then a plain SUM and cannot be got wrong by reading one
    -- column and forgetting the other.
    quantity NUMERIC(14, 3) NOT NULL,
    unit VARCHAR(20),

    -- What caused it. Kept as a kind plus an id rather than six nullable
    -- foreign keys, because a seventh document type should not need a schema
    -- change here.
    document_kind VARCHAR(20) NOT NULL
        CHECK (document_kind IN ('sale', 'purchase', 'sale_challan',
                                 'purchase_challan', 'credit_note',
                                 'opening', 'adjustment')),
    document_id UUID,
    document_number TEXT,

    -- The date the goods actually moved, which is the document's own date and
    -- not when the row was written. A bill entered a week late belongs to the
    -- day the goods left.
    moved_on DATE NOT NULL DEFAULT CURRENT_DATE,

    -- A reversal is a new row of the opposite sign, never a delete. Cancelling
    -- a sale must leave the cancellation visible, the same way the rest of
    -- this product treats money.
    reverses_id UUID,
    note TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_ledger_owner_product
    ON stock_ledger (wholesaler_id, product_id);

CREATE INDEX IF NOT EXISTS idx_stock_ledger_owner_date
    ON stock_ledger (wholesaler_id, moved_on);

-- Reversing a document means finding its rows, so this is the lookup that
-- runs on every cancel.
CREATE INDEX IF NOT EXISTS idx_stock_ledger_document
    ON stock_ledger (wholesaler_id, document_kind, document_id);

COMMENT ON TABLE stock_ledger IS
    'Every physical movement of goods, signed. Positive is in, negative is out. Quantity on hand is the SUM of the rows for a product, never a stored counter. Separate from supplier_inventory.stock, which is the marketplace reservation counter.';

COMMENT ON COLUMN stock_ledger.quantity IS
    'Signed. Positive is goods coming in, negative is goods going out.';

-- The product a line names, so a movement can be attributed to a listing, and
-- the challan it came from, so the bill raised off a challan does not move the
-- goods a second time.
--
-- ALTER TABLE IF EXISTS on both, because purchase_lines arrives with
-- wholesale3_purchases.sql and a database that has not had that file yet
-- should get the sale half rather than failing the whole run. Unlike the
-- opening balance file this one sorts AFTER purchases alphabetically, so in
-- practice the table is already there.

ALTER TABLE IF EXISTS sale_lines
    ADD COLUMN IF NOT EXISTS product_id UUID;

ALTER TABLE IF EXISTS sale_lines
    ADD COLUMN IF NOT EXISTS from_challan_id UUID;

ALTER TABLE IF EXISTS purchase_lines
    ADD COLUMN IF NOT EXISTS product_id UUID;

ALTER TABLE IF EXISTS purchase_lines
    ADD COLUMN IF NOT EXISTS from_challan_id UUID;

COMMENT ON COLUMN sale_lines.from_challan_id IS
    'The challan these goods already left on. When set, the sale does NOT move stock, because the challan did. See the header of wholesale3_stock_ledger.sql.';

COMMENT ON COLUMN purchase_lines.from_challan_id IS
    'The challan these goods already arrived on. When set, the purchase does NOT move stock, because the challan did.';

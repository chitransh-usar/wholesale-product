-- Wholesale 3.0: the challan becomes a document in its own right.
--
-- WHAT CHANGES, AND WHY.
--
-- The challan built on 10 Sept was payment driven. It was raised BECAUSE a
-- sale was not fully paid, and it blocked the tax invoice until the money
-- came in. That is not what a challan is anywhere else in Indian trade.
--
-- In Marg it is Sale Challan and Purchase Challan, entered under Transactions
-- and converted into a Sale Bill or a Purchase Bill afterwards. In Tally the
-- same pair is Delivery Note and Receipt Note. In Busy it is Material Issued
-- to Party and Material Received from Party. In all three the challan is
-- MOVEMENT driven: it is raised because goods moved, before any bill exists,
-- and it has nothing to do with whether anybody has paid.
--
-- So this migration turns one payment-driven document into two
-- movement-driven ones:
--
--   kind = 'sale'      goods going out to a customer
--   kind = 'purchase'  goods coming in from a supplier
--
-- THE ACCOUNTING RULE THIS MUST NOT BREAK. A challan moves STOCK and nothing
-- else. It never touches the party's balance and it carries no GST, which is
-- why delivery_challan_items has no tax columns and must not grow any. The
-- money starts existing when the bill is raised from the challan. A challan
-- that also moved the ledger would have every sale counted twice in the
-- khata, once when the goods left and again when the bill went out.
--
-- THE TABLE NAME STAYS delivery_challans. Renaming it would rewrite five
-- foreign keys and every query for a word nobody sees: the name is internal,
-- and the screens, the PDF and the wording all now say "challan" alone.

-- ---------------------------------------------------------------
-- Which kind of challan
-- ---------------------------------------------------------------
-- Defaults to 'sale', which is what every existing row is: the old feature
-- could only ever raise a goods-out note against a sale.

ALTER TABLE IF EXISTS delivery_challans
    ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'sale';

ALTER TABLE IF EXISTS delivery_challans
    DROP CONSTRAINT IF EXISTS delivery_challans_kind_check;

ALTER TABLE IF EXISTS delivery_challans
    ADD CONSTRAINT delivery_challans_kind_check
    CHECK (kind IN ('sale', 'purchase'));

-- ---------------------------------------------------------------
-- The purchase side of the link
-- ---------------------------------------------------------------
-- A sale challan points at a party and, once billed, a sale. A purchase
-- challan points at a supplier and, once billed, a purchase. Both sets of
-- columns live on one table because they are the same document in two
-- directions, and splitting them would mean two of every query.

ALTER TABLE IF EXISTS delivery_challans
    ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS delivery_challans
    ADD COLUMN IF NOT EXISTS purchase_id UUID REFERENCES purchases(id) ON DELETE SET NULL;

-- The supplier's own challan number, copied off the paper that came with the
-- goods. Ours identifies the entry. His is what the godown will be asked for.
ALTER TABLE IF EXISTS delivery_challans
    ADD COLUMN IF NOT EXISTS supplier_challan_number VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_challans_supplier
    ON delivery_challans (supplier_id) WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_challans_purchase
    ON delivery_challans (purchase_id) WHERE purchase_id IS NOT NULL;

-- Finding what is still waiting to be billed, per party, is the query the
-- sale and purchase forms run every time somebody picks a customer.
CREATE INDEX IF NOT EXISTS idx_challans_pending
    ON delivery_challans (wholesaler_id, kind, party_id, supplier_id)
    WHERE invoice_id IS NULL AND purchase_id IS NULL;

-- ---------------------------------------------------------------
-- Where the challan is in its life
-- ---------------------------------------------------------------
-- Derivable from invoice_id and purchase_id, and stored anyway, because
-- 'cancelled' is not derivable from either and a challan raised in error has
-- to be closable without deleting a document that has been handed over.

ALTER TABLE IF EXISTS delivery_challans
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pending';

ALTER TABLE IF EXISTS delivery_challans
    DROP CONSTRAINT IF EXISTS delivery_challans_status_check;

ALTER TABLE IF EXISTS delivery_challans
    ADD CONSTRAINT delivery_challans_status_check
    CHECK (status IN ('pending', 'billed', 'cancelled'));

-- Existing rows that already point at an invoice are billed. Runs every time
-- and is harmless, because it only ever moves a row that disagrees with its
-- own invoice_id.
UPDATE delivery_challans SET status = 'billed'
 WHERE invoice_id IS NOT NULL AND status <> 'billed';

ALTER TABLE IF EXISTS delivery_challans
    ADD COLUMN IF NOT EXISTS cancelled_reason TEXT;

-- ---------------------------------------------------------------
-- A run of numbers per kind
-- ---------------------------------------------------------------
-- A sale challan and a purchase challan must not share a counter, for the
-- same reason a Flipkart bill and a counter bill do not: a run that skips is
-- a run nobody can reconcile. The old table had one row per wholesaler, so
-- the key widens rather than the table being replaced.
--
-- THE FINANCIAL YEAR STAYS IN THE KEY. The allocator upserts on
-- (wholesaler_id, financial_year) and the run resets on 1 April. Widening to
-- (wholesaler_id, kind) alone would leave no constraint matching that
-- ON CONFLICT, and the next challan of any kind would fail outright with
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification". Caught by reading the allocator rather than by the
-- migration, which applies perfectly either way.

ALTER TABLE IF EXISTS delivery_challan_sequences
    ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'sale';

ALTER TABLE IF EXISTS delivery_challan_sequences
    DROP CONSTRAINT IF EXISTS delivery_challan_sequences_pkey;

DROP INDEX IF EXISTS idx_challan_sequences_owner_kind;

CREATE UNIQUE INDEX IF NOT EXISTS idx_challan_sequences_owner_fy_kind
    ON delivery_challan_sequences (wholesaler_id, financial_year, kind);

-- ---------------------------------------------------------------
-- Reasons, for both directions
-- ---------------------------------------------------------------
-- 'payment_pending' stays because rows already carry it, but it is no longer
-- how a challan comes about. The new reasons are the ones a wholesaler would
-- actually give for goods moving without a bill, in either direction.

ALTER TABLE IF EXISTS delivery_challans
    DROP CONSTRAINT IF EXISTS delivery_challans_reason_check;

ALTER TABLE IF EXISTS delivery_challans
    ADD CONSTRAINT delivery_challans_reason_check
    CHECK (reason IN ('payment_pending', 'job_work', 'on_approval',
                      'quantity_unknown', 'bill_to_follow', 'sample',
                      'branch_transfer', 'other'));

-- ---------------------------------------------------------------
-- What the items need to become a bill
-- ---------------------------------------------------------------
-- A challan that a sale is generated from has to carry enough to price that
-- sale. It already holds the quantity, the unit, the rate and the value. The
-- GST rate is the one thing missing, and it is NOT a tax on the challan: it
-- is what the line will be billed at when the bill is eventually raised, in
-- exactly the way sale_lines.gst_percent is. The challan itself still shows
-- no tax and totals no tax.

ALTER TABLE IF EXISTS delivery_challan_items
    ADD COLUMN IF NOT EXISTS gst_percent NUMERIC(5, 2);

ALTER TABLE IF EXISTS delivery_challan_items
    ADD COLUMN IF NOT EXISTS cess_percent NUMERIC(5, 2) NOT NULL DEFAULT 0;

-- What the wholesaler calls the item in his own list, when it came from there.
ALTER TABLE IF EXISTS delivery_challan_items
    ADD COLUMN IF NOT EXISTS product_id UUID;

COMMENT ON COLUMN delivery_challan_items.gst_percent IS
    'The rate this line WILL be billed at. The challan carries no tax and totals none. See the header of wholesale3_challans_two_kinds.sql.';

COMMENT ON TABLE delivery_challans IS
    'A challan: goods moved without a bill. kind=sale is goods out to a customer, kind=purchase is goods in from a supplier. Moves stock only, never the party balance, and carries no GST. The bill is generated from it afterwards.';

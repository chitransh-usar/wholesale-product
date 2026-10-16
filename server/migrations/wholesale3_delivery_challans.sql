-- Wholesale 3.0: delivery challans.
--
-- WHAT THIS IS, AND A WARNING THAT GOES WITH IT
--
-- Built to a specification given on 10 Sept 2026: when goods go out and the
-- full amount has not been received, the wholesaler gets a DELIVERY CHALLAN
-- instead of a tax invoice, and the invoice is raised only once the money is
-- in. The challan carries no tax.
--
-- That is not what the CGST Act says, and the wholesaler asking for it knows:
-- it is going to his legal advisor before this reaches production, and the
-- rules here are expected to change. Recording the gap so nobody builds on
-- this shape believing it is settled law:
--
--   Section 31(1) ties the tax invoice to REMOVAL of the goods, not to
--   payment. For a credit sale the invoice is due before or at the time the
--   goods leave. Issuing only a challan understates outward supply in GSTR-1
--   and leaves the customer unable to claim input credit.
--
--   Rule 55 challans are for movement that is NOT a supply: job work, goods
--   on approval, quantity unknown at removal. Rule 55(2) also wants three
--   copies, and tax shown where the movement IS a supply.
--
-- So this table deliberately does NOT model Rule 55. It models the document
-- that was asked for. `is_rule_55` is here so that if the advisor says the
-- real thing is wanted, the two can live side by side rather than one being
-- retrofitted over the other.
--
-- The whole feature sits behind FEATURES.CHALLAN_WHEN_UNPAID on the client
-- and `challanEnabled()` on the server, so it can be switched off in one word
-- without unpicking anything.
--
-- FOUR DECISIONS, not plumbing:
--
-- 1. Its own number series per wholesaler, in delivery_challan_sequences.
--    A challan may not borrow the invoice run: gaps in the invoice series
--    look like missing bills, and the two documents are counted separately.
--
-- 2. The recipient is SNAPSHOT, the same as invoices and credit notes.
--    Editing a customer today must not rewrite a challan issued last month.
--
-- 3. Lines are copied, not joined, and quantity is NUMERIC(12,3) so 2.5
--    metres does not become 3. There is no tax column at all, by instruction:
--    a challan here carries value only.
--
-- 4. Many challans per sale is ALLOWED, unlike credit notes. Goods can go out
--    in more than one lot against one sale, which is ordinary wholesale, and
--    a unique index would make the second lorry impossible.
--
-- RUN wholesale3_parties_and_sales.sql FIRST. This references sales, parties
-- and orders.
--
-- Run by hand against Neon, like every other file in this directory.

CREATE TABLE IF NOT EXISTS delivery_challan_sequences (
    wholesaler_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    last_number INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS delivery_challans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wholesaler_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- One of these two is set. A challan raised from the sales book carries a
    -- sale. One raised from a shop order carries the order and, once the
    -- order has written its sale, both.
    sale_id UUID REFERENCES sales(id) ON DELETE SET NULL,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    party_id UUID REFERENCES parties(id) ON DELETE SET NULL,

    challan_number VARCHAR(50) NOT NULL,

    -- Why it was raised. Only one value is reachable today. The column exists
    -- so the Rule 55 reasons can be added without a migration.
    reason VARCHAR(30) NOT NULL DEFAULT 'payment_pending'
        CHECK (reason IN ('payment_pending', 'job_work', 'on_approval',
                          'quantity_unknown', 'other')),
    reason_note TEXT,

    -- FALSE for everything this file creates. See the warning above.
    is_rule_55 BOOLEAN NOT NULL DEFAULT FALSE,

    -- What had been received when it was raised, and what the goods came to.
    -- Both frozen: this is what the document said on the day it was handed
    -- over, and later payments must not rewrite it.
    total_value NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    amount_paid NUMERIC(12, 2) NOT NULL DEFAULT 0.00,

    recipient_name VARCHAR(255),
    recipient_gstin VARCHAR(20),
    recipient_city VARCHAR(100),
    recipient_address TEXT,
    recipient_phone VARCHAR(20),

    -- Set when the money finally arrives and the tax invoice is raised, so
    -- the challan can point at the bill that superseded it.
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,

    issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (wholesaler_id, challan_number)
);

CREATE TABLE IF NOT EXISTS delivery_challan_items (
    id SERIAL PRIMARY KEY,
    challan_id UUID NOT NULL REFERENCES delivery_challans(id) ON DELETE CASCADE,
    item_name VARCHAR(255) NOT NULL,
    hsn_code VARCHAR(50),
    quantity NUMERIC(12, 3) NOT NULL DEFAULT 1,
    unit VARCHAR(20),
    unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    -- Value only. No tax columns, by instruction.
    total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_challans_wholesaler
    ON delivery_challans (wholesaler_id, issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_challans_party ON delivery_challans (party_id);
CREATE INDEX IF NOT EXISTS idx_challans_sale ON delivery_challans (sale_id);
CREATE INDEX IF NOT EXISTS idx_challans_order ON delivery_challans (order_id);
CREATE INDEX IF NOT EXISTS idx_challan_items_challan
    ON delivery_challan_items (challan_id);

COMMENT ON TABLE delivery_challans IS
    'Goods-out note raised when a sale is not fully paid. NOT a Rule 55 challan and NOT a tax document: see the header of wholesale3_delivery_challans.sql before relying on it.';
COMMENT ON COLUMN delivery_challans.is_rule_55 IS
    'FALSE for every row this feature creates. Reserved for real Rule 55 challans (job work, goods on approval) if those are built.';

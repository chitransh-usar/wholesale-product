-- Wholesale 3.0: the purchase side of the book.
--
-- Everything so far records goods going OUT. A wholesaler also buys, from
-- mills, from agents, from other wholesalers, and until now none of that was
-- anywhere in the product. That leaves two holes that matter to a real trader:
--
--   * He cannot see what he OWES. The customer book answers "who owes me",
--     and the other half of a trader's day is the other direction.
--   * He cannot claim his input tax credit. GST is paid on the difference,
--     so the tax on his purchases is money back. With no purchase record
--     there is nothing to set against the tax he has charged.
--
-- This is deliberately the MIRROR of the sales spine, not a new idea:
--
--     parties          ->  suppliers
--     sales            ->  purchases
--     sale_lines       ->  purchase_lines
--     party_payments   ->  supplier_payments      (money out, not in)
--     sale_sequences   ->  purchase_sequences
--
-- Run by hand against Neon, like every other file in this directory.
-- Safe to run more than once.
--
-- ---------------------------------------------------------------------------
-- WHY A SEPARATE suppliers TABLE RATHER THAN A COLUMN ON parties
-- ---------------------------------------------------------------------------
-- Adding `kind` to parties was the first idea and it is the wrong one. A party
-- row means "this man owes me", and that meaning is baked into seventeen
-- queries across five files: the customer list, the overview totals, the
-- statement, the credit service, khataBalance. Every one of them would need a
-- new filter, and the first one missed puts a supplier in the customer list
-- with his balance pointing the wrong way.
--
-- The cost of a separate table is that a firm a wholesaler both buys from and
-- sells to is two rows. That is the same trade parties already made when it
-- decided a party is private to one wholesaler, and it fails in the safe
-- direction: two rows that should be one is untidy, one row standing for two
-- relationships with opposite signs is a wrong balance.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DELIBERATELY DOES NOT DO
-- ---------------------------------------------------------------------------
-- STOCK IS NOT MOVED. The obvious next thought is that a purchase should raise
-- stock. It must not, yet, because a sale does not lower it: sale_lines stores
-- an item name as text and touches no inventory row. Wiring one side only
-- gives a stock figure that climbs forever and is wrong in one direction from
-- the first purchase onward, which is worse than the honest nothing there is
-- today. Both sides move together or neither does.
--
-- NO INVOICE IS RAISED. A purchase bill is the supplier's document, not ours.
-- What is stored here is a copy of what he handed over, which is why the
-- supplier's own number and date are columns.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------
-- Suppliers: who the wholesaler buys from
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wholesaler_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    name VARCHAR(255) NOT NULL,
    business_name VARCHAR(255),
    phone VARCHAR(20),
    city VARCHAR(100),
    address TEXT,

    -- Matters more here than on a customer. The supplier's GSTIN is what makes
    -- his tax claimable: a purchase from an unregistered dealer carries no
    -- input credit at all, and the first two digits decide whether his bill
    -- should have charged CGST plus SGST or IGST.
    gstin VARCHAR(20),

    -- Private to the wholesaler, exactly like parties.notes. Never shown to
    -- anybody but him.
    notes TEXT,

    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_suppliers_wholesaler ON suppliers (wholesaler_id);

-- One phone number should not appear twice in the same supplier book.
-- Partial, because a supplier copied off an old bill may have no number.
CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_wholesaler_phone
    ON suppliers (wholesaler_id, phone)
    WHERE phone IS NOT NULL AND phone <> '';

-- ---------------------------------------------------------------
-- Purchases
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wholesaler_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,

    -- OUR reference for this entry, PUR/1/26-27. Ours is for finding the
    -- thing again. The supplier's number below is the one that matters to the
    -- tax department.
    purchase_number VARCHAR(50),
    purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,

    -- The supplier's own bill number and its date, copied off the paper he
    -- handed over. This is what a purchase is matched on in GSTR-2B, so it is
    -- the field a wholesaler will be asked for and cannot reconstruct later.
    --
    -- The date is separate from purchase_date on purpose: a bill dated the
    -- 29th of last month that arrives with the goods on the 2nd belongs to
    -- last month's return.
    supplier_invoice_number VARCHAR(50),
    supplier_invoice_date DATE,

    -- Mirrors sales.status. Short on purpose, and for the same reason: the
    -- real stages come from watching somebody work.
    status VARCHAR(20) NOT NULL DEFAULT 'received'
        CHECK (status IN ('draft', 'received', 'cancelled')),

    subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    discount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    notes TEXT,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_purchases_wholesaler
    ON purchases (wholesaler_id, purchase_date DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier
    ON purchases (supplier_id, purchase_date DESC);

-- Our own number is unique within one wholesaler's book, never globally.
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_number_per_wholesaler
    ON purchases (wholesaler_id, purchase_number)
    WHERE purchase_number IS NOT NULL;

-- The same supplier bill must not be entered twice.
--
-- This is not tidiness. Entering a purchase bill twice claims its input tax
-- credit twice, which is the single most common way a small trader's return
-- stops matching GSTR-2B, and it is invisible afterwards because both rows
-- look correct on their own. Scoped to the supplier as well as the wholesaler,
-- because two different mills will both have a bill numbered 001.
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_supplier_bill
    ON purchases (wholesaler_id, supplier_id, lower(supplier_invoice_number))
    WHERE supplier_invoice_number IS NOT NULL AND supplier_invoice_number <> '';

CREATE TABLE IF NOT EXISTS purchase_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,

    -- Text, not a reference, for the same reason sale_lines is text: a
    -- purchase must be recordable for something not on any list, and an old
    -- bill must not change when a rate is edited.
    item_name VARCHAR(255) NOT NULL,
    quantity NUMERIC(12, 3) NOT NULL DEFAULT 1,
    unit VARCHAR(20),
    rate NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,

    hsn_code VARCHAR(20),
    gst_percent NUMERIC(5, 2),

    -- Whether the tax on THIS line can be set against tax collected.
    --
    -- Usually yes, which is why it defaults true. Section 17(5) blocks it on a
    -- list of things a trader genuinely does buy: a motor car, food and
    -- catering, membership of a club, goods written off or given as free
    -- samples. Claiming credit on a blocked line is recovered with interest,
    -- so it is a per line fact rather than a per bill one: a single supplier
    -- bill can carry both.
    itc_eligible BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_purchase_lines_purchase
    ON purchase_lines (purchase_id);

-- ---------------------------------------------------------------
-- Money paid OUT. The mirror of party_payments.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supplier_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wholesaler_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,

    -- Nullable for the same reason party_payments.sale_id is: a trader pays a
    -- round sum against several old bills without saying which.
    purchase_id UUID REFERENCES purchases(id) ON DELETE SET NULL,

    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    method VARCHAR(20) NOT NULL DEFAULT 'cash'
        CHECK (method IN ('cash', 'upi', 'bank', 'cheque', 'other')),
    paid_on DATE NOT NULL DEFAULT CURRENT_DATE,
    note TEXT,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier
    ON supplier_payments (supplier_id, paid_on DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_wholesaler
    ON supplier_payments (wholesaler_id, paid_on DESC);
-- Every purchase page and every supplier balance asks for the payments against
-- a purchase. Without this that is a sequential scan per supplier, which is
-- the exact index the audit found missing on party_payments.
CREATE INDEX IF NOT EXISTS idx_supplier_payments_purchase
    ON supplier_payments (purchase_id);

-- ---------------------------------------------------------------
-- Purchase numbering
-- ---------------------------------------------------------------
-- Keyed on the financial year from the start, unlike sale_sequences and
-- delivery_challan_sequences, which both had to be migrated into it later.
CREATE TABLE IF NOT EXISTS purchase_sequences (
    wholesaler_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    financial_year VARCHAR(7) NOT NULL,
    last_number INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (wholesaler_id, financial_year)
);

COMMENT ON COLUMN purchases.supplier_invoice_number IS
    'The number printed on the supplier''s own bill. What GSTR-2B matches on, and the reason this cannot be entered twice.';
COMMENT ON COLUMN purchase_lines.itc_eligible IS
    'Whether input tax credit may be claimed on this line. False for the Section 17(5) blocked list.';

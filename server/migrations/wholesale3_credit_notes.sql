-- Wholesale 3.0: credit notes.
--
-- Until now, reversing a bill meant marking the invoice Cancelled. That is
-- the wrong instrument once the bill has left the building. Under section 34
-- of the CGST Act, when an invoice has been issued and the supply is later
-- cancelled, the goods come back, or the value charged turns out to be more
-- than what was payable, the supplier issues a CREDIT NOTE. The invoice
-- stands. The credit note is the document that reverses it, and it is the
-- document the customer needs for his own books.
--
-- Four things here are decisions, not plumbing.
--
-- 1. Its own number series, per wholesaler, kept in credit_note_sequences.
--    A credit note may not borrow the invoice series: GST wants each document
--    type in its own consecutive run, and reusing invoice numbers would leave
--    gaps in the invoice run that look like missing bills.
--
-- 2. The recipient is SNAPSHOT here too, for the same reason it is snapshot
--    onto invoices. Editing a customer's GSTIN today must not rewrite a credit
--    note raised last year.
--
-- 3. The lines are copied rather than joined. The credit note has to say what
--    was credited even if the sale is later edited, and quantity is NUMERIC
--    rather than the INTEGER that invoice_items uses, so 2.5 metres does not
--    become 3 on the way through.
--
-- 4. One credit note per invoice, enforced by a unique index. Every credit
--    note this file supports reverses the whole invoice, so a second one
--    would credit the same goods twice. Partial credits, for a part return or
--    a rate correction, will relax that index and add a quantity to each line;
--    the shape here is built so that is an addition rather than a rewrite.
--
-- RUN wholesale3_parties_and_sales.sql AND wholesale3_invoice_from_sale.sql
-- FIRST. This file references sales, parties and invoices.sale_id. Run out of
-- order it stops on "relation sales does not exist", which is loud rather than
-- silent and costs nothing: every statement here is IF NOT EXISTS, so once the
-- other two are in, run this one again and it completes.
--
-- Run by hand against Neon, like every other file in this directory.

CREATE TABLE IF NOT EXISTS credit_note_sequences (
    wholesaler_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    last_number INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS credit_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wholesaler_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- RESTRICT, not CASCADE. An issued credit note is not something that
    -- should quietly disappear because a row upstream was deleted.
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    sale_id UUID REFERENCES sales(id) ON DELETE SET NULL,
    party_id UUID REFERENCES parties(id) ON DELETE SET NULL,

    note_number VARCHAR(50) NOT NULL,

    -- Why the bill was reversed. Printed on the document, because a credit
    -- note without a reason is not much use to either side at audit.
    reason VARCHAR(30) NOT NULL DEFAULT 'sale_cancelled'
        CHECK (reason IN ('sale_cancelled', 'goods_returned', 'rate_revised', 'other')),
    reason_note TEXT,

    recipient_name VARCHAR(255),
    recipient_gstin VARCHAR(20),
    recipient_city VARCHAR(100),
    recipient_address TEXT,
    recipient_phone VARCHAR(20),

    subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    discount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    taxable_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    cgst NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    sgst NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    igst NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total_tax NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    grand_total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,

    issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (wholesaler_id, note_number)
);

CREATE TABLE IF NOT EXISTS credit_note_items (
    id SERIAL PRIMARY KEY,
    credit_note_id UUID NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
    item_name VARCHAR(255) NOT NULL,
    hsn_code VARCHAR(50),
    quantity NUMERIC(12, 3) NOT NULL DEFAULT 1,
    unit VARCHAR(20),
    unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    gst_percent NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_credit_notes_wholesaler
    ON credit_notes (wholesaler_id, issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_credit_notes_party ON credit_notes (party_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_sale ON credit_notes (sale_id);
CREATE INDEX IF NOT EXISTS idx_credit_note_items_note
    ON credit_note_items (credit_note_id);

-- See point 4 above. Drop this index the day partial credit notes land.
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_notes_invoice
    ON credit_notes (invoice_id);

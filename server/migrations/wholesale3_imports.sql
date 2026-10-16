-- Wholesale 3.0: bringing a book in from somewhere else.
--
-- Phase 8.5. The export hands a wholesaler his data. This is the other
-- direction: a spreadsheet of customers, suppliers, purchases, sales or old
-- bills, read and written into his book.
--
-- Two things are recorded, and both exist for the same reason. An import
-- writes many rows at once from a file nobody has read line by line, so the
-- question "where did this row come from" has to be answerable afterwards.
--
--   imports            one row per run. Who did it, when, what the file was
--                      called, and what it did.
--   import_batch_id    on every row an import created, pointing back at that
--                      run.
--
-- Without the second one an import that went wrong could only be undone by
-- hand, row by row, by somebody comparing a spreadsheet against a ledger.
--
-- NOTE ON IMPORTED INVOICES. A bill that comes in this way was issued
-- somewhere else. It keeps its own number, it is never renumbered, and it
-- never gets an IRN, because an IRN is issued by the Invoice Registration
-- Portal against a submission we did not make. import_batch_id on invoices is
-- therefore not only an audit trail. It is the flag that says this document is
-- a record of a bill, not a bill this system raised, and the code refuses to
-- re-issue it.

CREATE TABLE IF NOT EXISTS imports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wholesaler_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- The person, not the business. An import is done by somebody, and on a
    -- book with staff the owner will want to know who.
    done_by UUID REFERENCES users(id) ON DELETE SET NULL,

    -- As the file was called on their machine. Useless to the database and the
    -- first thing a person asks for when something looks wrong.
    file_name VARCHAR(255),
    file_bytes INTEGER,

    -- What it did, as counts per list. JSON because the shape is a report
    -- rather than a thing to query, and adding a list later must not need a
    -- migration.
    summary JSONB NOT NULL DEFAULT '{}'::jsonb,

    status VARCHAR(20) NOT NULL DEFAULT 'done'
        CHECK (status IN ('done', 'failed')),
    message TEXT,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_imports_wholesaler
    ON imports (wholesaler_id, created_at DESC);

-- ---------------------------------------------------------------
-- The back pointer, on everything an import can create.
-- ---------------------------------------------------------------
-- ALTER TABLE IF EXISTS throughout, because a database that has not had the
-- purchases or sales migrations run yet must not stop here.

ALTER TABLE IF EXISTS parties
    ADD COLUMN IF NOT EXISTS import_batch_id UUID;

ALTER TABLE IF EXISTS suppliers
    ADD COLUMN IF NOT EXISTS import_batch_id UUID;

ALTER TABLE IF EXISTS purchases
    ADD COLUMN IF NOT EXISTS import_batch_id UUID;

ALTER TABLE IF EXISTS sales
    ADD COLUMN IF NOT EXISTS import_batch_id UUID;

ALTER TABLE IF EXISTS invoices
    ADD COLUMN IF NOT EXISTS import_batch_id UUID;

-- Finding everything one run created has to be quick, because it is what an
-- undo would walk. Partial, because almost every row in these tables was typed
-- by a person and carries nothing here.

CREATE INDEX IF NOT EXISTS idx_parties_import_batch
    ON parties (import_batch_id) WHERE import_batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_suppliers_import_batch
    ON suppliers (import_batch_id) WHERE import_batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchases_import_batch
    ON purchases (import_batch_id) WHERE import_batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_import_batch
    ON sales (import_batch_id) WHERE import_batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_import_batch
    ON invoices (import_batch_id) WHERE import_batch_id IS NOT NULL;

COMMENT ON COLUMN invoices.import_batch_id IS
    'Set when this bill was brought in from a file rather than raised here. Such a bill keeps its own number, is never renumbered, and never carries an IRN.';

-- ---------------------------------------------------------------
-- An imported sale is still a sale, but it was not made at the counter.
-- ---------------------------------------------------------------
-- sales.source already separates a sale the wholesaler recorded himself from
-- one that came in through a retailer's order. A third value says it was
-- brought in from a file, which keeps the khata honest about where a figure
-- came from. The constraint is dropped and re-added rather than altered,
-- because there is no ALTER CONSTRAINT for a CHECK.
--
-- Both existing values are carried over exactly. Adding a constraint that any
-- row already on the table breaks would fail the whole migration, and
-- 'retailer' is the value every marketplace sale carries.

ALTER TABLE IF EXISTS sales
    DROP CONSTRAINT IF EXISTS sales_source_check;

ALTER TABLE IF EXISTS sales
    ADD CONSTRAINT sales_source_check
    CHECK (source IN ('wholesaler', 'retailer', 'imported'));

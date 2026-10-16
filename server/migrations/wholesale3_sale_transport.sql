-- Transport details on a sale.
--
-- Phase 5 of ROADMAP.md. The invoice already has these columns, from
-- wholesale3_invoice_document_block.sql. This is the same block on the sale,
-- and it is a separate table rather than a join for a plain reason: a sale
-- does not always have an invoice. A wholesaler records the sale and loads the
-- lorry the same afternoon, and the bill may be raised days later or never.
-- The lorry number has to live where the despatch is recorded.
--
-- When a bill IS raised from the sale, saleInvoiceService copies these onto the
-- invoice, the same way it already copies who the sale was to. Copied, not
-- joined, for the reason written up in the invoice migration: a tax document
-- must not change after it has been handed over.
--
-- Every column is nullable. Most sales are collected from the shop by the
-- customer and have no transport at all.
--
-- Run by hand against Neon, like every other file in this directory.

ALTER TABLE IF EXISTS sales
    ADD COLUMN IF NOT EXISTS transporter_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS transporter_id VARCHAR(20),
    ADD COLUMN IF NOT EXISTS transport_mode VARCHAR(10),
    ADD COLUMN IF NOT EXISTS vehicle_number VARCHAR(20),
    ADD COLUMN IF NOT EXISTS transport_doc_number VARCHAR(50),
    ADD COLUMN IF NOT EXISTS transport_doc_date DATE,
    ADD COLUMN IF NOT EXISTS gr_number VARCHAR(50),
    ADD COLUMN IF NOT EXISTS gr_date DATE;

-- The same four modes the invoice allows. Dropped first so this file can be
-- run twice.
ALTER TABLE IF EXISTS sales
    DROP CONSTRAINT IF EXISTS sales_transport_mode_check;

ALTER TABLE IF EXISTS sales
    ADD CONSTRAINT sales_transport_mode_check
    CHECK (transport_mode IS NULL OR transport_mode IN ('road', 'rail', 'air', 'ship'));

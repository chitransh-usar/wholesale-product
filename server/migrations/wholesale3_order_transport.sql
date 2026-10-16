-- Transport details on a marketplace order.
--
-- Phase 5, the third and last place this block is needed. An invoice has it
-- from wholesale3_invoice_document_block.sql and a sale from
-- wholesale3_sale_transport.sql. Without this one, a bill raised from a shop
-- order printed no transport at all, even though the wholesaler had already
-- typed a vehicle number into the dispatch box.
--
-- WHY THE ORDER NEEDS ITS OWN, and why the existing columns are not enough.
--
-- orders already holds shipping_carrier and tracking_number, which are a
-- courier's name and a consignment number. They are not the e-way bill fields.
-- An e-way bill wants the transporter's GSTIN, how the goods travel, the
-- vehicle, and the LR or RR number, and none of those has anywhere to live.
--
-- shipment_tracking_links holds a driver name, phone and vehicle, but that is
-- the link a customer opens to watch the lorry. It is a courtesy, it is deleted
-- when it expires, and a tax document must not be built out of it.
--
-- THE TIMING, which is what makes the order different from the sale.
--
-- A shop order raises its invoice the moment the order is placed, long before
-- anything is loaded. So the transport CANNOT be copied onto the bill when the
-- bill is made: nobody knows it yet. It is stamped at despatch instead, onto
-- the order and onto the invoice that already exists.
--
-- That is a deliberate exception to the freezing rule, and it is worth being
-- clear about. The seller's address and the amounts are frozen because they
-- were true when the document was issued. The vehicle is not that kind of
-- fact: it is decided afterwards, and the e-way bill itself allows the vehicle
-- number to be updated in transit, because lorries break down and goods get
-- moved. So this block stays writable while the addresses and the money do
-- not.
--
-- Run by hand against Neon, like every other file in this directory.

ALTER TABLE IF EXISTS orders
    ADD COLUMN IF NOT EXISTS transporter_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS transporter_id VARCHAR(20),
    ADD COLUMN IF NOT EXISTS transport_mode VARCHAR(10),
    ADD COLUMN IF NOT EXISTS vehicle_number VARCHAR(20),
    ADD COLUMN IF NOT EXISTS transport_doc_number VARCHAR(50),
    ADD COLUMN IF NOT EXISTS transport_doc_date DATE,
    ADD COLUMN IF NOT EXISTS gr_number VARCHAR(50),
    ADD COLUMN IF NOT EXISTS gr_date DATE;

-- The same four modes the invoice and the sale allow. Dropped first so this
-- file can be run twice. On a first run Postgres reports that there was no
-- such constraint to drop, which is the IF EXISTS doing its job and not a
-- failure.
ALTER TABLE IF EXISTS orders
    DROP CONSTRAINT IF EXISTS orders_transport_mode_check;

ALTER TABLE IF EXISTS orders
    ADD CONSTRAINT orders_transport_mode_check
    CHECK (transport_mode IS NULL OR transport_mode IN ('road', 'rail', 'air', 'ship'));

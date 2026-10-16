-- Wholesale 3.0: everything else a tax invoice has to carry, as columns.
--
-- Phase 2 of ROADMAP.md. Columns and the write path only. Nothing on a form or
-- on the PDF yet, which is phase 3, and nothing computes cess yet, which is
-- phase 6. The columns arrive first and nullable so each later phase fills in
-- what it needs without another round trip through a hand applied migration.
--
-- WHY THESE ARE COPIED AND NOT JOINED
--
-- An invoice already snapshots who it was issued to, because a party can be
-- edited and a tax document must not change after it has been handed over. The
-- seller block, the dispatch-from and ship-to addresses and the bank details
-- are the same kind of fact and get the same treatment. Join them instead and a
-- reprint six months later shows an address the customer never signed for, and
-- bank details that may belong to a closed account.
--
-- invoice_settings is where a wholesaler's own bank details live, because
-- nothing held them before. Those are the LIVE ones, edited freely. The copy on
-- the invoice is what that bill was issued with.
--
-- Nothing here changes an existing invoice. Every column is nullable or has a
-- default, and the read path falls back to what it showed before when they are
-- empty, so old invoices keep reprinting exactly as they were issued.
--
-- Run by hand against Neon, like every other file in this directory.

-- The seller, as printed. Rule 46 wants name, address and GSTIN, and the state
-- code is what an e-invoice is validated on.
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS seller_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS seller_gstin VARCHAR(20),
    ADD COLUMN IF NOT EXISTS seller_address TEXT,
    ADD COLUMN IF NOT EXISTS seller_city VARCHAR(100),
    ADD COLUMN IF NOT EXISTS seller_state VARCHAR(100),
    ADD COLUMN IF NOT EXISTS seller_state_code VARCHAR(2),
    ADD COLUMN IF NOT EXISTS seller_pincode VARCHAR(10),
    ADD COLUMN IF NOT EXISTS seller_phone VARCHAR(20);

-- The recipient block already holds name, GSTIN, city, address and phone. This
-- finishes it, because an e-invoice is rejected without the state code.
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS recipient_state VARCHAR(100),
    ADD COLUMN IF NOT EXISTS recipient_state_code VARCHAR(2),
    ADD COLUMN IF NOT EXISTS recipient_pincode VARCHAR(10);

-- Where the goods actually left from, which is not always the registered
-- address. A wholesaler registered in Surat despatching from a Bhiwandi
-- godown has to say so.
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS dispatch_from_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS dispatch_from_address TEXT,
    ADD COLUMN IF NOT EXISTS dispatch_from_city VARCHAR(100),
    ADD COLUMN IF NOT EXISTS dispatch_from_state VARCHAR(100),
    ADD COLUMN IF NOT EXISTS dispatch_from_state_code VARCHAR(2),
    ADD COLUMN IF NOT EXISTS dispatch_from_pincode VARCHAR(10);

-- Where the goods are going, which is not always the registered address of the
-- firm being billed. Bill to one office, ship to another godown.
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS ship_to_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS ship_to_gstin VARCHAR(20),
    ADD COLUMN IF NOT EXISTS ship_to_address TEXT,
    ADD COLUMN IF NOT EXISTS ship_to_city VARCHAR(100),
    ADD COLUMN IF NOT EXISTS ship_to_state VARCHAR(100),
    ADD COLUMN IF NOT EXISTS ship_to_state_code VARCHAR(2),
    ADD COLUMN IF NOT EXISTS ship_to_pincode VARCHAR(10);

-- The goods receipt the transporter issued, written on the bill so the two can
-- be matched later.
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS gr_number VARCHAR(50),
    ADD COLUMN IF NOT EXISTS gr_date DATE;

-- The bank the wholesaler wants paying into, as it stood when the bill went
-- out. Not a secret. These are printed on the document on purpose.
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS bank_account_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS bank_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS bank_account_number VARCHAR(40),
    ADD COLUMN IF NOT EXISTS bank_ifsc VARCHAR(20),
    ADD COLUMN IF NOT EXISTS bank_branch VARCHAR(255);

-- The e-way bill fields. They are on the invoice because that is where a
-- wholesaler fills them in, and an e-way bill payload is built from them.
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS transporter_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS transporter_id VARCHAR(20),
    ADD COLUMN IF NOT EXISTS transport_mode VARCHAR(10),
    ADD COLUMN IF NOT EXISTS vehicle_number VARCHAR(20),
    ADD COLUMN IF NOT EXISTS transport_doc_number VARCHAR(50),
    ADD COLUMN IF NOT EXISTS transport_doc_date DATE;

-- Dropped first so this file can be run twice.
ALTER TABLE invoices
    DROP CONSTRAINT IF EXISTS invoices_transport_mode_check;

ALTER TABLE invoices
    ADD CONSTRAINT invoices_transport_mode_check
    CHECK (transport_mode IS NULL OR transport_mode IN ('road', 'rail', 'air', 'ship'));

-- What the Invoice Registration Portal gives back, and nothing this product can
-- work out for itself. An IRN is issued, and the QR is a payload the IRP signs.
-- Anything computed locally is not valid, so these stay empty until a real
-- submission fills them.
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS irn VARCHAR(64),
    ADD COLUMN IF NOT EXISTS ack_number VARCHAR(30),
    ADD COLUMN IF NOT EXISTS ack_date TIMESTAMP,
    ADD COLUMN IF NOT EXISTS signed_qr TEXT,
    ADD COLUMN IF NOT EXISTS einvoice_status VARCHAR(20) NOT NULL DEFAULT 'not_applicable';

ALTER TABLE invoices
    DROP CONSTRAINT IF EXISTS invoices_einvoice_status_check;

ALTER TABLE invoices
    ADD CONSTRAINT invoices_einvoice_status_check
    CHECK (einvoice_status IN ('not_applicable', 'pending', 'generated', 'cancelled', 'failed'));

-- Cess is an additional levy on top of GST on particular goods, not a share of
-- it, so it is its own total and does not come out of the GST figure. Nothing
-- writes these yet. Phase 6 does, and phase 6 is also where every reader of
-- grand_total has to be made to agree with them.
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS total_cess NUMERIC(12, 2) NOT NULL DEFAULT 0.00;

-- Per line: the unit as GST will accept it, and that line's cess.
--
-- uqc is a plain column with no foreign key onto master_uqc, deliberately. An
-- invoice line is a frozen record of what was billed. Pointing it at a table
-- somebody can edit is the same mistake as joining the addresses, and it would
-- let a change to a master stop an invoice being written.
ALTER TABLE invoice_items
    ADD COLUMN IF NOT EXISTS uqc VARCHAR(3),
    ADD COLUMN IF NOT EXISTS cess_percent NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS cess_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00;

-- The live bank details, which the copy on each invoice is taken from. These
-- are edited whenever the wholesaler likes. The invoice keeps what it was
-- issued with.
ALTER TABLE invoice_settings
    ADD COLUMN IF NOT EXISTS bank_account_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS bank_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS bank_account_number VARCHAR(40),
    ADD COLUMN IF NOT EXISTS bank_ifsc VARCHAR(20),
    ADD COLUMN IF NOT EXISTS bank_branch VARCHAR(255);

-- The registered address a wholesaler bills from, which the warehouse columns
-- do not cover: a firm can be registered at one address and despatch from
-- another, and only the registered one belongs in the seller block.
ALTER TABLE wholesaler_profiles
    ADD COLUMN IF NOT EXISTS registered_address TEXT,
    ADD COLUMN IF NOT EXISTS registered_state VARCHAR(100),
    ADD COLUMN IF NOT EXISTS registered_pincode VARCHAR(10);

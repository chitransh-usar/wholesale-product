-- Enterprise Invoice Management System Tables

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Table 1: Invoices Sequence Table for atomic unique invoice numbering (INV-YYYY-XXXXXX)
CREATE TABLE IF NOT EXISTS invoice_sequences (
    year INTEGER PRIMARY KEY,
    last_number INTEGER DEFAULT 0
);

-- Table 2: Main Invoices Table
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    buyer_id UUID REFERENCES users(id) ON DELETE CASCADE,
    supplier_id UUID REFERENCES users(id) ON DELETE CASCADE,
    subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    discount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    shipping_charge NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    taxable_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    cgst NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    sgst NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    igst NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total_tax NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    grand_total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    payment_status VARCHAR(50) DEFAULT 'Pending',
    invoice_status VARCHAR(50) DEFAULT 'Generated',
    issue_date DATE DEFAULT CURRENT_DATE,
    due_date DATE,
    notes TEXT,
    terms_conditions TEXT,
    pdf_path TEXT,
    pdf_url TEXT,
    email_sent BOOLEAN DEFAULT FALSE,
    email_sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Schema Migrations if table pre-exists
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS pdf_path TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS email_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMP;

-- Table 3: Invoice Line Items Table
CREATE TABLE IF NOT EXISTS invoice_items (
    id SERIAL PRIMARY KEY,
    invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    product_name VARCHAR(255) NOT NULL,
    hsn_code VARCHAR(50) DEFAULT '8504',
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    gst_percent NUMERIC(5, 2) DEFAULT 18.00,
    tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total NUMERIC(12, 2) NOT NULL DEFAULT 0.00
);

-- Table 4: Invoice Payments Table
CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    payment_method VARCHAR(50) NOT NULL,
    transaction_id VARCHAR(100),
    payment_reference VARCHAR(100),
    paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    remarks TEXT
);

-- Table 5: Invoice Activity Logs Table
CREATE TABLE IF NOT EXISTS invoice_logs (
    id SERIAL PRIMARY KEY,
    invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL,
    performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    recipient_email VARCHAR(255),
    smtp_response TEXT,
    error_logs TEXT,
    details TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_invoices_order_id ON invoices(order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_buyer_id ON invoices(buyer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_supplier_id ON invoices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_number ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_payment_status ON invoices(payment_status);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_status ON invoices(invoice_status);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_logs_invoice_id ON invoice_logs(invoice_id);

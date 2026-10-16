-- More than one account on the same marketplace, each with its own run of
-- bill numbers.
--
-- A wholesaler with two Amazon seller accounts gets two settlement reports,
-- and each has to be matched against its own run. So an extra account is one
-- more book: its own prefix and its own counter in invoice_sequences, which
-- is already keyed by series. The built in Amazon and Flipkart books are the
-- first account on each and are not touched.
--
-- REWRITTEN 24 Sept. The 22 Sept version of this file also gave every account
-- its own run of SALE and ORDER numbers, by adding a series column to
-- sale_sequences and order_sequences. Orders were put on one run on 19 Sept on
-- purpose, and two counters that both print SO/ hand out SO/1/26-27 twice. So
-- this version takes that back out if it went in, and is safe to run whether
-- or not the old version was ever run, and more than once.
--
-- Written for a SQL editor that splits on semicolons. No DO blocks, and no
-- semicolon inside any comment.
--
-- Run by hand against Neon, like every other file in this directory.

-- 1. The accounts.
CREATE TABLE IF NOT EXISTS marketplace_linkages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wholesaler_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    marketplace VARCHAR(32) NOT NULL,
    linkage_name VARCHAR(100) NOT NULL,
    code VARCHAR(16) NOT NULL,
    invoice_prefix VARCHAR(10) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Left over from the 22 Sept version. The sale and order prefixes are gone
-- with the runs they numbered, and the suffix and padding come from the
-- wholesaler's own invoice settings, as they do for the built in books.
ALTER TABLE marketplace_linkages DROP COLUMN IF EXISTS sale_prefix;
ALTER TABLE marketplace_linkages DROP COLUMN IF EXISTS order_prefix;
ALTER TABLE marketplace_linkages DROP COLUMN IF EXISTS number_suffix;
ALTER TABLE marketplace_linkages DROP COLUMN IF EXISTS number_pad_to;

CREATE UNIQUE INDEX IF NOT EXISTS idx_linkage_wholesaler_code
    ON marketplace_linkages (wholesaler_id, code);

CREATE INDEX IF NOT EXISTS idx_linkage_wholesaler_active
    ON marketplace_linkages (wholesaler_id, is_active);

COMMENT ON TABLE marketplace_linkages IS
    'A wholesaler''s extra Amazon or Flipkart accounts. Each is its own run of invoice numbers, and nothing else.';

-- 2. A sale and a bill can name an account, so the old list of four is
-- widened to the four plus an account code such as amazon-2. NOT VALID so a
-- row written under the 22 Sept version with a code of another shape does
-- not stop the file. New rows are still checked.
ALTER TABLE IF EXISTS sales
    DROP CONSTRAINT IF EXISTS sales_channel_check;

ALTER TABLE IF EXISTS sales
    ADD CONSTRAINT sales_channel_check
    CHECK (channel IN ('counter', 'shop', 'flipkart', 'amazon')
           OR channel ~ '^(amazon|flipkart)-[0-9]{1,4}$') NOT VALID;

ALTER TABLE IF EXISTS invoices
    DROP CONSTRAINT IF EXISTS invoices_channel_check;

ALTER TABLE IF EXISTS invoices
    ADD CONSTRAINT invoices_channel_check
    CHECK (channel IS NULL
           OR channel IN ('counter', 'shop', 'flipkart', 'amazon')
           OR channel ~ '^(amazon|flipkart)-[0-9]{1,4}$') NOT VALID;

-- 3. An order can say which book it belongs to, so the sale and the bill it
-- becomes land in that run. It does not choose the order NUMBER. Null means
-- where it came from decides: a shop order is the shop, a typed one is the
-- counter. No default, because a default of shop, which the 22 Sept version
-- had, filed every phone order under the shop.
ALTER TABLE IF EXISTS orders
    ADD COLUMN IF NOT EXISTS channel VARCHAR(16);

ALTER TABLE IF EXISTS orders
    ALTER COLUMN channel DROP DEFAULT;

UPDATE orders SET channel = NULL WHERE channel = 'shop';

-- 4. One run of sale numbers and one run of order numbers again, if the
-- 22 Sept version split them. Where it did, a wholesaler has more than one
-- counter row for a year. The highest is kept, so the next number is past
-- every number already issued in any of them. On a database the old version
-- never touched there is one row per year and nothing is deleted.
DELETE FROM sale_sequences a
 USING sale_sequences b
 WHERE a.wholesaler_id = b.wholesaler_id
   AND a.financial_year = b.financial_year
   AND (a.last_number < b.last_number
        OR (a.last_number = b.last_number AND a.ctid < b.ctid));

ALTER TABLE sale_sequences DROP CONSTRAINT IF EXISTS sale_sequences_pkey;
ALTER TABLE sale_sequences DROP COLUMN IF EXISTS series;
ALTER TABLE sale_sequences ADD CONSTRAINT sale_sequences_pkey PRIMARY KEY (wholesaler_id, financial_year);

DELETE FROM order_sequences a
 USING order_sequences b
 WHERE a.wholesaler_id = b.wholesaler_id
   AND a.financial_year = b.financial_year
   AND (a.last_number < b.last_number
        OR (a.last_number = b.last_number AND a.ctid < b.ctid));

ALTER TABLE order_sequences DROP CONSTRAINT IF EXISTS order_sequences_pkey;
ALTER TABLE order_sequences DROP COLUMN IF EXISTS series;
ALTER TABLE order_sequences ADD CONSTRAINT order_sequences_pkey PRIMARY KEY (wholesaler_id, financial_year);

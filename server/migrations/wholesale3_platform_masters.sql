-- Platform masters, and the super admin who owns them.
--
-- A master is a thing that EXISTS, as against a transaction, which is a thing
-- that HAPPENS. Everything here belongs to the PLATFORM rather than to any one
-- wholesaler: the state list, the units, the tax slabs, the HSN codes. Today
-- each of them is a constant in the code, so correcting one is a deploy.
--
-- WHAT THIS DOES NOT DO. It does not switch anything over. Every reader keeps
-- its constant as a fallback and probes for these tables the same way the rest
-- of this codebase probes for a migration it cannot assume has been run. Until
-- this file is applied the product behaves exactly as it does today. After it
-- is applied the tables win. Migrations here are run by hand, so code shipping
-- before its SQL is the normal case and not an edge one.
--
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. The super admin
-- ---------------------------------------------------------------------------
--
-- A flag, not a fourth role. users.role carries a CHECK allowing buyer, seller
-- and both, and an admin is not a fourth kind of trader: he is a person with
-- one extra permission. Widening that enum would put every `role = 'seller'`
-- test in the codebase back in question for no gain.
--
-- promotionController already tests for role 'admin', which the constraint can
-- never contain, so that code has been unreachable rather than merely unbuilt.
-- It reads this flag now.
--
-- There is no way to make the FIRST admin from inside the product, by design.
-- Bootstrap it by hand, once, the same way these migrations are run:
--
--   UPDATE users SET is_platform_admin = TRUE WHERE email = 'you@example.com';

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_platform_admin
  ON users(is_platform_admin) WHERE is_platform_admin;

-- ---------------------------------------------------------------------------
-- 2. The masters
-- ---------------------------------------------------------------------------
--
-- Every one carries `active` rather than being deleted. A unit or an HSN code
-- in use on an invoice already issued must not vanish from that document
-- because somebody tidied a list a year later.

-- States and union territories, with the two digit code that opens every
-- GSTIN. This code is what decides CGST plus SGST against IGST, so it is a
-- number on a legal document rather than a label.
CREATE TABLE IF NOT EXISTS master_states (
    code                 CHAR(2) PRIMARY KEY,
    name                 VARCHAR(100) NOT NULL UNIQUE,
    -- Factual, and recorded because the state list distinguishes them. NOTHING
    -- computes UTGST today: a union territory is billed CGST plus SGST like
    -- anywhere else in this product. The column is here so that when UTGST is
    -- built it has a source, not because it is already wired.
    is_union_territory   BOOLEAN NOT NULL DEFAULT FALSE,
    active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- How goods are counted. Cloth by the metre, oil by the litre, and a wholesaler
-- who sells in bales needs the word bale.
CREATE TABLE IF NOT EXISTS master_units (
    code        VARCHAR(16) PRIMARY KEY,
    name        VARCHAR(64) NOT NULL,
    -- Whether a fraction of this unit makes sense. 2.5 metres does. 2.5 pieces
    -- does not. Nothing enforces it yet. It is here for the screens that will.
    allows_decimals BOOLEAN NOT NULL DEFAULT TRUE,
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The GST slabs actually in force. A fixed list rather than a free number box,
-- because a rate that is not a real slab is a rejected return later.
CREATE TABLE IF NOT EXISTS master_tax_rates (
    rate        NUMERIC(5, 2) PRIMARY KEY CHECK (rate >= 0 AND rate <= 100),
    label       VARCHAR(32) NOT NULL,
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- HSN codes and what they describe.
--
-- CODES AND DESCRIPTIONS ONLY. There is no rate column here and there must
-- never be one: rates change, and the same heading carries different rates by
-- price slab. Anything that maps an HSN to a GST rate is inventing a number
-- somebody will put on a tax document.
--
-- `source` says where a row came from. 'curated' is the short textile list this
-- product has always shipped, labelled as common rather than as verified;
-- 'admin' is a row a platform admin added. Suggestions drawn from a
-- wholesaler's own history are not stored here at all, because those are his.
CREATE TABLE IF NOT EXISTS master_hsn (
    code        VARCHAR(8) PRIMARY KEY CHECK (code ~ '^[0-9]{4}([0-9]{2}([0-9]{2})?)?$'),
    description TEXT NOT NULL,
    source      VARCHAR(16) NOT NULL DEFAULT 'curated'
                CHECK (source IN ('curated', 'admin')),
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 3. Seed, from the constants the code uses today
-- ---------------------------------------------------------------------------
--
-- Generated from the running constants rather than typed out, so the tables
-- cannot start life disagreeing with the code that is still falling back to
-- them. ON CONFLICT DO NOTHING throughout: re-running this must not undo an
-- admin's later correction.

INSERT INTO master_states (code, name, is_union_territory) VALUES
  ('01', 'Jammu and Kashmir', true),
  ('02', 'Himachal Pradesh', false),
  ('03', 'Punjab', false),
  ('04', 'Chandigarh', true),
  ('05', 'Uttarakhand', false),
  ('06', 'Haryana', false),
  ('07', 'Delhi', true),
  ('08', 'Rajasthan', false),
  ('09', 'Uttar Pradesh', false),
  ('10', 'Bihar', false),
  ('11', 'Sikkim', false),
  ('12', 'Arunachal Pradesh', false),
  ('13', 'Nagaland', false),
  ('14', 'Manipur', false),
  ('15', 'Mizoram', false),
  ('16', 'Tripura', false),
  ('17', 'Meghalaya', false),
  ('18', 'Assam', false),
  ('19', 'West Bengal', false),
  ('20', 'Jharkhand', false),
  ('21', 'Odisha', false),
  ('22', 'Chhattisgarh', false),
  ('23', 'Madhya Pradesh', false),
  ('24', 'Gujarat', false),
  ('25', 'Daman and Diu', true),
  ('26', 'Dadra and Nagar Haveli and Daman and Diu', true),
  ('27', 'Maharashtra', false),
  ('28', 'Andhra Pradesh', false),
  ('29', 'Karnataka', false),
  ('30', 'Goa', false),
  ('31', 'Lakshadweep', true),
  ('32', 'Kerala', false),
  ('33', 'Tamil Nadu', false),
  ('34', 'Puducherry', true),
  ('35', 'Andaman and Nicobar Islands', true),
  ('36', 'Telangana', false),
  ('38', 'Ladakh', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO master_units (code, name, allows_decimals, sort_order) VALUES
  ('pcs',    'Pieces',    FALSE, 10),
  ('dozen',  'Dozen',     FALSE, 20),
  ('case',   'Case',      FALSE, 30),
  ('mtr',    'Metre',     TRUE,  40),
  ('kg',     'Kilogram',  TRUE,  50),
  ('box',    'Box',       FALSE, 60),
  ('bundle', 'Bundle',    FALSE, 70)
ON CONFLICT (code) DO NOTHING;

-- 0.25 and 3 are narrow but real: rough diamonds sit at 0.25, gold and silver
-- at 3. They are in the client constant already and are kept.
INSERT INTO master_tax_rates (rate, label) VALUES
  (0.00,  'Nil'),
  (0.25,  'GST 0.25%'),
  (3.00,  'GST 3%'),
  (5.00,  'GST 5%'),
  (12.00, 'GST 12%'),
  (18.00, 'GST 18%'),
  (28.00, 'GST 28%')
ON CONFLICT (rate) DO NOTHING;

INSERT INTO master_hsn (code, description, source) VALUES
  ('5007', 'Woven fabrics of silk', 'curated'),
  ('5111', 'Woven fabrics of carded wool', 'curated'),
  ('5112', 'Woven fabrics of combed wool', 'curated'),
  ('5205', 'Cotton yarn, 85% or more cotton', 'curated'),
  ('5208', 'Cotton fabric, light, 85% or more cotton', 'curated'),
  ('5209', 'Cotton fabric, heavy, 85% or more cotton', 'curated'),
  ('5210', 'Cotton fabric mixed with man made fibres', 'curated'),
  ('5407', 'Woven fabrics of synthetic filament yarn', 'curated'),
  ('5408', 'Woven fabrics of artificial filament yarn', 'curated'),
  ('5512', 'Fabric of synthetic staple fibres, 85% or more', 'curated'),
  ('5513', 'Synthetic staple fabric mixed with cotton, light', 'curated'),
  ('5514', 'Synthetic staple fabric mixed with cotton, heavy', 'curated'),
  ('5801', 'Woven pile fabrics, velvet and corduroy', 'curated'),
  ('5804', 'Lace and net fabrics', 'curated'),
  ('5806', 'Narrow woven fabrics, tape and ribbon', 'curated'),
  ('5810', 'Embroidery in the piece', 'curated'),
  ('6001', 'Knitted or crocheted pile fabrics', 'curated'),
  ('6006', 'Other knitted or crocheted fabrics', 'curated'),
  ('6104', 'Women''s suits, dresses and skirts, knitted', 'curated'),
  ('6109', 'T shirts and vests, knitted', 'curated'),
  ('6110', 'Jerseys, pullovers and cardigans, knitted', 'curated'),
  ('6203', 'Men''s suits, jackets and trousers, not knitted', 'curated'),
  ('6204', 'Women''s suits, dresses and skirts, not knitted', 'curated'),
  ('6205', 'Men''s shirts, not knitted', 'curated'),
  ('6206', 'Women''s blouses and shirts, not knitted', 'curated'),
  ('6211', 'Track suits and other garments', 'curated'),
  ('6214', 'Shawls, scarves, dupattas and stoles', 'curated'),
  ('6302', 'Bed linen, table linen and towels', 'curated'),
  ('6303', 'Curtains and blinds', 'curated'),
  ('6304', 'Other furnishing articles, covers and cushions', 'curated'),
  ('6305', 'Sacks and bags for packing goods', 'curated'),
  ('6310', 'Rags and used textile pieces', 'curated')
ON CONFLICT (code) DO NOTHING;

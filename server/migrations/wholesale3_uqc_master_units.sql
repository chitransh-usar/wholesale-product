-- Unique Quantity Codes on the units master.
--
-- A UQC is the unit as the GST system will accept it. It is required on an
-- e-invoice, on an e-way bill, and in the HSN summary of GSTR-1. The units
-- master holds the word a wholesaler actually uses, such as Bundle or Case.
-- This adds the code that word has to be filed as.
--
-- Two tables, on purpose. master_uqc is the list of codes that exist, which
-- nobody edits. master_units.uqc is which of those codes each unit files as,
-- which somebody does edit, and which may be blank.
--
-- PROVENANCE. The codes below are the published UQC list as used by the GSTR-1
-- and e-invoice schemas. They have not been read off the GST portal by this
-- migration, so treat the list the same way hsnService treats its curated HSN
-- list: good enough to fill a dropdown and to validate against, and to be
-- checked against the portal before the first live e-invoice is submitted.

CREATE TABLE IF NOT EXISTS master_uqc (
    code        VARCHAR(3) PRIMARY KEY,
    description VARCHAR(64) NOT NULL,
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO master_uqc (code, description) VALUES
  ('BAG', 'Bags'),
  ('BAL', 'Bale'),
  ('BDL', 'Bundles'),
  ('BKL', 'Buckles'),
  ('BOU', 'Billion of units'),
  ('BOX', 'Box'),
  ('BTL', 'Bottles'),
  ('BUN', 'Bunches'),
  ('CAN', 'Cans'),
  ('CBM', 'Cubic metres'),
  ('CCM', 'Cubic centimetres'),
  ('CMS', 'Centimetres'),
  ('CTN', 'Cartons'),
  ('DOZ', 'Dozens'),
  ('DRM', 'Drums'),
  ('GGK', 'Great gross'),
  ('GMS', 'Grammes'),
  ('GRS', 'Gross'),
  ('GYD', 'Gross yards'),
  ('KGS', 'Kilograms'),
  ('KLR', 'Kilolitre'),
  ('KME', 'Kilometre'),
  ('MLT', 'Millilitre'),
  ('MTR', 'Metres'),
  ('MTS', 'Metric ton'),
  ('NOS', 'Numbers'),
  ('PAC', 'Packs'),
  ('PCS', 'Pieces'),
  ('PRS', 'Pairs'),
  ('QTL', 'Quintal'),
  ('ROL', 'Rolls'),
  ('SET', 'Sets'),
  ('SQF', 'Square feet'),
  ('SQM', 'Square metres'),
  ('SQY', 'Square yards'),
  ('TBS', 'Tablets'),
  ('TGM', 'Ten gross'),
  ('THD', 'Thousands'),
  ('TON', 'Tonnes'),
  ('TUB', 'Tubes'),
  ('UGS', 'US gallons'),
  ('UNT', 'Units'),
  ('YDS', 'Yards'),
  ('OTH', 'Others')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE IF EXISTS master_units
  ADD COLUMN IF NOT EXISTS uqc VARCHAR(3);

COMMENT ON COLUMN master_units.uqc IS
  'The GST Unique Quantity Code this unit is filed as. NULL means nobody has decided yet, which is not the same as OTH.';

-- Only the units whose code is the same thing the GST list means by it.
--
-- Nothing is guessed here, and nothing is defaulted to OTH. OTH is a real
-- answer, and for a unit like Case it may well be the right one, but it is a
-- declaration to the tax system that the unit has no standard code. A
-- wholesaler should make that choice on the Administration screen and see it
-- recorded, rather than have a migration make it silently on their behalf and
-- have nobody ever look again.
--
-- Case is the deliberate omission. There is no CAS code, and BOX, CTN and PAC
-- are all guesses at what a given trade means by a case.
UPDATE master_units AS u
SET uqc = m.uqc
FROM (VALUES
  ('pcs',    'PCS'),
  ('dozen',  'DOZ'),
  ('mtr',    'MTR'),
  ('kg',     'KGS'),
  ('box',    'BOX'),
  ('bundle', 'BDL')
) AS m(code, uqc)
WHERE LOWER(u.code) = m.code AND u.uqc IS NULL;

-- Undo the earlier silent guess, so this file lands in the same state whether
-- or not the first version of it was ever run. Case goes back to blank and
-- shows up as needing a decision.
--
-- Only where it still holds BOX, which is exactly what the first version wrote.
-- Once somebody has chosen on the Administration screen, including choosing
-- OTH, that is a decision and re-running this file must not undo it.
UPDATE master_units
SET uqc = NULL
WHERE LOWER(code) = 'case' AND uqc = 'BOX';

-- A unit cannot carry a code that is not on the list. Dropped first so the file
-- can be run twice.
ALTER TABLE IF EXISTS master_units
  DROP CONSTRAINT IF EXISTS master_units_uqc_fkey;

ALTER TABLE IF EXISTS master_units
  ADD CONSTRAINT master_units_uqc_fkey
  FOREIGN KEY (uqc) REFERENCES master_uqc(code);

-- =====================================================
-- RETIRE THE VANITY METRICS
--
-- trust_score and response_rate were read in eight places and written in
-- none, so every seller showed the same '0%' forever. They are now replaced
-- everywhere by figures counted from real rows: revenue, orders delivered,
-- catalogue size and seller_reviews ratings.
--
-- The columns are left in place here rather than dropped, because dropping
-- them cannot be undone and nothing breaks by leaving them. Once you are
-- happy that no environment still reads them, run the DROP block at the
-- bottom by hand.
--
-- The ADD COLUMN statements below are the important part: profile fields the
-- wholesaler page already selects but that no migration ever created, so a
-- database built from these migrations alone would fail that query.
-- =====================================================

ALTER TABLE wholesaler_profiles
  ADD COLUMN IF NOT EXISTS gst_verified      BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS years_in_business INTEGER;

COMMENT ON COLUMN wholesaler_profiles.gst_verified IS 'True once the GSTIN on file has been checked';
COMMENT ON COLUMN wholesaler_profiles.years_in_business IS 'Self-reported trading history, shown on the public profile';

-- Optional cleanup, run manually when you are ready:
--
--   ALTER TABLE wholesaler_profiles
--     DROP COLUMN IF EXISTS trust_score,
--     DROP COLUMN IF EXISTS response_rate,
--     DROP COLUMN IF EXISTS response_time;

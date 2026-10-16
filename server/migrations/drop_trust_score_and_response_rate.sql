-- Drop vanity metrics trust_score and response_rate from wholesaler_profiles
ALTER TABLE wholesaler_profiles
  DROP COLUMN IF EXISTS trust_score,
  DROP COLUMN IF EXISTS response_rate;

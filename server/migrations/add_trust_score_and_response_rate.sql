-- Add missing trust_score, response_rate, response_time to wholesaler_profiles
ALTER TABLE wholesaler_profiles
ADD COLUMN IF NOT EXISTS trust_score VARCHAR(10) DEFAULT '95%',
ADD COLUMN IF NOT EXISTS response_rate VARCHAR(10) DEFAULT '98%',
ADD COLUMN IF NOT EXISTS response_time VARCHAR(50) DEFAULT '< 2 hrs';

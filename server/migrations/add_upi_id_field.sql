-- Add upi_id column to wholesaler_profiles table if it doesn't exist
ALTER TABLE wholesaler_profiles 
ADD COLUMN IF NOT EXISTS upi_id VARCHAR(100);

-- Add comment for documentation
COMMENT ON COLUMN wholesaler_profiles.upi_id IS 'UPI ID for receiving payments from buyers (e.g., merchant@upi)';

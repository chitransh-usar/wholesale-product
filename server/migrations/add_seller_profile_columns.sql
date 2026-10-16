-- Add missing seller profile columns if they do not exist
ALTER TABLE wholesaler_profiles
ADD COLUMN IF NOT EXISTS company_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS gstin VARCHAR(50),
ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(20),
ADD COLUMN IF NOT EXISTS city VARCHAR(100) DEFAULT 'Delhi',
ADD COLUMN IF NOT EXISTS country VARCHAR(100) DEFAULT 'India',
ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

COMMENT ON COLUMN wholesaler_profiles.company_name IS 'Company or business name for seller profile';
COMMENT ON COLUMN wholesaler_profiles.gstin IS 'GSTIN for seller verification';
COMMENT ON COLUMN wholesaler_profiles.contact_phone IS 'Seller contact phone number';
COMMENT ON COLUMN wholesaler_profiles.city IS 'Seller city';
COMMENT ON COLUMN wholesaler_profiles.country IS 'Seller country';
COMMENT ON COLUMN wholesaler_profiles.is_verified IS 'Seller verification flag';
COMMENT ON COLUMN wholesaler_profiles.updated_at IS 'Last update timestamp for seller profile';

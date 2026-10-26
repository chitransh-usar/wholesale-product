ALTER TABLE public.wholesaler_profiles
    ADD COLUMN IF NOT EXISTS bank_account_number VARCHAR(40),
    ADD COLUMN IF NOT EXISTS bank_ifsc VARCHAR(20),
    ADD COLUMN IF NOT EXISTS bank_branch VARCHAR(255);

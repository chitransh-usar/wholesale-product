CREATE TABLE IF NOT EXISTS public.wholesaler_profiles (
    company_name VARCHAR(255),
    gstin VARCHAR(50),
    is_verified BOOLEAN DEFAULT false,
    upi_id VARCHAR(100),
    city VARCHAR(100) DEFAULT 'Delhi',
    country VARCHAR(100) DEFAULT 'India',
    gst_verified BOOLEAN DEFAULT false,
    years_in_business INTEGER DEFAULT 0,
    contact_phone VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    user_id UUID,
    lat NUMERIC(10,7),
    lng NUMERIC(10,7),
    geocoded_at TIMESTAMP,
    warehouse_address TEXT,
    warehouse_city VARCHAR(100),
    warehouse_state VARCHAR(100),
    warehouse_pincode VARCHAR(10),
    warehouse_pinned BOOLEAN DEFAULT false,
    registered_address TEXT,
    registered_state VARCHAR(100),
    registered_pincode VARCHAR(10),
    razorpay_account_id VARCHAR(40),
    razorpay_kyc_status VARCHAR(30) NOT NULL DEFAULT 'not_started',
    razorpay_status_note TEXT,
    razorpay_onboarded_at TIMESTAMP,
    razorpay_checked_at TIMESTAMP,
    CONSTRAINT wholesaler_profiles_pkey PRIMARY KEY (id),
    CONSTRAINT wholesaler_profiles_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
    CONSTRAINT wholesaler_profiles_razorpay_kyc_status_check
        CHECK (razorpay_kyc_status IN (
            'not_started',
            'created',
            'under_review',
            'needs_clarification',
            'activated',
            'suspended'
        ))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wholesaler_razorpay_account
    ON public.wholesaler_profiles (razorpay_account_id)
    WHERE razorpay_account_id IS NOT NULL;

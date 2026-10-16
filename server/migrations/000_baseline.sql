-- Schema baseline. Generated, do not edit by hand.
--     node scripts/dump_schema.js
--
-- Structure only: no rows were read. This exists so the schema can
-- be rebuilt locally and migrations tested before they touch the
-- live database.
--
-- Source: PostgreSQL 18.6 (3484359)
-- Taken:  2026-08-27

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SEQUENCE IF NOT EXISTS coupon_usage_id_seq;
CREATE SEQUENCE IF NOT EXISTS coupons_id_seq;
CREATE SEQUENCE IF NOT EXISTS credit_note_items_id_seq;
CREATE SEQUENCE IF NOT EXISTS device_tokens_id_seq;
CREATE SEQUENCE IF NOT EXISTS flash_sale_products_id_seq;
CREATE SEQUENCE IF NOT EXISTS flash_sales_id_seq;
CREATE SEQUENCE IF NOT EXISTS gift_card_transactions_id_seq;
CREATE SEQUENCE IF NOT EXISTS gift_cards_id_seq;
CREATE SEQUENCE IF NOT EXISTS inventory_log_id_seq;
CREATE SEQUENCE IF NOT EXISTS invoice_items_id_seq;
CREATE SEQUENCE IF NOT EXISTS invoice_logs_id_seq;
CREATE SEQUENCE IF NOT EXISTS loyalty_accounts_id_seq;
CREATE SEQUENCE IF NOT EXISTS loyalty_transactions_id_seq;
CREATE SEQUENCE IF NOT EXISTS notification_logs_id_seq;
CREATE SEQUENCE IF NOT EXISTS notification_preferences_id_seq;
CREATE SEQUENCE IF NOT EXISTS notifications_id_seq;
CREATE SEQUENCE IF NOT EXISTS order_analytics_id_seq;
CREATE SEQUENCE IF NOT EXISTS order_items_id_seq;
CREATE SEQUENCE IF NOT EXISTS order_status_history_id_seq;
CREATE SEQUENCE IF NOT EXISTS payment_transactions_id_seq;
CREATE SEQUENCE IF NOT EXISTS payments_id_seq;
CREATE SEQUENCE IF NOT EXISTS referral_rewards_id_seq;
CREATE SEQUENCE IF NOT EXISTS referrals_id_seq;
CREATE SEQUENCE IF NOT EXISTS return_requests_id_seq;
CREATE SEQUENCE IF NOT EXISTS shipments_id_seq;
CREATE SEQUENCE IF NOT EXISTS wishlist_notifications_id_seq;

-- 54 table(s)

CREATE TABLE IF NOT EXISTS coupon_usage (
    id integer DEFAULT nextval('coupon_usage_id_seq'::regclass) NOT NULL,
    coupon_id integer,
    created_at timestamp with time zone DEFAULT now(),
    user_id uuid,
    order_id uuid
);

CREATE TABLE IF NOT EXISTS coupons (
    id integer DEFAULT nextval('coupons_id_seq'::regclass) NOT NULL,
    code character varying(50) NOT NULL,
    title character varying(255),
    coupon_type character varying(50) DEFAULT 'percentage'::character varying,
    discount_type character varying(50) DEFAULT 'percentage'::character varying,
    value numeric(10,2) NOT NULL,
    max_discount_amount numeric(10,2) DEFAULT 0,
    min_order_amount numeric(10,2) DEFAULT 0,
    max_usage integer DEFAULT 100,
    per_user_usage integer DEFAULT 1,
    start_date timestamp with time zone DEFAULT now(),
    end_date timestamp with time zone NOT NULL,
    is_active boolean DEFAULT true,
    first_order_only boolean DEFAULT false,
    new_customer_only boolean DEFAULT false,
    loyalty_only boolean DEFAULT false,
    category character varying(100),
    created_at timestamp with time zone DEFAULT now(),
    supplier_id uuid,
    created_by uuid,
    product_id uuid
);

CREATE TABLE IF NOT EXISTS credit_account_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id uuid NOT NULL,
    party_id uuid NOT NULL,
    action character varying(40) NOT NULL,
    old_values jsonb NOT NULL,
    new_values jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS credit_note_items (
    id integer DEFAULT nextval('credit_note_items_id_seq'::regclass) NOT NULL,
    credit_note_id uuid NOT NULL,
    item_name character varying(255) NOT NULL,
    hsn_code character varying(50),
    quantity numeric(12,3) DEFAULT 1 NOT NULL,
    unit character varying(20),
    unit_price numeric(12,2) DEFAULT 0.00 NOT NULL,
    gst_percent numeric(5,2) DEFAULT 0.00 NOT NULL,
    tax_amount numeric(12,2) DEFAULT 0.00 NOT NULL,
    total numeric(12,2) DEFAULT 0.00 NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS credit_note_sequences (
    wholesaler_id uuid NOT NULL,
    last_number integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS credit_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    wholesaler_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    sale_id uuid,
    party_id uuid,
    note_number character varying(50) NOT NULL,
    reason character varying(30) DEFAULT 'sale_cancelled'::character varying NOT NULL,
    reason_note text,
    recipient_name character varying(255),
    recipient_gstin character varying(20),
    recipient_city character varying(100),
    recipient_address text,
    recipient_phone character varying(20),
    subtotal numeric(12,2) DEFAULT 0.00 NOT NULL,
    discount numeric(12,2) DEFAULT 0.00 NOT NULL,
    taxable_amount numeric(12,2) DEFAULT 0.00 NOT NULL,
    cgst numeric(12,2) DEFAULT 0.00 NOT NULL,
    sgst numeric(12,2) DEFAULT 0.00 NOT NULL,
    igst numeric(12,2) DEFAULT 0.00 NOT NULL,
    total_tax numeric(12,2) DEFAULT 0.00 NOT NULL,
    grand_total numeric(12,2) DEFAULT 0.00 NOT NULL,
    issue_date date DEFAULT CURRENT_DATE NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS credit_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id uuid NOT NULL,
    party_id uuid NOT NULL,
    order_id uuid,
    invoice_id uuid,
    transaction_type character varying(30) NOT NULL,
    amount numeric(12,2) NOT NULL,
    balance_after numeric(12,2) NOT NULL,
    due_date date,
    payment_method character varying(30),
    notes text,
    idempotency_key character varying(120),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS device_tokens (
    id integer DEFAULT nextval('device_tokens_id_seq'::regclass) NOT NULL,
    user_id uuid NOT NULL,
    token character varying(500) NOT NULL,
    platform character varying(50) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS flash_sale_products (
    id integer DEFAULT nextval('flash_sale_products_id_seq'::regclass) NOT NULL,
    flash_sale_id integer,
    created_at timestamp with time zone DEFAULT now(),
    supplier_id uuid,
    product_id uuid
);

CREATE TABLE IF NOT EXISTS flash_sales (
    id integer DEFAULT nextval('flash_sales_id_seq'::regclass) NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    discount_type character varying(50) DEFAULT 'percentage'::character varying,
    discount_value numeric(10,2) NOT NULL,
    start_date timestamp with time zone NOT NULL,
    end_date timestamp with time zone NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    created_by uuid
);

CREATE TABLE IF NOT EXISTS gift_card_transactions (
    id integer DEFAULT nextval('gift_card_transactions_id_seq'::regclass) NOT NULL,
    gift_card_id integer,
    transaction_type character varying(50) NOT NULL,
    amount numeric(12,2) NOT NULL,
    reference_type character varying(50),
    reference_id integer,
    created_at timestamp with time zone DEFAULT now(),
    user_id uuid
);

CREATE TABLE IF NOT EXISTS gift_cards (
    id integer DEFAULT nextval('gift_cards_id_seq'::regclass) NOT NULL,
    gift_card_code character varying(100) NOT NULL,
    recipient_email character varying(255),
    amount numeric(12,2) NOT NULL,
    balance numeric(12,2) NOT NULL,
    currency character varying(10) DEFAULT 'INR'::character varying,
    expires_at timestamp with time zone,
    status character varying(30) DEFAULT 'active'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    user_id uuid
);

CREATE TABLE IF NOT EXISTS inventory_log (
    id integer DEFAULT nextval('inventory_log_id_seq'::regclass) NOT NULL,
    movement_type character varying(50) NOT NULL,
    quantity_change integer NOT NULL,
    previous_stock integer NOT NULL,
    new_stock integer NOT NULL,
    reason text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    performed_by uuid,
    order_id uuid,
    inventory_item_id uuid,
    inventory_id uuid,
    user_id uuid,
    action character varying(50)
);

CREATE TABLE IF NOT EXISTS invoice_items (
    id integer DEFAULT nextval('invoice_items_id_seq'::regclass) NOT NULL,
    invoice_id uuid,
    product_id uuid,
    product_name character varying(255) NOT NULL,
    hsn_code character varying(50),
    quantity numeric(12,3) NOT NULL,
    unit_price numeric(12,2) DEFAULT 0.00 NOT NULL,
    gst_percent numeric(5,2) DEFAULT 18.00,
    tax_amount numeric(12,2) DEFAULT 0.00 NOT NULL,
    total numeric(12,2) DEFAULT 0.00 NOT NULL
);

CREATE TABLE IF NOT EXISTS invoice_logs (
    id integer DEFAULT nextval('invoice_logs_id_seq'::regclass) NOT NULL,
    invoice_id uuid,
    action character varying(50) NOT NULL,
    performed_by uuid,
    details text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoice_sequences (
    year integer NOT NULL,
    last_number integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS invoice_settings (
    user_id uuid NOT NULL,
    prefix character varying(10) DEFAULT 'INV'::character varying NOT NULL,
    due_days integer DEFAULT 15 NOT NULL,
    default_tax_rate numeric(5,2) DEFAULT 18.00 NOT NULL,
    default_notes text,
    default_terms text,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_number character varying(50) NOT NULL,
    order_id uuid,
    buyer_id uuid,
    supplier_id uuid,
    subtotal numeric(12,2) DEFAULT 0.00 NOT NULL,
    discount numeric(12,2) DEFAULT 0.00 NOT NULL,
    shipping_charge numeric(12,2) DEFAULT 0.00 NOT NULL,
    taxable_amount numeric(12,2) DEFAULT 0.00 NOT NULL,
    cgst numeric(12,2) DEFAULT 0.00 NOT NULL,
    sgst numeric(12,2) DEFAULT 0.00 NOT NULL,
    igst numeric(12,2) DEFAULT 0.00 NOT NULL,
    total_tax numeric(12,2) DEFAULT 0.00 NOT NULL,
    grand_total numeric(12,2) DEFAULT 0.00 NOT NULL,
    payment_status character varying(50) DEFAULT 'Pending'::character varying,
    invoice_status character varying(50) DEFAULT 'Generated'::character varying,
    issue_date date DEFAULT CURRENT_DATE,
    due_date date,
    notes text,
    terms_conditions text,
    pdf_url text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    pdf_path text,
    email_sent boolean DEFAULT false,
    email_sent_at timestamp without time zone,
    sale_id uuid,
    party_id uuid,
    recipient_name character varying(255),
    recipient_gstin character varying(20),
    recipient_city character varying(100),
    recipient_address text,
    recipient_phone character varying(20)
);

CREATE TABLE IF NOT EXISTS items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    wholesaler_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    category character varying(100),
    unit character varying(20) DEFAULT 'pcs'::character varying NOT NULL,
    pack_size numeric(12,3),
    rate numeric(12,2) DEFAULT 0.00 NOT NULL,
    moq numeric(12,3),
    hsn_code character varying(20),
    notes text,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    gst_percent numeric(5,2)
);

CREATE TABLE IF NOT EXISTS loyalty_accounts (
    id integer DEFAULT nextval('loyalty_accounts_id_seq'::regclass) NOT NULL,
    points_balance integer DEFAULT 0,
    lifetime_earned integer DEFAULT 0,
    lifetime_redeemed integer DEFAULT 0,
    membership_tier character varying(30) DEFAULT 'Bronze'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    user_id uuid
);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
    id integer DEFAULT nextval('loyalty_transactions_id_seq'::regclass) NOT NULL,
    account_id integer,
    transaction_type character varying(50) NOT NULL,
    points integer NOT NULL,
    description text,
    reference_type character varying(50),
    reference_id integer,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
    message_text text NOT NULL,
    is_read boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sender_id uuid,
    receiver_id uuid
);

CREATE TABLE IF NOT EXISTS notification_logs (
    id integer DEFAULT nextval('notification_logs_id_seq'::regclass) NOT NULL,
    notification_id integer NOT NULL,
    channel character varying(50) NOT NULL,
    status character varying(50) NOT NULL,
    provider_response jsonb,
    sent_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notification_preferences (
    id integer DEFAULT nextval('notification_preferences_id_seq'::regclass) NOT NULL,
    user_id uuid NOT NULL,
    email_enabled boolean DEFAULT true,
    sms_enabled boolean DEFAULT false,
    push_enabled boolean DEFAULT false,
    whatsapp_enabled boolean DEFAULT false,
    marketing_enabled boolean DEFAULT false,
    order_updates_enabled boolean DEFAULT true,
    inventory_enabled boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
    id integer DEFAULT nextval('notifications_id_seq'::regclass) NOT NULL,
    type character varying(50) NOT NULL,
    title character varying(255) NOT NULL,
    message text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    is_read boolean DEFAULT false,
    read_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    user_id uuid,
    order_id uuid,
    notification_type character varying(50),
    channel character varying(100),
    reference_id uuid,
    reference_type character varying(50),
    priority character varying(20) DEFAULT 'normal'::character varying
);

CREATE TABLE IF NOT EXISTS order_analytics (
    id integer DEFAULT nextval('order_analytics_id_seq'::regclass) NOT NULL,
    order_date date NOT NULL,
    order_month integer NOT NULL,
    order_year integer NOT NULL,
    total_amount numeric(12,2) NOT NULL,
    profit_margin numeric(5,2),
    category character varying(100),
    product_count integer NOT NULL,
    payment_method character varying(50),
    fulfillment_days integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    supplier_id uuid,
    buyer_id uuid,
    order_id uuid,
    user_id uuid,
    role character varying(20),
    period character varying(20),
    period_start date,
    period_end date,
    total_orders integer DEFAULT 0,
    total_revenue numeric(15,2) DEFAULT 0,
    pending_orders integer DEFAULT 0,
    completed_orders integer DEFAULT 0,
    cancelled_orders integer DEFAULT 0,
    returned_orders integer DEFAULT 0,
    average_order_value numeric(12,2) DEFAULT 0,
    top_products jsonb,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items (
    id integer DEFAULT nextval('order_items_id_seq'::regclass) NOT NULL,
    product_name character varying(255) NOT NULL,
    product_sku character varying(100),
    quantity integer NOT NULL,
    unit_price numeric(10,2) NOT NULL,
    discount_price numeric(10,2),
    total_price numeric(12,2) NOT NULL,
    moq integer NOT NULL,
    shipping_days integer,
    status character varying(50) DEFAULT 'pending'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    supplier_id uuid,
    product_id uuid,
    order_id uuid,
    inventory_item_id uuid
);

CREATE TABLE IF NOT EXISTS order_status_history (
    id integer DEFAULT nextval('order_status_history_id_seq'::regclass) NOT NULL,
    from_status character varying(50),
    to_status character varying(50),
    changed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    remarks text,
    metadata jsonb DEFAULT '{}'::jsonb,
    order_id uuid,
    updated_by uuid,
    status character varying(50),
    previous_status character varying(50),
    updated_by_role character varying(20),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    changed_by uuid
);

CREATE TABLE IF NOT EXISTS orders (
    quantity integer NOT NULL,
    total_amount numeric(12,2) NOT NULL,
    status character varying(50) DEFAULT 'pending'::character varying,
    payment_status character varying(50) DEFAULT 'pending'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    buyer_id uuid,
    inventory_item_id uuid,
    delivery_address jsonb,
    contact_phone character varying(20),
    order_number character varying(50),
    expected_delivery_date date,
    actual_delivery_date date,
    tracking_number character varying(100),
    shipping_carrier character varying(100),
    shipping_address jsonb,
    billing_address jsonb,
    subtotal numeric(12,2),
    tax_amount numeric(12,2),
    shipping_cost numeric(12,2),
    discount_amount numeric(12,2),
    notes text,
    internal_notes text,
    cancellation_reason text,
    cancelled_at timestamp without time zone,
    return_requested_at timestamp without time zone,
    return_reason text,
    return_status character varying(50) DEFAULT 'none'::character varying,
    refund_amount numeric(12,2),
    refund_status character varying(50) DEFAULT 'none'::character varying,
    refund_id character varying(100),
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    invoice_number character varying(50),
    coupon_code character varying(100),
    loyalty_points_used integer DEFAULT 0,
    gift_card_code character varying(100),
    supplier_id uuid,
    cancelled_by uuid,
    delivery_lat numeric(10,7),
    delivery_lng numeric(10,7),
    dispatched_at timestamp without time zone,
    eta_at timestamp without time zone,
    payment_plan character varying(50) DEFAULT 'full'::character varying,
    amount_paid numeric(12,2) DEFAULT 0,
    remaining_amount numeric(12,2),
    return_completed_at timestamp without time zone,
    refund_processed_at timestamp without time zone,
    party_id uuid
);

CREATE TABLE IF NOT EXISTS parties (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    wholesaler_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    business_name character varying(255),
    phone character varying(20),
    city character varying(100),
    address text,
    gstin character varying(20),
    notes text,
    user_id uuid,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    credit_limit numeric(12,2) DEFAULT 0 NOT NULL,
    credit_period_days integer DEFAULT 30 NOT NULL,
    outstanding_balance numeric(12,2) DEFAULT 0 NOT NULL,
    available_credit numeric(12,2) DEFAULT 0 NOT NULL,
    credit_status character varying(20) DEFAULT 'inactive'::character varying NOT NULL,
    last_payment_date date,
    overdue_amount numeric(12,2) DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS party_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    wholesaler_id uuid NOT NULL,
    party_id uuid NOT NULL,
    sale_id uuid,
    amount numeric(12,2) NOT NULL,
    method character varying(20) DEFAULT 'cash'::character varying NOT NULL,
    paid_on date DEFAULT CURRENT_DATE NOT NULL,
    note text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_transactions (
    id integer DEFAULT nextval('payment_transactions_id_seq'::regclass) NOT NULL,
    transaction_id character varying(100),
    payment_method character varying(50) NOT NULL,
    amount numeric(12,2) NOT NULL,
    payment_type character varying(50),
    status character varying(50),
    currency character varying(3) DEFAULT 'INR'::character varying,
    payment_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    gateway_response jsonb DEFAULT '{}'::jsonb,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    order_id uuid,
    payment_status character varying(50),
    created_by uuid,
    buyer_id uuid,
    supplier_id uuid,
    installment_number integer DEFAULT 1,
    upi_transaction_reference character varying(100),
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    refund_amount numeric(12,2) DEFAULT 0,
    refund_date timestamp without time zone
);

CREATE TABLE IF NOT EXISTS payments (
    id integer DEFAULT nextval('payments_id_seq'::regclass) NOT NULL,
    invoice_id uuid,
    amount numeric(12,2) NOT NULL,
    payment_method character varying(50) NOT NULL,
    transaction_id character varying(100),
    payment_reference character varying(100),
    paid_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    remarks text
);

CREATE TABLE IF NOT EXISTS product_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    buyer_id uuid NOT NULL,
    seller_id uuid,
    product_id uuid NOT NULL,
    order_id uuid,
    rating integer NOT NULL,
    title character varying(150),
    comment text,
    is_verified_purchase boolean DEFAULT false,
    status character varying(20) DEFAULT 'active'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
    name character varying(255) NOT NULL,
    category character varying(100) NOT NULL,
    description text,
    global_image_url text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);

CREATE TABLE IF NOT EXISTS referral_rewards (
    id integer DEFAULT nextval('referral_rewards_id_seq'::regclass) NOT NULL,
    referral_id integer,
    reward_type character varying(50) DEFAULT 'points'::character varying,
    reward_value integer DEFAULT 0,
    status character varying(30) DEFAULT 'pending'::character varying,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS referrals (
    id integer DEFAULT nextval('referrals_id_seq'::regclass) NOT NULL,
    referral_code character varying(50) NOT NULL,
    status character varying(30) DEFAULT 'pending'::character varying,
    reward_status character varying(30) DEFAULT 'pending'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    referrer_id uuid,
    referee_id uuid
);

CREATE TABLE IF NOT EXISTS return_requests (
    id integer DEFAULT nextval('return_requests_id_seq'::regclass) NOT NULL,
    order_item_id integer,
    request_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    return_reason character varying(255) NOT NULL,
    return_type character varying(50) NOT NULL,
    quantity integer NOT NULL,
    refund_amount numeric(12,2),
    status character varying(50) DEFAULT 'pending'::character varying,
    approved_at timestamp without time zone,
    rejection_reason text,
    processing_notes text,
    refund_transaction_id character varying(100),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    requested_by uuid,
    approved_by uuid,
    order_id uuid,
    replacement_order_id uuid,
    reason text,
    processed_by uuid,
    processed_at timestamp without time zone,
    admin_notes text
);

CREATE TABLE IF NOT EXISTS review_helpful_votes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    review_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS review_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    review_id uuid NOT NULL,
    image_url text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS review_replies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    review_id uuid NOT NULL,
    review_type character varying(20) DEFAULT 'product'::character varying NOT NULL,
    user_id uuid NOT NULL,
    message text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS review_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    review_id uuid NOT NULL,
    review_type character varying(20) DEFAULT 'product'::character varying,
    user_id uuid NOT NULL,
    reason character varying(40) NOT NULL,
    details text,
    status character varying(20) DEFAULT 'pending'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reviews (
    rating smallint NOT NULL,
    review_text text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inventory_item_id uuid,
    order_id uuid
);

CREATE TABLE IF NOT EXISTS sale_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sale_id uuid NOT NULL,
    item_name character varying(255) NOT NULL,
    quantity numeric(12,3) DEFAULT 1 NOT NULL,
    unit character varying(20),
    rate numeric(12,2) DEFAULT 0.00 NOT NULL,
    amount numeric(12,2) DEFAULT 0.00 NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    hsn_code character varying(20),
    gst_percent numeric(5,2)
);

CREATE TABLE IF NOT EXISTS sale_sequences (
    wholesaler_id uuid NOT NULL,
    last_number integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS sales (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    wholesaler_id uuid NOT NULL,
    party_id uuid NOT NULL,
    sale_number character varying(50),
    sale_date date DEFAULT CURRENT_DATE NOT NULL,
    source character varying(20) DEFAULT 'wholesaler'::character varying NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    subtotal numeric(12,2) DEFAULT 0.00 NOT NULL,
    discount numeric(12,2) DEFAULT 0.00 NOT NULL,
    total numeric(12,2) DEFAULT 0.00 NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tax_amount numeric(12,2) DEFAULT 0.00 NOT NULL
);

CREATE TABLE IF NOT EXISTS seller_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    buyer_id uuid NOT NULL,
    seller_id uuid NOT NULL,
    order_id uuid,
    overall_experience integer NOT NULL,
    product_quality integer NOT NULL,
    delivery_experience integer NOT NULL,
    communication integer NOT NULL,
    comment text,
    status character varying(20) DEFAULT 'active'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shipment_checkpoints (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    label character varying(120) NOT NULL,
    note text,
    lat numeric(10,7),
    lng numeric(10,7),
    kind character varying(20) DEFAULT 'actual'::character varying NOT NULL,
    source character varying(20) DEFAULT 'wholesaler'::character varying NOT NULL,
    recorded_by uuid,
    recorded_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS shipment_tracking_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    token character varying(64) NOT NULL,
    driver_name character varying(120),
    driver_phone character varying(20),
    vehicle_number character varying(40),
    created_by uuid,
    expires_at timestamp without time zone NOT NULL,
    revoked_at timestamp without time zone,
    last_ping_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS shipments (
    id integer DEFAULT nextval('shipments_id_seq'::regclass) NOT NULL,
    order_item_id integer,
    tracking_number character varying(100) NOT NULL,
    carrier character varying(100) NOT NULL,
    shipping_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    expected_delivery_date date,
    actual_delivery_date date,
    origin_address jsonb,
    destination_address jsonb,
    weight numeric(8,2),
    dimensions character varying(50),
    shipping_cost numeric(10,2),
    status character varying(50) DEFAULT 'picked_up'::character varying,
    current_location jsonb,
    tracking_events jsonb DEFAULT '[]'::jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    order_id uuid,
    shipping_address jsonb,
    shipped_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    delivery_status character varying(50) DEFAULT 'in_transit'::character varying,
    delivery_notes text
);

CREATE TABLE IF NOT EXISTS supplier_inventory (
    price numeric(10,2) NOT NULL,
    discount_price numeric(10,2),
    moq integer NOT NULL,
    stock integer NOT NULL,
    shipping_days integer NOT NULL,
    image_url text,
    status character varying(20) DEFAULT 'Active'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supplier_id uuid,
    product_id uuid,
    visibility character varying(20) DEFAULT 'public'::character varying NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    first_name character varying(100) NOT NULL,
    last_name character varying(100) NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    phone character varying(20) NOT NULL,
    role character varying(20) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);

CREATE TABLE IF NOT EXISTS wholesaler_profiles (
    company_name character varying(255),
    gstin character varying(50),
    is_verified boolean DEFAULT false,
    upi_id character varying(100),
    city character varying(100) DEFAULT 'Delhi'::character varying,
    country character varying(100) DEFAULT 'India'::character varying,
    gst_verified boolean DEFAULT false,
    years_in_business integer DEFAULT 0,
    contact_phone character varying(20),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    lat numeric(10,7),
    lng numeric(10,7),
    geocoded_at timestamp without time zone,
    warehouse_address text,
    warehouse_city character varying(100),
    warehouse_state character varying(100),
    warehouse_pincode character varying(10),
    warehouse_pinned boolean DEFAULT false,
    trust_score character varying(10) DEFAULT '95%'::character varying,
    response_rate character varying(10) DEFAULT '98%'::character varying,
    response_time character varying(50) DEFAULT '< 2 hrs'::character varying
);

CREATE TABLE IF NOT EXISTS wishlist_notifications (
    id integer DEFAULT nextval('wishlist_notifications_id_seq'::regclass) NOT NULL,
    notification_type character varying(50) DEFAULT 'price-drop'::character varying,
    is_read boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    user_id uuid,
    product_id uuid
);

ALTER SEQUENCE coupon_usage_id_seq OWNED BY coupon_usage.id;
ALTER SEQUENCE coupons_id_seq OWNED BY coupons.id;
ALTER SEQUENCE credit_note_items_id_seq OWNED BY credit_note_items.id;
ALTER SEQUENCE device_tokens_id_seq OWNED BY device_tokens.id;
ALTER SEQUENCE flash_sale_products_id_seq OWNED BY flash_sale_products.id;
ALTER SEQUENCE flash_sales_id_seq OWNED BY flash_sales.id;
ALTER SEQUENCE gift_card_transactions_id_seq OWNED BY gift_card_transactions.id;
ALTER SEQUENCE gift_cards_id_seq OWNED BY gift_cards.id;
ALTER SEQUENCE inventory_log_id_seq OWNED BY inventory_log.id;
ALTER SEQUENCE invoice_items_id_seq OWNED BY invoice_items.id;
ALTER SEQUENCE invoice_logs_id_seq OWNED BY invoice_logs.id;
ALTER SEQUENCE loyalty_accounts_id_seq OWNED BY loyalty_accounts.id;
ALTER SEQUENCE loyalty_transactions_id_seq OWNED BY loyalty_transactions.id;
ALTER SEQUENCE notification_logs_id_seq OWNED BY notification_logs.id;
ALTER SEQUENCE notification_preferences_id_seq OWNED BY notification_preferences.id;
ALTER SEQUENCE notifications_id_seq OWNED BY notifications.id;
ALTER SEQUENCE order_analytics_id_seq OWNED BY order_analytics.id;
ALTER SEQUENCE order_items_id_seq OWNED BY order_items.id;
ALTER SEQUENCE order_status_history_id_seq OWNED BY order_status_history.id;
ALTER SEQUENCE payment_transactions_id_seq OWNED BY payment_transactions.id;
ALTER SEQUENCE payments_id_seq OWNED BY payments.id;
ALTER SEQUENCE referral_rewards_id_seq OWNED BY referral_rewards.id;
ALTER SEQUENCE referrals_id_seq OWNED BY referrals.id;
ALTER SEQUENCE return_requests_id_seq OWNED BY return_requests.id;
ALTER SEQUENCE shipments_id_seq OWNED BY shipments.id;
ALTER SEQUENCE wishlist_notifications_id_seq OWNED BY wishlist_notifications.id;

-- Constraints

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'coupon_usage_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE coupon_usage ADD CONSTRAINT coupon_usage_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'coupons_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE coupons ADD CONSTRAINT coupons_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'credit_account_audit_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE credit_account_audit ADD CONSTRAINT credit_account_audit_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'credit_note_items_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE credit_note_items ADD CONSTRAINT credit_note_items_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'credit_note_sequences_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE credit_note_sequences ADD CONSTRAINT credit_note_sequences_pkey PRIMARY KEY (wholesaler_id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'credit_notes_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'credit_transactions_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'device_tokens_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE device_tokens ADD CONSTRAINT device_tokens_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'flash_sale_products_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE flash_sale_products ADD CONSTRAINT flash_sale_products_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'flash_sales_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE flash_sales ADD CONSTRAINT flash_sales_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'gift_card_transactions_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE gift_card_transactions ADD CONSTRAINT gift_card_transactions_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'gift_cards_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE gift_cards ADD CONSTRAINT gift_cards_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'inventory_log_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE inventory_log ADD CONSTRAINT inventory_log_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'invoice_items_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE invoice_items ADD CONSTRAINT invoice_items_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'invoice_logs_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE invoice_logs ADD CONSTRAINT invoice_logs_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'invoice_sequences_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE invoice_sequences ADD CONSTRAINT invoice_sequences_pkey PRIMARY KEY (year);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'invoice_settings_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE invoice_settings ADD CONSTRAINT invoice_settings_pkey PRIMARY KEY (user_id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'invoices_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE invoices ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'items_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE items ADD CONSTRAINT items_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'loyalty_accounts_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE loyalty_accounts ADD CONSTRAINT loyalty_accounts_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'loyalty_transactions_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE loyalty_transactions ADD CONSTRAINT loyalty_transactions_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'messages_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE messages ADD CONSTRAINT messages_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'notification_logs_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE notification_logs ADD CONSTRAINT notification_logs_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'notification_preferences_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'notifications_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'order_analytics_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE order_analytics ADD CONSTRAINT order_analytics_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'order_items_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE order_items ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'order_status_history_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE order_status_history ADD CONSTRAINT order_status_history_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'orders_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE orders ADD CONSTRAINT orders_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'parties_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE parties ADD CONSTRAINT parties_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'party_payments_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE party_payments ADD CONSTRAINT party_payments_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'payment_transactions_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE payment_transactions ADD CONSTRAINT payment_transactions_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'payments_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE payments ADD CONSTRAINT payments_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'product_reviews_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE product_reviews ADD CONSTRAINT product_reviews_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'products_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE products ADD CONSTRAINT products_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'referral_rewards_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE referral_rewards ADD CONSTRAINT referral_rewards_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'referrals_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE referrals ADD CONSTRAINT referrals_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'return_requests_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE return_requests ADD CONSTRAINT return_requests_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'review_helpful_votes_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE review_helpful_votes ADD CONSTRAINT review_helpful_votes_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'review_images_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE review_images ADD CONSTRAINT review_images_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'review_replies_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE review_replies ADD CONSTRAINT review_replies_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'review_reports_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE review_reports ADD CONSTRAINT review_reports_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'reviews_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE reviews ADD CONSTRAINT reviews_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'sale_lines_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE sale_lines ADD CONSTRAINT sale_lines_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'sale_sequences_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE sale_sequences ADD CONSTRAINT sale_sequences_pkey PRIMARY KEY (wholesaler_id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'sales_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE sales ADD CONSTRAINT sales_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'seller_reviews_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE seller_reviews ADD CONSTRAINT seller_reviews_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'shipment_checkpoints_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE shipment_checkpoints ADD CONSTRAINT shipment_checkpoints_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'shipment_tracking_links_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE shipment_tracking_links ADD CONSTRAINT shipment_tracking_links_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'shipments_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE shipments ADD CONSTRAINT shipments_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'supplier_inventory_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE supplier_inventory ADD CONSTRAINT supplier_inventory_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'users_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'wholesaler_profiles_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE wholesaler_profiles ADD CONSTRAINT wholesaler_profiles_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'wishlist_notifications_pkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE wishlist_notifications ADD CONSTRAINT wishlist_notifications_pkey PRIMARY KEY (id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'coupons_code_key'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE coupons ADD CONSTRAINT coupons_code_key UNIQUE (code);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'credit_notes_wholesaler_id_note_number_key'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_wholesaler_id_note_number_key UNIQUE (wholesaler_id, note_number);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'gift_cards_gift_card_code_key'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE gift_cards ADD CONSTRAINT gift_cards_gift_card_code_key UNIQUE (gift_card_code);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'invoices_invoice_number_key'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE invoices ADD CONSTRAINT invoices_invoice_number_key UNIQUE (invoice_number);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'notification_preferences_user_id_key'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_user_id_key UNIQUE (user_id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'payment_transactions_transaction_id_key'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE payment_transactions ADD CONSTRAINT payment_transactions_transaction_id_key UNIQUE (transaction_id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'product_reviews_buyer_id_product_id_key'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE product_reviews ADD CONSTRAINT product_reviews_buyer_id_product_id_key UNIQUE (buyer_id, product_id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'review_helpful_votes_review_id_user_id_key'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE review_helpful_votes ADD CONSTRAINT review_helpful_votes_review_id_user_id_key UNIQUE (review_id, user_id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'review_replies_review_id_review_type_key'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE review_replies ADD CONSTRAINT review_replies_review_id_review_type_key UNIQUE (review_id, review_type);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'review_reports_review_id_user_id_review_type_key'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE review_reports ADD CONSTRAINT review_reports_review_id_user_id_review_type_key UNIQUE (review_id, user_id, review_type);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'reviews_order_id_key'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE reviews ADD CONSTRAINT reviews_order_id_key UNIQUE (order_id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'seller_reviews_buyer_id_seller_id_key'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE seller_reviews ADD CONSTRAINT seller_reviews_buyer_id_seller_id_key UNIQUE (buyer_id, seller_id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'shipment_tracking_links_token_key'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE shipment_tracking_links ADD CONSTRAINT shipment_tracking_links_token_key UNIQUE (token);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'uq_supplier_product'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE supplier_inventory ADD CONSTRAINT uq_supplier_product UNIQUE (supplier_id, product_id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'users_email_key'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'credit_account_audit_party_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE credit_account_audit ADD CONSTRAINT credit_account_audit_party_id_fkey FOREIGN KEY (party_id) REFERENCES parties(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'credit_account_audit_seller_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE credit_account_audit ADD CONSTRAINT credit_account_audit_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'credit_note_items_credit_note_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE credit_note_items ADD CONSTRAINT credit_note_items_credit_note_id_fkey FOREIGN KEY (credit_note_id) REFERENCES credit_notes(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'credit_note_sequences_wholesaler_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE credit_note_sequences ADD CONSTRAINT credit_note_sequences_wholesaler_id_fkey FOREIGN KEY (wholesaler_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'credit_notes_invoice_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'credit_notes_party_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_party_id_fkey FOREIGN KEY (party_id) REFERENCES parties(id) ON DELETE SET NULL;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'credit_notes_sale_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE SET NULL;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'credit_notes_wholesaler_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_wholesaler_id_fkey FOREIGN KEY (wholesaler_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'credit_transactions_invoice_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'credit_transactions_order_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'credit_transactions_party_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_party_id_fkey FOREIGN KEY (party_id) REFERENCES parties(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'credit_transactions_seller_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'device_tokens_user_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE device_tokens ADD CONSTRAINT device_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'invoice_items_invoice_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE invoice_items ADD CONSTRAINT invoice_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'invoice_items_product_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE invoice_items ADD CONSTRAINT invoice_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'invoice_logs_invoice_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE invoice_logs ADD CONSTRAINT invoice_logs_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'invoice_logs_performed_by_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE invoice_logs ADD CONSTRAINT invoice_logs_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'invoice_settings_user_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE invoice_settings ADD CONSTRAINT invoice_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'invoices_buyer_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE invoices ADD CONSTRAINT invoices_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'invoices_order_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE invoices ADD CONSTRAINT invoices_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'invoices_party_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE invoices ADD CONSTRAINT invoices_party_id_fkey FOREIGN KEY (party_id) REFERENCES parties(id) ON DELETE SET NULL;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'invoices_sale_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE invoices ADD CONSTRAINT invoices_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE SET NULL;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'invoices_supplier_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE invoices ADD CONSTRAINT invoices_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'items_wholesaler_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE items ADD CONSTRAINT items_wholesaler_id_fkey FOREIGN KEY (wholesaler_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'messages_receiver_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE messages ADD CONSTRAINT messages_receiver_id_fkey FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'messages_sender_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE messages ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'notification_logs_notification_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE notification_logs ADD CONSTRAINT notification_logs_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'notification_preferences_user_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'order_status_history_order_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE order_status_history ADD CONSTRAINT order_status_history_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'orders_buyer_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE orders ADD CONSTRAINT orders_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'orders_inventory_item_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE orders ADD CONSTRAINT orders_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES supplier_inventory(id) ON DELETE RESTRICT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'orders_party_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE orders ADD CONSTRAINT orders_party_id_fkey FOREIGN KEY (party_id) REFERENCES parties(id) ON DELETE SET NULL;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'orders_supplier_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE orders ADD CONSTRAINT orders_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'parties_user_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE parties ADD CONSTRAINT parties_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'parties_wholesaler_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE parties ADD CONSTRAINT parties_wholesaler_id_fkey FOREIGN KEY (wholesaler_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'party_payments_party_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE party_payments ADD CONSTRAINT party_payments_party_id_fkey FOREIGN KEY (party_id) REFERENCES parties(id) ON DELETE RESTRICT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'party_payments_sale_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE party_payments ADD CONSTRAINT party_payments_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE SET NULL;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'party_payments_wholesaler_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE party_payments ADD CONSTRAINT party_payments_wholesaler_id_fkey FOREIGN KEY (wholesaler_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'payment_transactions_buyer_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE payment_transactions ADD CONSTRAINT payment_transactions_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'payment_transactions_order_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE payment_transactions ADD CONSTRAINT payment_transactions_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'payment_transactions_supplier_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE payment_transactions ADD CONSTRAINT payment_transactions_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'payments_invoice_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE payments ADD CONSTRAINT payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'product_reviews_buyer_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE product_reviews ADD CONSTRAINT product_reviews_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'product_reviews_order_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE product_reviews ADD CONSTRAINT product_reviews_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'product_reviews_product_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE product_reviews ADD CONSTRAINT product_reviews_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'product_reviews_seller_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE product_reviews ADD CONSTRAINT product_reviews_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'review_helpful_votes_review_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE review_helpful_votes ADD CONSTRAINT review_helpful_votes_review_id_fkey FOREIGN KEY (review_id) REFERENCES product_reviews(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'review_helpful_votes_user_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE review_helpful_votes ADD CONSTRAINT review_helpful_votes_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'review_images_review_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE review_images ADD CONSTRAINT review_images_review_id_fkey FOREIGN KEY (review_id) REFERENCES product_reviews(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'review_replies_user_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE review_replies ADD CONSTRAINT review_replies_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'review_reports_user_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE review_reports ADD CONSTRAINT review_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'reviews_inventory_item_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE reviews ADD CONSTRAINT reviews_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES supplier_inventory(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'reviews_order_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE reviews ADD CONSTRAINT reviews_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'sale_lines_sale_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE sale_lines ADD CONSTRAINT sale_lines_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'sale_sequences_wholesaler_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE sale_sequences ADD CONSTRAINT sale_sequences_wholesaler_id_fkey FOREIGN KEY (wholesaler_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'sales_party_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE sales ADD CONSTRAINT sales_party_id_fkey FOREIGN KEY (party_id) REFERENCES parties(id) ON DELETE RESTRICT;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'sales_wholesaler_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE sales ADD CONSTRAINT sales_wholesaler_id_fkey FOREIGN KEY (wholesaler_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'seller_reviews_buyer_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE seller_reviews ADD CONSTRAINT seller_reviews_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'seller_reviews_order_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE seller_reviews ADD CONSTRAINT seller_reviews_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'seller_reviews_seller_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE seller_reviews ADD CONSTRAINT seller_reviews_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'shipment_checkpoints_order_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE shipment_checkpoints ADD CONSTRAINT shipment_checkpoints_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'shipment_checkpoints_recorded_by_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE shipment_checkpoints ADD CONSTRAINT shipment_checkpoints_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'shipment_tracking_links_created_by_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE shipment_tracking_links ADD CONSTRAINT shipment_tracking_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'shipment_tracking_links_order_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE shipment_tracking_links ADD CONSTRAINT shipment_tracking_links_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'supplier_inventory_product_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE supplier_inventory ADD CONSTRAINT supplier_inventory_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'supplier_inventory_supplier_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE supplier_inventory ADD CONSTRAINT supplier_inventory_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'wholesaler_profiles_user_id_fkey'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE wholesaler_profiles ADD CONSTRAINT wholesaler_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'credit_notes_reason_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_reason_check CHECK (((reason)::text = ANY ((ARRAY['sale_cancelled'::character varying, 'goods_returned'::character varying, 'rate_revised'::character varying, 'other'::character varying])::text[])));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'credit_transactions_amount_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_amount_check CHECK ((amount > (0)::numeric));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'credit_transactions_balance_after_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_balance_after_check CHECK ((balance_after >= (0)::numeric));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'credit_transactions_transaction_type_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_transaction_type_check CHECK (((transaction_type)::text = ANY ((ARRAY['credit_sale'::character varying, 'payment_received'::character varying, 'adjustment'::character varying, 'overdue_penalty'::character varying, 'refund'::character varying])::text[])));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'invoice_items_quantity_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE invoice_items ADD CONSTRAINT invoice_items_quantity_check CHECK ((quantity > (0)::numeric));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'items_rate_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE items ADD CONSTRAINT items_rate_check CHECK ((rate >= (0)::numeric));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'items_status_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE items ADD CONSTRAINT items_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying])::text[])));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'order_items_discount_price_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE order_items ADD CONSTRAINT order_items_discount_price_check CHECK ((discount_price >= (0)::numeric));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'order_items_quantity_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE order_items ADD CONSTRAINT order_items_quantity_check CHECK ((quantity > 0));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'order_items_total_price_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE order_items ADD CONSTRAINT order_items_total_price_check CHECK ((total_price >= (0)::numeric));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'order_items_unit_price_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE order_items ADD CONSTRAINT order_items_unit_price_check CHECK ((unit_price >= (0)::numeric));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'chk_order_payment_status'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE orders ADD CONSTRAINT chk_order_payment_status CHECK (((payment_status)::text = ANY ((ARRAY['pending'::character varying, 'payment_pending'::character varying, 'paid'::character varying, 'partial'::character varying, 'partially_paid'::character varying, 'failed'::character varying, 'cod'::character varying, 'refunded'::character varying])::text[])));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'chk_order_status'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE orders ADD CONSTRAINT chk_order_status CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'payment_pending'::character varying, 'payment_completed'::character varying, 'payment_failed'::character varying, 'supplier_accepted'::character varying, 'processing'::character varying, 'packed'::character varying, 'ready_for_pickup'::character varying, 'shipped'::character varying, 'in_transit'::character varying, 'out_for_delivery'::character varying, 'delivered'::character varying, 'failed_delivery'::character varying, 'completed'::character varying, 'return_requested'::character varying, 'return_approved'::character varying, 'return_rejected'::character varying, 'return_completed'::character varying, 'replacement_requested'::character varying, 'replacement_issued'::character varying, 'cancelled'::character varying, 'refunded'::character varying])::text[])));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'parties_credit_status_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE parties ADD CONSTRAINT parties_credit_status_check CHECK (((credit_status)::text = ANY ((ARRAY['inactive'::character varying, 'active'::character varying, 'warning'::character varying, 'blocked'::character varying])::text[])));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'parties_credit_values_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE parties ADD CONSTRAINT parties_credit_values_check CHECK (((credit_limit >= (0)::numeric) AND ((credit_period_days >= 1) AND (credit_period_days <= 3650)) AND (outstanding_balance >= (0)::numeric) AND (available_credit >= (0)::numeric) AND (overdue_amount >= (0)::numeric)));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'parties_status_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE parties ADD CONSTRAINT parties_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying])::text[])));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'party_payments_amount_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE party_payments ADD CONSTRAINT party_payments_amount_check CHECK ((amount > (0)::numeric));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'party_payments_method_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE party_payments ADD CONSTRAINT party_payments_method_check CHECK (((method)::text = ANY ((ARRAY['cash'::character varying, 'upi'::character varying, 'bank'::character varying, 'cheque'::character varying, 'other'::character varying])::text[])));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'payment_transactions_amount_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE payment_transactions ADD CONSTRAINT payment_transactions_amount_check CHECK ((amount > (0)::numeric));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'payment_transactions_status_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE payment_transactions ADD CONSTRAINT payment_transactions_status_check CHECK (((payment_status)::text = ANY ((ARRAY['pending'::character varying, 'completed'::character varying, 'paid'::character varying, 'failed'::character varying, 'superseded'::character varying, 'credit_pending'::character varying])::text[])));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'payments_amount_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE payments ADD CONSTRAINT payments_amount_check CHECK ((amount > (0)::numeric));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'product_reviews_rating_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE product_reviews ADD CONSTRAINT product_reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'product_reviews_status_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE product_reviews ADD CONSTRAINT product_reviews_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'hidden'::character varying, 'deleted'::character varying])::text[])));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'return_requests_quantity_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE return_requests ADD CONSTRAINT return_requests_quantity_check CHECK ((quantity > 0));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'review_replies_review_type_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE review_replies ADD CONSTRAINT review_replies_review_type_check CHECK (((review_type)::text = ANY ((ARRAY['product'::character varying, 'seller'::character varying])::text[])));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'review_reports_review_type_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE review_reports ADD CONSTRAINT review_reports_review_type_check CHECK (((review_type)::text = ANY ((ARRAY['product'::character varying, 'seller'::character varying])::text[])));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'review_reports_status_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE review_reports ADD CONSTRAINT review_reports_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'reviewed'::character varying, 'dismissed'::character varying])::text[])));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'reviews_rating_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE reviews ADD CONSTRAINT reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'sales_source_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE sales ADD CONSTRAINT sales_source_check CHECK (((source)::text = ANY ((ARRAY['wholesaler'::character varying, 'retailer'::character varying])::text[])));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'sales_status_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE sales ADD CONSTRAINT sales_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'confirmed'::character varying, 'delivered'::character varying, 'cancelled'::character varying])::text[])));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'seller_reviews_communication_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE seller_reviews ADD CONSTRAINT seller_reviews_communication_check CHECK (((communication >= 1) AND (communication <= 5)));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'seller_reviews_delivery_experience_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE seller_reviews ADD CONSTRAINT seller_reviews_delivery_experience_check CHECK (((delivery_experience >= 1) AND (delivery_experience <= 5)));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'seller_reviews_overall_experience_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE seller_reviews ADD CONSTRAINT seller_reviews_overall_experience_check CHECK (((overall_experience >= 1) AND (overall_experience <= 5)));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'seller_reviews_product_quality_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE seller_reviews ADD CONSTRAINT seller_reviews_product_quality_check CHECK (((product_quality >= 1) AND (product_quality <= 5)));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'seller_reviews_status_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE seller_reviews ADD CONSTRAINT seller_reviews_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'hidden'::character varying, 'deleted'::character varying])::text[])));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'shipment_checkpoints_kind_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE shipment_checkpoints ADD CONSTRAINT shipment_checkpoints_kind_check CHECK (((kind)::text = ANY ((ARRAY['actual'::character varying, 'planned'::character varying])::text[])));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'shipment_checkpoints_source_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE shipment_checkpoints ADD CONSTRAINT shipment_checkpoints_source_check CHECK (((source)::text = ANY ((ARRAY['wholesaler'::character varying, 'driver_link'::character varying, 'carrier_api'::character varying, 'system'::character varying])::text[])));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'chk_discount_valid'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE supplier_inventory ADD CONSTRAINT chk_discount_valid CHECK (((discount_price IS NULL) OR (discount_price <= price)));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'chk_moq_positive'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE supplier_inventory ADD CONSTRAINT chk_moq_positive CHECK ((moq > 0));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'chk_price_positive'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE supplier_inventory ADD CONSTRAINT chk_price_positive CHECK ((price > (0)::numeric));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'chk_status'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE supplier_inventory ADD CONSTRAINT chk_status CHECK (((status)::text = ANY ((ARRAY['Active'::character varying, 'Draft'::character varying])::text[])));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'chk_stock_nonneg'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE supplier_inventory ADD CONSTRAINT chk_stock_nonneg CHECK ((stock >= 0));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'supplier_inventory_visibility_check'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE supplier_inventory ADD CONSTRAINT supplier_inventory_visibility_check CHECK (((visibility)::text = ANY ((ARRAY['public'::character varying, 'storefront'::character varying, 'private'::character varying])::text[])));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'chk_role'
                     AND connamespace = 'public'::regnamespace) THEN
        ALTER TABLE users ADD CONSTRAINT chk_role CHECK (((role)::text = ANY ((ARRAY['buyer'::character varying, 'seller'::character varying, 'both'::character varying])::text[])));
    END IF;
END $$;

-- Indexes

CREATE INDEX IF NOT EXISTS idx_coupon_usage_user ON public.coupon_usage USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_coupons_code ON public.coupons USING btree (code);
CREATE INDEX IF NOT EXISTS idx_credit_account_audit_party_date ON public.credit_account_audit USING btree (party_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_note_items_note ON public.credit_note_items USING btree (credit_note_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_notes_invoice ON public.credit_notes USING btree (invoice_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_party ON public.credit_notes USING btree (party_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_sale ON public.credit_notes USING btree (sale_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_wholesaler ON public.credit_notes USING btree (wholesaler_id, issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_due_date ON public.credit_transactions USING btree (seller_id, due_date) WHERE (((transaction_type)::text = 'credit_sale'::text) AND (due_date IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_transactions_idempotency ON public.credit_transactions USING btree (seller_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_party_date ON public.credit_transactions USING btree (party_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_seller_date ON public.credit_transactions USING btree (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_tokens_token ON public.device_tokens USING btree (token);
CREATE INDEX IF NOT EXISTS idx_device_tokens_user_id ON public.device_tokens USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_flash_sales_active ON public.flash_sales USING btree (is_active, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_gift_cards_code ON public.gift_cards USING btree (gift_card_code);
CREATE INDEX IF NOT EXISTS idx_gift_cards_user ON public.gift_cards USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_inventory_log_created_at ON public.inventory_log USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_log_inventory_id ON public.inventory_log USING btree (inventory_id);
CREATE INDEX IF NOT EXISTS idx_inventory_log_order_id ON public.inventory_log USING btree (order_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON public.invoice_items USING btree (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_logs_invoice_id ON public.invoice_logs USING btree (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoices_buyer_id ON public.invoices USING btree (buyer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_number ON public.invoices USING btree (invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_status ON public.invoices USING btree (invoice_status);
CREATE INDEX IF NOT EXISTS idx_invoices_order_id ON public.invoices USING btree (order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_party ON public.invoices USING btree (party_id);
CREATE INDEX IF NOT EXISTS idx_invoices_payment_status ON public.invoices USING btree (payment_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_sale ON public.invoices USING btree (sale_id) WHERE (sale_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_invoices_supplier_id ON public.invoices USING btree (supplier_id);
CREATE INDEX IF NOT EXISTS idx_items_wholesaler ON public.items USING btree (wholesaler_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_wholesaler_name ON public.items USING btree (wholesaler_id, lower((name)::text));
CREATE INDEX IF NOT EXISTS idx_loyalty_accounts_user ON public.loyalty_accounts USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON public.messages USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_messages_receiver_sender ON public.messages USING btree (receiver_id, sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver_unread ON public.messages USING btree (receiver_id) WHERE (is_read = false);
CREATE INDEX IF NOT EXISTS idx_messages_sender_receiver ON public.messages USING btree (sender_id, receiver_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_channel ON public.notification_logs USING btree (channel);
CREATE INDEX IF NOT EXISTS idx_notification_logs_notification_id ON public.notification_logs USING btree (notification_id);
CREATE INDEX IF NOT EXISTS idx_notification_preferences_user_id ON public.notification_preferences USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON public.notifications USING btree (notification_type);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id_is_read ON public.notifications USING btree (user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_order_analytics_period ON public.order_analytics USING btree (period, period_start);
CREATE INDEX IF NOT EXISTS idx_order_analytics_user_id ON public.order_analytics USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items USING btree (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON public.order_items USING btree (product_id);
CREATE INDEX IF NOT EXISTS idx_order_items_supplier_id ON public.order_items USING btree (supplier_id);
CREATE INDEX IF NOT EXISTS idx_order_history_created_at ON public.order_status_history USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_history_order_id ON public.order_status_history USING btree (order_id);
CREATE INDEX IF NOT EXISTS idx_orders_buyer_id ON public.orders USING btree (buyer_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders USING btree (created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_invoice_number_unique ON public.orders USING btree (invoice_number) WHERE (invoice_number IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON public.orders USING btree (order_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_number_unique ON public.orders USING btree (order_number) WHERE (order_number IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_orders_party ON public.orders USING btree (party_id);
CREATE INDEX IF NOT EXISTS idx_orders_payment_plan ON public.orders USING btree (payment_plan);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON public.orders USING btree (payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_return_status ON public.orders USING btree (return_status);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders USING btree (status);
CREATE INDEX IF NOT EXISTS idx_orders_supplier_id ON public.orders USING btree (supplier_id);
CREATE INDEX IF NOT EXISTS idx_parties_user ON public.parties USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_parties_wholesaler ON public.parties USING btree (wholesaler_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_parties_wholesaler_phone ON public.parties USING btree (wholesaler_id, phone) WHERE ((phone IS NOT NULL) AND ((phone)::text <> ''::text));
CREATE INDEX IF NOT EXISTS idx_party_payments_party ON public.party_payments USING btree (party_id, paid_on DESC);
CREATE INDEX IF NOT EXISTS idx_party_payments_wholesaler ON public.party_payments USING btree (wholesaler_id, paid_on DESC);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_order_id ON public.payment_transactions USING btree (order_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_payment_status ON public.payment_transactions USING btree (payment_status);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_transaction_id ON public.payment_transactions USING btree (transaction_id);
CREATE INDEX IF NOT EXISTS idx_payment_tx_order_id ON public.payment_transactions USING btree (order_id);
CREATE INDEX IF NOT EXISTS idx_payment_tx_order_installment ON public.payment_transactions USING btree (order_id, installment_number);
CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON public.payments USING btree (invoice_id);
CREATE INDEX IF NOT EXISTS idx_product_reviews_buyer_id ON public.product_reviews USING btree (buyer_id);
CREATE INDEX IF NOT EXISTS idx_product_reviews_created_at ON public.product_reviews USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_reviews_product_id ON public.product_reviews USING btree (product_id);
CREATE INDEX IF NOT EXISTS idx_product_reviews_status ON public.product_reviews USING btree (status);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products USING btree (category);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals USING btree (referrer_id, status);
CREATE INDEX IF NOT EXISTS idx_return_requests_order_id ON public.return_requests USING btree (order_id);
CREATE INDEX IF NOT EXISTS idx_return_requests_requested_by ON public.return_requests USING btree (requested_by);
CREATE INDEX IF NOT EXISTS idx_return_requests_status ON public.return_requests USING btree (status);
CREATE INDEX IF NOT EXISTS idx_review_images_review_id ON public.review_images USING btree (review_id);
CREATE INDEX IF NOT EXISTS idx_review_replies_review_id ON public.review_replies USING btree (review_id, review_type);
CREATE INDEX IF NOT EXISTS idx_review_reports_status ON public.review_reports USING btree (status);
CREATE INDEX IF NOT EXISTS idx_sale_lines_sale ON public.sale_lines USING btree (sale_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_number_per_wholesaler ON public.sales USING btree (wholesaler_id, sale_number) WHERE (sale_number IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_sales_party ON public.sales USING btree (party_id, sale_date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_wholesaler ON public.sales USING btree (wholesaler_id, sale_date DESC);
CREATE INDEX IF NOT EXISTS idx_seller_reviews_buyer_id ON public.seller_reviews USING btree (buyer_id);
CREATE INDEX IF NOT EXISTS idx_seller_reviews_seller_id ON public.seller_reviews USING btree (seller_id);
CREATE INDEX IF NOT EXISTS idx_shipment_checkpoints_order ON public.shipment_checkpoints USING btree (order_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracking_links_order ON public.shipment_tracking_links USING btree (order_id);
CREATE INDEX IF NOT EXISTS idx_tracking_links_token ON public.shipment_tracking_links USING btree (token);
CREATE INDEX IF NOT EXISTS idx_shipments_delivery_status ON public.shipments USING btree (delivery_status);
CREATE INDEX IF NOT EXISTS idx_shipments_order_id ON public.shipments USING btree (order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_tracking_number ON public.shipments USING btree (tracking_number);
CREATE INDEX IF NOT EXISTS idx_supplier_inventory_supplier_visibility ON public.supplier_inventory USING btree (supplier_id, visibility);
CREATE INDEX IF NOT EXISTS idx_supplier_inventory_visibility ON public.supplier_inventory USING btree (visibility, status);


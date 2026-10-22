# Database Structure Overview

This project uses PostgreSQL as its relational database. The schema is built and evolved through SQL migration files in `server/migrations`, with `server/migrations/000_baseline.sql` as the base schema and later files adding features such as payments, invoices, order lifecycle, reviews, messaging, credit, and seller profiles.

This document explains the structure of the database in a practical, developer-friendly way.

## 1. Database purpose

This application is a B2B wholesale marketplace for Indian trade. The database supports:

- user accounts and roles
- supplier and wholesaler profiles
- product catalog and supplier inventory
- order creation and lifecycle tracking
- payments and invoice generation
- party and credit accounting
- shipping and return support
- messaging and notifications
- reviews and promotions
- loyalty, referrals, and gifting features

## 2. Core schema files

The schema definition lives under:

- `server/migrations/000_baseline.sql`
- `server/migrations/enterprise_invoice_module.sql`
- `server/migrations/enterprise_order_management.sql`
- `server/migrations/messaging_system.sql`
- `server/migrations/reviews_system.sql`
- `server/migrations/wholesale3_order_party.sql`
- `server/migrations/wholesale3_one_ledger.sql`
- `server/migrations/zzz_credit_limit_pay_later.sql`

The app connects to PostgreSQL through `server/src/config/db.js` and runs migrations via `server/run_migrations.js`.

## 3. High-level database model

The most important database relationship is:

- `users` are the root account entity
- `wholesaler_profiles` extend a seller account with business details
- `products` are the catalog records
- `supplier_inventory` links suppliers to products with price, stock, visibility, and MOQ
- `orders` capture customer purchases
- `order_items` hold the actual items inside each order
- `payments` and `payment_transactions` track money movements
- `invoices` and `invoice_items` represent billing output
- `shipments`, `return_requests`, and `order_status_history` hold fulfillment and lifecycle state
- `notifications`, `messages`, `reviews`, and `wishlist_notifications` support marketplace interaction

## 4. Main tables and their purpose

### 4.1 Users and seller profiles

#### `users`
Primary account table for anyone using the platform.

Key fields:
- `id` - UUID primary key
- `first_name` - first name
- `last_name` - last name
- `email` - login/contact email
- `password_hash` - encrypted password
- `phone` - mobile number
- `role` - buyer, seller, or other application role
- `created_at` - account creation time

Related tables:
- `wholesaler_profiles`
- `notification_preferences`
- `device_tokens`
- `messages`
- `notifications`
- `orders`

#### `wholesaler_profiles`
Business profile data for supplier/wholesaler accounts.

Key fields:
- `id` - UUID
- `user_id` - FK to `users.id`
- `company_name`
- `gstin`
- `city`, `country`
- `upi_id`
- `is_verified`, `gst_verified`
- `years_in_business`
- `lat`, `lng`
- `warehouse_address`, `warehouse_city`, `warehouse_state`, `warehouse_pincode`
- `trust_score`, `response_rate`, `response_time`
- `created_at`, `updated_at`

### 4.2 Catalog and inventory

#### `products`
Master product catalog records.

Key fields:
- `id` - UUID primary key
- `name`
- `category`
- `description`
- `global_image_url`
- `created_at`

#### `items`
Seller-specific item definitions, often representing the wholesaler's own catalogue entries or product variants.

Key fields:
- `id` - UUID
- `wholesaler_id` - FK to `users.id`
- `name`, `category`, `unit`, `pack_size`
- `rate`, `moq`, `hsn_code`, `gst_percent`
- `status`
- `created_at`, `updated_at`

#### `supplier_inventory`
This is one of the most important tables in the system. It connects a supplier to a product and exposes stock and pricing to buyers.

Key fields:
- `id` - UUID primary key
- `supplier_id` - FK to `users.id`
- `product_id` - FK to `products.id`
- `price`, `discount_price`
- `moq`, `stock`, `shipping_days`
- `image_url`
- `status`
- `visibility` - values like `public`, `storefront`, or `private`
- `created_at`, `updated_at`

This table controls who can see listings and how inventory is sold.

### 4.3 Orders and fulfillment

#### `orders`
Main order record for every purchase.

Key fields:
- `id` - UUID primary key
- `order_number`
- `buyer_id` - buyer user
- `supplier_id` - seller user
- `quantity`
- `total_amount`
- `subtotal`, `tax_amount`, `shipping_cost`, `discount_amount`
- `status` - purchase lifecycle state
- `payment_status` - payment lifecycle state
- `payment_plan` - full or installment-based plan
- `amount_paid`, `remaining_amount`
- `delivery_address`, `shipping_address`, `billing_address`
- `contact_phone`
- `tracking_number`, `shipping_carrier`
- `expected_delivery_date`, `actual_delivery_date`
- `return_reason`, `return_status`, `refund_amount`, `refund_status`
- `cancelled_by`, `cancelled_at`
- `created_at`, `updated_at`

#### `order_items`
Order line items inside each order.

Key fields:
- `id` - integer primary key
- `order_id` - FK to `orders.id`
- `product_id`, `supplier_id`
- `product_name`, `product_sku`
- `quantity`, `unit_price`, `discount_price`, `total_price`
- `status`
- `moq`, `shipping_days`
- `created_at`, `updated_at`

This table stores the actual content of what was ordered.

#### `order_status_history`
Audit trail for order lifecycle transitions.

Key fields:
- `id` - integer primary key
- `order_id` - FK to `orders.id`
- `from_status`, `to_status`
- `changed_by`
- `remarks`, `metadata`
- `changed_at`, `created_at`

#### `order_analytics`
Aggregated summary data for performance reporting.

Key fields:
- `id`
- `order_id`, `buyer_id`, `supplier_id`
- `order_date`, `order_month`, `order_year`
- `total_amount`, `profit_margin`
- `category`, `product_count`, `payment_method`, `fulfillment_days`

### 4.4 Payment and invoice systems

#### `payment_transactions`
Detailed payment movement history for orders.

Key fields:
- `id` - integer primary key
- `order_id` - FK to `orders.id`
- `buyer_id`, `supplier_id`
- `transaction_id`, `payment_method`, `payment_type`
- `amount`, `status`, `payment_status`
- `currency`
- `gateway_response` as JSONB
- `installment_number`, `upi_transaction_reference`
- `refund_amount`, `refund_date`
- `created_at`, `updated_at`

This table records the full payment trail and supports installment logic.

#### `payments`
Simplified payment records linked to invoices.

Key fields:
- `id` - integer primary key
- `invoice_id` - FK to `invoices.id`
- `amount`
- `payment_method`
- `transaction_id`, `payment_reference`
- `paid_at`, `remarks`

#### `invoices`
Billing records generated for orders or sales.

Key fields:
- `id` - UUID primary key
- `invoice_number`
- `order_id`, `buyer_id`, `supplier_id`
- `sale_id`, `party_id`
- `subtotal`, `discount`, `shipping_charge`, `taxable_amount`
- `cgst`, `sgst`, `igst`, `total_tax`, `grand_total`
- `payment_status`, `invoice_status`
- `issue_date`, `due_date`
- `pdf_url`, `pdf_path`
- `email_sent`, `email_sent_at`
- `recipient_name`, `recipient_gstin`, `recipient_city`, `recipient_address`, `recipient_phone`
- `created_at`, `updated_at`

#### `invoice_items`
Breakdown of each invoice line.

Key fields:
- `id` - integer primary key
- `invoice_id` - FK to `invoices.id`
- `product_id`
- `product_name`, `hsn_code`
- `quantity`, `unit_price`, `gst_percent`, `tax_amount`, `total`

#### `invoice_logs`
Audit trail for invoice actions.

Key fields:
- `id`, `invoice_id`, `action`, `performed_by`, `details`, `created_at`

### 4.5 Sales, parties, and credit

#### `parties`
Counterparty records for B2B credit and settlement flows.

Key fields:
- `id` - UUID
- `wholesaler_id` - seller reference
- `name`, `business_name`, `phone`, `city`, `address`
- `gstin`
- `credit_limit`, `credit_period_days`
- `outstanding_balance`, `available_credit`
- `credit_status`, `last_payment_date`, `overdue_amount`

#### `sales`
Sale-level receipts or posted transactions.

Key fields:
- `id` - UUID
- `wholesaler_id`, `buyer_id`, `party_id`
- `sale_number`, `invoice_id`, `order_id`
- `grand_total`, `tax_amount`, `balance_due`, `payment_status`
- `created_at`, `updated_at`

#### `sale_lines`
Line items tied to a sale record.

Key fields:
- `id` - UUID
- `sale_id` - FK to `sales.id`
- `product_id`, `product_name`, `quantity`, `unit_price`, `tax_amount`, `total`

#### `party_payments`
Payments made against a party account.

Key fields:
- `id` - UUID
- `wholesaler_id`, `party_id`, `sale_id`
- `amount`, `method`, `paid_on`, `note`

#### `credit_notes`
Adjustments or reconciliations against sales or invoices.

Key fields:
- `id` - UUID
- `wholesaler_id`, `invoice_id`, `sale_id`, `party_id`
- `note_number`, `reason`, `reason_note`
- `subtotal`, `discount`, `taxable_amount`, `cgst`, `sgst`, `igst`, `grand_total`

#### `credit_transactions`
Ledger-style credit movement record.

Key fields:
- `id` - UUID
- `seller_id`, `party_id`, `order_id`, `invoice_id`
- `transaction_type`, `amount`, `balance_after`
- `due_date`, `payment_method`, `notes`

### 4.6 Shipping and return handling

#### `shipments`
Shipping and delivery status information.

Key fields:
- `id` - UUID
- `order_id`
- `shipping_address`, `origin_address`, `destination_address`
- `status`, `delivery_status`
- `weight`, `dimensions`, `shipping_cost`
- `tracking_events` as JSONB
- `current_location`, `delivery_notes`
- `shipped_at`, `created_at`, `updated_at`

#### `shipment_checkpoints`
Tracking checkpoints or route events.

#### `shipment_tracking_links`
Tracking URL reference records.

#### `return_requests`
Post-purchase return workflow states.

Key fields:
- `id` - UUID
- `order_id`, `user_id`
- `reason`, `status`, `amount`
- `requested_at`, `resolved_at`

### 4.7 Messaging and notifications

#### `messages`
Direct message records between users.

Key fields:
- `id` - UUID
- `sender_id`, `receiver_id`
- `message_text`
- `is_read`
- `created_at`

#### `notifications`
Notification feed entries.

Key fields:
- `id` - integer
- `user_id`, `order_id`
- `type`, `title`, `message`, `notification_type`, `channel`
- `metadata` as JSONB
- `is_read`, `read_at`, `created_at`

#### `notification_preferences`
User channels and preference toggles.

#### `device_tokens`
Push notification registration tokens.

### 4.8 Reviews, promotions, and loyalty

#### `reviews`
Customer product reviews.

Key fields:
- `id` - UUID
- `buyer_id`, `seller_id`, `product_id`, `order_id`
- `rating`, `title`, `comment`
- `status`, `is_verified_purchase`
- `created_at`, `updated_at`

Supporting tables:
- `review_replies`
- `review_images`
- `review_helpful_votes`
- `review_reports`
- `product_reviews`

#### `coupons` and `coupon_usage`
Promotion / discount rules and redemption tracking.

#### `flash_sales` and `flash_sale_products`
Time-based promotional campaigns.

#### `gift_cards` and `gift_card_transactions`
Stored value cards and their movement logs.

#### `loyalty_accounts` and `loyalty_transactions`
User loyalty points and account history.

#### `referrals` and `referral_rewards`
Referral code tracking and reward distribution.

#### `wishlist_notifications`
Notifications concerning saved products or price changes.

## 5. Important relationships

The following relationships matter most in app logic:

- `users.id` -> `wholesaler_profiles.user_id`
- `users.id` -> `supplier_inventory.supplier_id`
- `products.id` -> `supplier_inventory.product_id`
- `users.id` -> `orders.buyer_id`
- `users.id` -> `orders.supplier_id`
- `orders.id` -> `order_items.order_id`
- `orders.id` -> `payment_transactions.order_id`
- `orders.id` -> `shipments.order_id`
- `orders.id` -> `order_status_history.order_id`
- `invoices.id` -> `invoice_items.invoice_id`
- `invoices.id` -> `payments.invoice_id`
- `users.id` -> `notifications.user_id`
- `users.id` -> `messages.sender_id` / `messages.receiver_id`
- `users.id` -> `reviews.buyer_id` / `seller_id`

## 6. Key design patterns in the database

### 6.1 JSONB for flexible records
Many tables use `jsonb` for semi-structured fields, including:
- `delivery_address`
- `shipping_address`
- `billing_address`
- `gateway_response`
- `metadata`
- `tracking_events`
- `top_products`

This is useful for operational flexibility in a marketplace platform.

### 6.2 UUID-first identity model
The schema uses UUIDs for many core business entities such as:
- `users`
- `products`
- `orders`
- `invoices`
- `parties`
- `sales`
- `shipments`

This allows stable cross-system references and avoids integer collisions.

### 6.3 Multi-layer accounting
The database separates:
- order records (`orders`)
- order line items (`order_items`)
- payment transactions (`payment_transactions`)
- invoice records (`invoices`)
- party credit accounting (`credit_transactions`, `parties`)

This is intentional and supports real business accounting workflows.

## 7. Common SQL checks

### View all tables
```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

### View columns for `orders`
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'orders'
ORDER BY ordinal_position;
```

### View foreign key relationships
```sql
SELECT
  tc.table_name AS from_table,
  kcu.column_name AS from_column,
  ccu.table_name AS to_table,
  ccu.column_name AS to_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public';
```

### Fetch a supplier inventory list
```sql
SELECT p.name, p.category, i.price, i.stock, i.visibility, i.status
FROM supplier_inventory i
JOIN products p ON p.id = i.product_id
WHERE i.supplier_id = :supplier_id;
```

### Fetch an order and its line items
```sql
SELECT o.id, o.order_number, o.status, o.total_amount,
       oi.product_name, oi.quantity, oi.total_price
FROM orders o
LEFT JOIN order_items oi ON oi.order_id = o.id
WHERE o.id = :order_id;
```

## 8. Operational notes

- The database is PostgreSQL, not SQLite.
- Schema changes are managed through SQL files in `server/migrations`.
- Some features are added in later migrations, meaning a fresh database may need all migration files applied in order.
- Because the project evolved over multiple business phases, the schema contains both older and newer patterns. Do not assume a single naming convention across all tables.
- Business-critical fields such as `orders.status`, `orders.payment_status`, and `supplier_inventory.visibility` should be treated as operational rules, not just optional metadata.

## 9. Summary

This database is a complete wholesale marketplace data model. It combines user identity, product catalog, supplier inventory, orders, payments, invoice generation, seller credit, shipping, and communication features in one relational PostgreSQL schema. The schema is intentionally multi-domain and supports real-world B2B operations rather than a simple consumer ecommerce model.

For day-to-day development, start with:

- `server/migrations/000_baseline.sql`
- `server/migrations/enterprise_order_management.sql`
- `server/migrations/enterprise_invoice_module.sql`
- `server/migrations/messaging_system.sql`
- `server/migrations/reviews_system.sql`

These files define the most important structures used by the application.

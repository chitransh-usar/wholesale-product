-- Reviews & Ratings System
-- Extends the existing wholesale marketplace schema without altering existing core tables.

CREATE TABLE IF NOT EXISTS product_reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seller_id uuid REFERENCES users(id) ON DELETE SET NULL,
    product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    title VARCHAR(150),
    comment TEXT,
    is_verified_purchase BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','hidden','deleted')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (buyer_id, product_id)
);

CREATE TABLE IF NOT EXISTS seller_reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seller_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
    overall_experience INTEGER NOT NULL CHECK (overall_experience BETWEEN 1 AND 5),
    product_quality INTEGER NOT NULL CHECK (product_quality BETWEEN 1 AND 5),
    delivery_experience INTEGER NOT NULL CHECK (delivery_experience BETWEEN 1 AND 5),
    communication INTEGER NOT NULL CHECK (communication BETWEEN 1 AND 5),
    comment TEXT,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','hidden','deleted')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (buyer_id, seller_id)
);

CREATE TABLE IF NOT EXISTS review_images (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id uuid NOT NULL REFERENCES product_reviews(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS review_helpful_votes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id uuid NOT NULL REFERENCES product_reviews(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (review_id, user_id)
);

CREATE TABLE IF NOT EXISTS review_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id uuid NOT NULL,
    review_type VARCHAR(20) DEFAULT 'product' CHECK (review_type IN ('product','seller')),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason VARCHAR(40) NOT NULL,
    details TEXT,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','reviewed','dismissed')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (review_id, user_id, review_type)
);

CREATE TABLE IF NOT EXISTS review_replies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id uuid NOT NULL,
    review_type VARCHAR(20) NOT NULL DEFAULT 'product' CHECK (review_type IN ('product','seller')),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (review_id, review_type)
);

CREATE INDEX IF NOT EXISTS idx_product_reviews_product_id ON product_reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_product_reviews_buyer_id ON product_reviews(buyer_id);
CREATE INDEX IF NOT EXISTS idx_product_reviews_status ON product_reviews(status);
CREATE INDEX IF NOT EXISTS idx_product_reviews_created_at ON product_reviews(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_seller_reviews_seller_id ON seller_reviews(seller_id);
CREATE INDEX IF NOT EXISTS idx_seller_reviews_buyer_id ON seller_reviews(buyer_id);
CREATE INDEX IF NOT EXISTS idx_review_images_review_id ON review_images(review_id);
CREATE INDEX IF NOT EXISTS idx_review_reports_status ON review_reports(status);
CREATE INDEX IF NOT EXISTS idx_review_replies_review_id ON review_replies(review_id, review_type);

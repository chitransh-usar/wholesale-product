const pool = require("../config/db");

const ALLOWED_REPORT_REASONS = ["Spam", "Offensive", "Fake Review", "Irrelevant", "Other"];
const PRODUCT_REVIEW_TYPES = ["product", "seller"];
const ACTIVE_REVIEW_STATUSES = ["active"];
// A paid order is proof of purchase. Restricting reviews to "delivered" meant
// nobody could review in practice: paying leaves an order at payment_completed,
// and only the seller can walk it through the eight states before delivery.
const ELIGIBLE_ORDER_STATUSES = [
  "payment_completed",
  "supplier_accepted",
  "processing",
  "packed",
  "ready_for_pickup",
  "shipped",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "Delivered",
  "completed",
  "Completed",
];
const ELIGIBLE_PAYMENT_STATUSES = ["paid", "Paid", "completed", "Completed", "payment_completed"];
const INVALID_ORDER_STATUSES = ["cancelled", "Cancelled"];
const INVALID_RETURN_STATUSES = ["requested", "approved", "completed", "rejected"];

const buildProductReviewSummary = async (productId) => {
  const result = await pool.query(
    `SELECT COALESCE(AVG(rating), 0)::numeric(10,2) AS average_rating,
            COUNT(*) FILTER (WHERE status = 'active') AS total_reviews,
            COUNT(*) FILTER (WHERE status = 'active' AND rating = 5) AS five_star,
            COUNT(*) FILTER (WHERE status = 'active' AND rating = 4) AS four_star,
            COUNT(*) FILTER (WHERE status = 'active' AND rating = 3) AS three_star,
            COUNT(*) FILTER (WHERE status = 'active' AND rating = 2) AS two_star,
            COUNT(*) FILTER (WHERE status = 'active' AND rating = 1) AS one_star
     FROM product_reviews
     WHERE product_id = $1`,
    [productId],
  );
  return result.rows[0];
};

const buildSellerReviewSummary = async (sellerId) => {
  const result = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'active') AS total_reviews,
            AVG(overall_experience)::numeric(10,2) AS average_rating,
            AVG(product_quality)::numeric(10,2) AS product_quality,
            AVG(delivery_experience)::numeric(10,2) AS delivery_experience,
            AVG(communication)::numeric(10,2) AS communication,
            COUNT(*) FILTER (WHERE status = 'active' AND overall_experience = 5) AS five_star,
            COUNT(*) FILTER (WHERE status = 'active' AND overall_experience = 4) AS four_star,
            COUNT(*) FILTER (WHERE status = 'active' AND overall_experience = 3) AS three_star,
            COUNT(*) FILTER (WHERE status = 'active' AND overall_experience = 2) AS two_star,
            COUNT(*) FILTER (WHERE status = 'active' AND overall_experience = 1) AS one_star
     FROM seller_reviews
     WHERE seller_id = $1`,
    [sellerId],
  );
  return result.rows[0];
};

const getEligibleProductOrder = async (buyerId, productId, orderId = null) => {
  if (!buyerId || !productId) return null;

  const values = [buyerId, productId, ELIGIBLE_ORDER_STATUSES, ELIGIBLE_PAYMENT_STATUSES];
  let query = `
    SELECT o.id AS order_id, COALESCE(CAST(o.supplier_id AS text), CAST(si.supplier_id AS text)) AS supplier_id
    FROM orders o
    JOIN supplier_inventory si ON o.inventory_item_id = si.id
    WHERE o.buyer_id = $1
      AND si.product_id = $2
      AND o.status = ANY($3)
      AND o.payment_status = ANY($4)
      AND COALESCE(o.return_status, 'none') NOT IN ('requested','approved','completed','rejected')
      AND o.status NOT IN ('cancelled','Cancelled')
  `;
  if (orderId) {
    query += " AND o.id = $5";
    values.push(orderId);
  }
  query += " ORDER BY o.created_at DESC LIMIT 1";

  const result = await pool.query(query, values);
  return result.rows[0] || null;
};

const getEligibleSellerOrder = async (buyerId, sellerId, orderId) => {
  if (!buyerId || !sellerId || !orderId) return null;

  const result = await pool.query(
    `SELECT o.id AS order_id, COALESCE(CAST(o.supplier_id AS text), CAST(si.supplier_id AS text)) AS supplier_id
     FROM orders o
     JOIN supplier_inventory si ON o.inventory_item_id = si.id
     WHERE o.id = $1
       AND o.buyer_id = $2
      AND COALESCE(CAST(o.supplier_id AS text), CAST(si.supplier_id AS text)) = $3
       AND o.status = ANY($4)
       AND o.payment_status = ANY($5)
       AND COALESCE(o.return_status, 'none') NOT IN ('requested','approved','completed','rejected')
       AND o.status NOT IN ('cancelled','Cancelled')
     LIMIT 1`,
    [orderId, buyerId, sellerId, ELIGIBLE_ORDER_STATUSES, ELIGIBLE_PAYMENT_STATUSES],
  );
  return result.rows[0] || null;
};

exports.createProductReview = async (req, res) => {
  const userId = req.user?.id;
  // Debug logging: show incoming body and uploaded files (filenames only)
  try {
    console.debug("createProductReview request body:", { body: req.body });
    if (req.files) console.debug("createProductReview files:", req.files.map((f) => f.filename));
  } catch (e) {
    console.debug("createProductReview log error", e);
  }
  // When multipart/form-data is used, multer places files on req.files and form fields on req.body
  const productId = req.body.productId;
  const rating = Number(req.body.rating);
  const title = req.body.title;
  const comment = req.body.comment;
  const orderId = req.body.orderId;

  // Build images array from uploaded files or from provided URLs
  let images = [];
  if (req.files && req.files.length) {
    images = req.files.map((f) => `${req.protocol}://${req.get("host")}/uploads/review_images/${f.filename}`);
  } else if (req.body.images) {
    images = Array.isArray(req.body.images)
      ? req.body.images
      : String(req.body.images)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
  }

  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  if (!productId || !rating) return res.status(400).json({ message: "Product and rating are required" });
  if (rating < 1 || rating > 5) return res.status(400).json({ message: "Rating must be between 1 and 5" });
  if (!Array.isArray(images)) return res.status(400).json({ message: "Images must be an array" });
  if (images.length > 5) return res.status(400).json({ message: "Maximum 5 review images are allowed" });

  try {
    const order = await getEligibleProductOrder(userId, productId, orderId);
    if (!order) {
      return res.status(403).json({ message: "Only verified buyers can review purchased products" });
    }

    const existing = await pool.query(
      `SELECT id FROM product_reviews WHERE buyer_id = $1 AND product_id = $2 AND status != 'deleted'`,
      [userId, productId],
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: "You have already reviewed this product" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const reviewResult = await client.query(
        `INSERT INTO product_reviews (buyer_id, product_id, seller_id, order_id, rating, title, comment, is_verified_purchase, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, 'active')
         RETURNING id`,
        [userId, productId, order.supplier_id, order.order_id, rating, title || null, comment || null],
      );
      const reviewId = reviewResult.rows[0].id;

      if (images.length) {
        const imageValues = images.slice(0, 5).map((imageUrl) => [reviewId, imageUrl]);
        const placeholders = imageValues.map((_, index) => `($${index * 2 + 1}, $${index * 2 + 2})`).join(",");
        const flat = imageValues.flat();
        await client.query(`INSERT INTO review_images (review_id, image_url) VALUES ${placeholders}`, flat);
      }

      await client.query("COMMIT");
      return res.status(201).json({ success: true, message: "Review submitted successfully", reviewId });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Create product review error", error.stack || error);
    try {
      console.error("Request body was:", req.body);
      if (req.files) console.error("Uploaded files:", req.files.map((f) => f.filename));
    } catch (e) {
      console.error("Error while logging request details", e);
    }
    // also persist error details to a file for easier debugging
    try {
      const fs = require("fs");
      const path = require("path");
      const logPath = path.join(__dirname, "..", "..", "logs", "review_errors.log");
      const entry = [`TIME: ${new Date().toISOString()}`, error.stack || String(error), `BODY: ${JSON.stringify(req.body)}`, `FILES: ${req.files ? JSON.stringify(req.files.map(f=>f.filename)) : '[]'}`, '---'].join("\n");
      fs.appendFileSync(logPath, entry + "\n", "utf8");
    } catch (e) {
      console.error('Failed to write review error log', e);
    }

    res.status(500).json({ message: "Server error while submitting review" });
  }
};

exports.updateProductReview = async (req, res) => {
  const { id } = req.params;
  const userId = req.user?.id;

  // Parse fields from multipart or JSON body
  const rating = req.body.rating ? Number(req.body.rating) : null;
  const title = req.body.title;
  const comment = req.body.comment;

  // Build images array from uploaded files or from provided URLs
  let images = [];
  if (req.files && req.files.length) {
    images = req.files.map((f) => `${req.protocol}://${req.get("host")}/uploads/review_images/${f.filename}`);
  } else if (req.body.images) {
    images = Array.isArray(req.body.images)
      ? req.body.images
      : String(req.body.images)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
  }

  if (!Array.isArray(images)) return res.status(400).json({ message: "Images must be an array" });
  if (images.length > 5) return res.status(400).json({ message: "Maximum 5 review images are allowed" });
  if (rating && (rating < 1 || rating > 5)) return res.status(400).json({ message: "Rating must be between 1 and 5" });

  try {
    const existing = await pool.query(`SELECT buyer_id, status FROM product_reviews WHERE id = $1`, [id]);
    if (existing.rows.length === 0 || existing.rows[0].status === 'deleted') {
      return res.status(404).json({ message: "Review not found" });
    }
    if (existing.rows[0].buyer_id !== userId) return res.status(403).json({ message: "You can only edit your own review" });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE product_reviews SET rating = COALESCE($1, rating), title = COALESCE($2, title), comment = COALESCE($3, comment), updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
        [rating || null, title || null, comment || null, id],
      );
      await client.query(`DELETE FROM review_images WHERE review_id = $1`, [id]);
      if (images.length) {
        const values = images.slice(0, 5).map((imageUrl) => [id, imageUrl]);
        const placeholders = values.map((_, index) => `($${index * 2 + 1}, $${index * 2 + 2})`).join(",");
        const flat = values.flat();
        await client.query(`INSERT INTO review_images (review_id, image_url) VALUES ${placeholders}`, flat);
      }
      await client.query("COMMIT");
      return res.status(200).json({ success: true, message: "Review updated successfully" });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Update review error", error);
    res.status(500).json({ message: "Server error while updating review" });
  }
};

exports.deleteProductReview = async (req, res) => {
  const { id } = req.params;
  const userId = req.user?.id;

  try {
    const existing = await pool.query(`SELECT buyer_id, status FROM product_reviews WHERE id = $1`, [id]);
    if (existing.rows.length === 0 || existing.rows[0].status === 'deleted') {
      return res.status(404).json({ message: "Review not found" });
    }
    if (existing.rows[0].buyer_id !== userId) return res.status(403).json({ message: "You can only delete your own review" });
    await pool.query(`UPDATE product_reviews SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
    return res.status(200).json({ success: true, message: "Review deleted successfully" });
  } catch (error) {
    console.error("Delete review error", error);
    res.status(500).json({ message: "Server error while deleting review" });
  }
};

exports.getMyReviews = async (req, res) => {
  const userId = req.user?.id;
  const { type = "all" } = req.query;

  try {
    const payload = {};

    if (type === "all" || type === "product") {
      const productReviews = await pool.query(
        `SELECT pr.*, p.name AS product_name, p.global_image_url AS product_image,
                COALESCE(json_agg(ri.image_url) FILTER (WHERE ri.id IS NOT NULL), '[]'::json) AS images,
                COALESCE(su.first_name || ' ' || su.last_name, '') AS seller_name
         FROM product_reviews pr
         JOIN products p ON p.id = pr.product_id
         LEFT JOIN review_images ri ON ri.review_id = pr.id
         LEFT JOIN users su ON su.id = pr.seller_id
         WHERE pr.buyer_id = $1 AND pr.status != 'deleted'
         GROUP BY pr.id, p.name, p.global_image_url, su.first_name, su.last_name
         ORDER BY pr.created_at DESC`,
        [userId],
      );
      payload.productReviews = productReviews.rows;
    }

    if (type === "all" || type === "seller") {
      const sellerReviews = await pool.query(
        `SELECT sr.*, u.first_name || ' ' || u.last_name AS seller_name,
                o.order_number, p.name AS product_name
         FROM seller_reviews sr
         JOIN users u ON u.id = sr.seller_id
         LEFT JOIN orders o ON o.id = sr.order_id
         LEFT JOIN supplier_inventory si ON o.inventory_item_id = si.id
         LEFT JOIN products p ON si.product_id = p.id
         WHERE sr.buyer_id = $1 AND sr.status != 'deleted'
         ORDER BY sr.created_at DESC`,
        [userId],
      );
      payload.sellerReviews = sellerReviews.rows;
    }

    res.status(200).json(payload);
  } catch (error) {
    console.error("My reviews error", error);
    res.status(500).json({ message: "Server error while fetching your reviews" });
  }
};

exports.getProductReviews = async (req, res) => {
  const { id } = req.params;
  const { page = 1, limit = 8, sort = "recent", filter = "all" } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  let orderBy = "pr.created_at DESC";
  if (sort === "highest") orderBy = "pr.rating DESC, pr.created_at DESC";
  if (sort === "lowest") orderBy = "pr.rating ASC, pr.created_at DESC";
  if (sort === "oldest") orderBy = "pr.created_at ASC";
  if (sort === "photos") orderBy = "(SELECT COUNT(*) FROM review_images ri WHERE ri.review_id = pr.id) DESC, pr.created_at DESC";

  let whereClause = "WHERE pr.product_id = $1 AND pr.status = 'active'";
  const queryParams = [id];
  if (filter === "verified") {
    whereClause += " AND pr.is_verified_purchase = TRUE";
  } else if (filter === "photos") {
    whereClause += " AND EXISTS (SELECT 1 FROM review_images ri WHERE ri.review_id = pr.id)";
  }

  try {
    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM product_reviews pr ${whereClause}`, queryParams);
    const result = await pool.query(
      `SELECT pr.*, u.first_name || ' ' || u.last_name AS buyer_name,
              COALESCE(json_agg(ri.image_url) FILTER (WHERE ri.id IS NOT NULL), '[]'::json) AS images,
              (SELECT COUNT(*) FROM review_helpful_votes rhv WHERE rhv.review_id = pr.id) AS helpful_count,
              (SELECT EXISTS (SELECT 1 FROM review_helpful_votes rhv WHERE rhv.review_id = pr.id AND rhv.user_id = $2)) AS user_helpful,
              (SELECT json_build_object('id', rr.id, 'message', rr.message, 'user_id', rr.user_id, 'created_at', rr.created_at, 'updated_at', rr.updated_at)
               FROM review_replies rr
               WHERE rr.review_id = pr.id AND rr.review_type = 'product' LIMIT 1) AS reply
       FROM product_reviews pr
       JOIN users u ON u.id = pr.buyer_id
       LEFT JOIN review_images ri ON ri.review_id = pr.id
       ${whereClause}
       GROUP BY pr.id, u.first_name, u.last_name
       ORDER BY ${orderBy}
       LIMIT $3 OFFSET $4`,
      [...queryParams, req.user?.id || null, Number(limit), offset],
    );
    const summary = await buildProductReviewSummary(id);
    res.status(200).json({ reviews: result.rows, summary, page: Number(page), limit: Number(limit), total: countResult.rows[0].total });
  } catch (error) {
    console.error("Get product reviews error", error);
    res.status(500).json({ message: "Server error while fetching product reviews" });
  }
};

exports.submitHelpfulVote = async (req, res) => {
  const userId = req.user?.id;
  const { reviewId } = req.body;
  if (!reviewId) return res.status(400).json({ message: "Review ID is required" });
  try {
    const reviewResult = await pool.query(`SELECT id FROM product_reviews WHERE id = $1 AND status = 'active'`, [reviewId]);
    if (reviewResult.rows.length === 0) {
      return res.status(404).json({ message: "Review not found" });
    }

    const existing = await pool.query(`SELECT id FROM review_helpful_votes WHERE review_id = $1 AND user_id = $2`, [reviewId, userId]);
    if (existing.rows.length) {
      await pool.query(`DELETE FROM review_helpful_votes WHERE review_id = $1 AND user_id = $2`, [reviewId, userId]);
      const countResult = await pool.query(`SELECT COUNT(*)::int AS helpful_count FROM review_helpful_votes WHERE review_id = $1`, [reviewId]);
      return res.status(200).json({ success: true, message: "Helpful vote removed", helpful_count: countResult.rows[0].helpful_count });
    }
    await pool.query(`INSERT INTO review_helpful_votes (review_id, user_id) VALUES ($1, $2)`, [reviewId, userId]);
    const countResult = await pool.query(`SELECT COUNT(*)::int AS helpful_count FROM review_helpful_votes WHERE review_id = $1`, [reviewId]);
    return res.status(201).json({ success: true, message: "Helpful vote recorded", helpful_count: countResult.rows[0].helpful_count });
  } catch (error) {
    console.error("Helpful vote error", error);
    res.status(500).json({ message: "Server error while updating helpful vote" });
  }
};

exports.reportReview = async (req, res) => {
  const userId = req.user?.id;
  const { reviewId, reviewType = "product", reason, details } = req.body;
  if (!reviewId) return res.status(400).json({ message: "Review ID is required" });
  if (!ALLOWED_REPORT_REASONS.includes(reason)) return res.status(400).json({ message: "Invalid report reason" });

  const normalizedType = reviewType.toLowerCase();
  if (!PRODUCT_REVIEW_TYPES.includes(normalizedType)) {
    return res.status(400).json({ message: "Invalid review type" });
  }

  try {
    const reviewCheckQuery = normalizedType === "seller"
      ? `SELECT id FROM seller_reviews WHERE id = $1 AND status = 'active'`
      : `SELECT id FROM product_reviews WHERE id = $1 AND status = 'active'`;
    const reviewCheck = await pool.query(reviewCheckQuery, [reviewId]);
    if (reviewCheck.rows.length === 0) {
      return res.status(404).json({ message: "Review not found or not eligible for reporting" });
    }

    const insertQuery = `INSERT INTO review_reports (review_id, review_type, user_id, reason, details, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         ON CONFLICT (review_id, user_id, review_type) DO NOTHING`;

    const result = await pool.query(insertQuery, [reviewId, normalizedType, userId, reason, details || null]);
    if (result.rowCount === 0) {
      return res.status(409).json({ message: "You have already reported this review" });
    }
    return res.status(201).json({ success: true, message: "Review reported successfully" });
  } catch (error) {
    console.error("Review report error", error);
    res.status(500).json({ message: "Server error while reporting review" });
  }
};

exports.createSellerReview = async (req, res) => {
  const userId = req.user?.id;
  const { sellerId, orderId, overallExperience, productQuality, deliveryExperience, communication, comment } = req.body;

  if (!sellerId || !orderId) return res.status(400).json({ message: "Seller ID and order ID are required" });
  const values = [overallExperience, productQuality, deliveryExperience, communication];
  if (values.some((val) => typeof val !== 'number' || val < 1 || val > 5)) {
    return res.status(400).json({ message: "All seller ratings must be numbers between 1 and 5" });
  }
  if (sellerId === userId) {
    return res.status(400).json({ message: "Suppliers cannot review themselves" });
  }

  try {
    const order = await getEligibleSellerOrder(userId, sellerId, orderId);
    if (!order) {
      return res.status(403).json({ message: "Only verified buyers can review suppliers after delivery" });
    }

    const existing = await pool.query(
      `SELECT id FROM seller_reviews WHERE buyer_id = $1 AND seller_id = $2 AND order_id = $3 AND status != 'deleted'`,
      [userId, sellerId, orderId],
    );
    if (existing.rows.length) {
      return res.status(409).json({ message: "You have already reviewed this order for this supplier" });
    }

    await pool.query(
      `INSERT INTO seller_reviews (buyer_id, seller_id, order_id, overall_experience, product_quality, delivery_experience, communication, comment, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')`,
      [userId, sellerId, orderId, overallExperience, productQuality, deliveryExperience, communication, comment || null],
    );
    return res.status(201).json({ success: true, message: "Seller review submitted successfully" });
  } catch (error) {
    console.error("Seller review error", error);
    res.status(500).json({ message: "Server error while submitting seller review" });
  }
};

exports.getSellerReviews = async (req, res) => {
  const { id } = req.params;
  const { page = 1, limit = 8, sort = "recent" } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  let orderBy = "sr.created_at DESC";
  if (sort === "highest") orderBy = "sr.overall_experience DESC, sr.created_at DESC";
  if (sort === "lowest") orderBy = "sr.overall_experience ASC, sr.created_at DESC";
  if (sort === "oldest") orderBy = "sr.created_at ASC";

  try {
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM seller_reviews sr WHERE sr.seller_id = $1 AND sr.status = 'active'`,
      [id],
    );

    const result = await pool.query(
      `SELECT sr.*, u.first_name || ' ' || u.last_name AS buyer_name,
              (sr.overall_experience + sr.product_quality + sr.delivery_experience + sr.communication) / 4.0 AS average_rating,
              (SELECT json_build_object('id', rr.id, 'message', rr.message, 'user_id', rr.user_id, 'created_at', rr.created_at, 'updated_at', rr.updated_at)
               FROM review_replies rr
               WHERE rr.review_id = sr.id AND rr.review_type = 'seller' LIMIT 1) AS reply
       FROM seller_reviews sr
       JOIN users u ON u.id = sr.buyer_id
       WHERE sr.seller_id = $1 AND sr.status = 'active'
       ORDER BY ${orderBy}
       LIMIT $2 OFFSET $3`,
      [id, Number(limit), offset],
    );

    const summary = await buildSellerReviewSummary(id);
    res.status(200).json({ reviews: result.rows, summary, page: Number(page), limit: Number(limit), total: countResult.rows[0].total });
  } catch (error) {
    console.error("Seller review fetch error", error);
    res.status(500).json({ message: "Server error while fetching seller reviews" });
  }
};

exports.createReply = async (req, res) => {
  const userId = req.user?.id;
  const userRole = req.user?.role;
  const { reviewId, reviewType = "product", message } = req.body;

  if (!reviewId) return res.status(400).json({ message: "Review ID is required" });
  if (!message?.trim()) return res.status(400).json({ message: "Reply message is required" });

  const normalizedType = reviewType.toLowerCase();
  if (!PRODUCT_REVIEW_TYPES.includes(normalizedType)) {
    return res.status(400).json({ message: "Invalid review type" });
  }

  try {
    let reviewRow;
    if (normalizedType === "product") {
      const result = await pool.query(
        `SELECT pr.id, pr.seller_id FROM product_reviews pr WHERE pr.id = $1 AND pr.status = 'active'`,
        [reviewId],
      );
      reviewRow = result.rows[0];
    } else {
      const result = await pool.query(
        `SELECT sr.id, sr.seller_id FROM seller_reviews sr WHERE sr.id = $1 AND sr.status = 'active'`,
        [reviewId],
      );
      reviewRow = result.rows[0];
    }

    if (!reviewRow) {
      return res.status(404).json({ message: "Review not found" });
    }

    if (userRole !== "admin" && userId !== reviewRow.seller_id) {
      return res.status(403).json({ message: "Only the seller or admin can reply to this review" });
    }

    const query = `INSERT INTO review_replies (review_id, review_type, user_id, message)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (review_id, review_type) DO UPDATE SET message = EXCLUDED.message, updated_at = CURRENT_TIMESTAMP`;

    await pool.query(query, [reviewId, normalizedType, userId, message.trim()]);
    return res.status(201).json({ success: true, message: "Reply saved successfully" });
  } catch (error) {
    console.error("Reply save error", error);
    res.status(500).json({ message: "Server error while saving reply" });
  }
};

exports.listAdminReviews = async (req, res) => {
  const {
    type = "product",
    productId,
    sellerId,
    buyerId,
    rating,
    status,
    reportStatus,
    startDate,
    endDate,
    page = 1,
    limit = 20,
  } = req.query;

  const normalizedType = type.toLowerCase();
  const offset = (Number(page) - 1) * Number(limit);
  const params = [];
  const clauses = [];
  let mainQuery;
  let countQuery;

  if (normalizedType === "seller") {
    mainQuery = `
      SELECT sr.id, sr.seller_id, sr.buyer_id, sr.order_id, sr.overall_experience AS rating, sr.status, sr.created_at,
             u.first_name || ' ' || u.last_name AS buyer_name,
             su.first_name || ' ' || su.last_name AS seller_name,
             COALESCE(r.report_count, 0) AS report_count,
             r.report_status
      FROM seller_reviews sr
      JOIN users u ON u.id = sr.buyer_id
      JOIN users su ON su.id = sr.seller_id
      LEFT JOIN (
        SELECT review_id, COUNT(*) AS report_count, MAX(status) AS report_status
        FROM review_reports
        WHERE review_type = 'seller'
        GROUP BY review_id
      ) r ON r.review_id = sr.id
      WHERE 1=1`;
    countQuery = `SELECT COUNT(*)::int AS total FROM seller_reviews sr WHERE 1=1`;
    if (sellerId) {
      params.push(sellerId);
      clauses.push(`sr.seller_id = $${params.length}`);
    }
  } else {
    mainQuery = `
      SELECT pr.id, pr.product_id, pr.seller_id, pr.buyer_id, pr.order_id, pr.rating, pr.status, pr.created_at,
             p.name AS product_name,
             u.first_name || ' ' || u.last_name AS buyer_name,
             COALESCE(r.report_count, 0) AS report_count,
             r.report_status
      FROM product_reviews pr
      JOIN products p ON p.id = pr.product_id
      JOIN users u ON u.id = pr.buyer_id
      LEFT JOIN (
        SELECT review_id, COUNT(*) AS report_count, MAX(status) AS report_status
        FROM review_reports
        WHERE review_type = 'product'
        GROUP BY review_id
      ) r ON r.review_id = pr.id
      WHERE 1=1`;
    countQuery = `SELECT COUNT(*)::int AS total FROM product_reviews pr WHERE 1=1`;
    if (productId) {
      params.push(productId);
      clauses.push(`pr.product_id = $${params.length}`);
    }
  }

  if (buyerId) {
    params.push(buyerId);
    clauses.push(`buyer_id = $${params.length}`);
  }
  if (rating) {
    params.push(Number(rating));
    clauses.push(`rating = $${params.length}`);
  }
  if (status) {
    params.push(status);
    clauses.push(`status = $${params.length}`);
  }
  if (reportStatus) {
    params.push(reportStatus);
    clauses.push(`COALESCE(report_status, '') = $${params.length}`);
  }
  if (startDate) {
    params.push(startDate);
    clauses.push(`created_at >= $${params.length}`);
  }
  if (endDate) {
    params.push(endDate);
    clauses.push(`created_at <= $${params.length}`);
  }

  if (clauses.length) {
    const filterClause = ` AND ${clauses.join(" AND ")}`;
    mainQuery += filterClause;
    countQuery += filterClause;
  }

  mainQuery += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(Number(limit), offset);

  try {
    const [rows, countResult] = await Promise.all([
      pool.query(mainQuery, params),
      pool.query(countQuery, params.slice(0, params.length - 2)),
    ]);

    res.status(200).json({ reviews: rows.rows, total: countResult.rows[0].total, page: Number(page), limit: Number(limit) });
  } catch (error) {
    console.error("Admin reviews fetch error", error);
    res.status(500).json({ message: "Server error while fetching reviews" });
  }
};

exports.updateReviewStatus = async (req, res) => {
  const { id } = req.params;
  const { status, reviewType = "product" } = req.body;
  const normalizedType = reviewType.toLowerCase();
  if (!PRODUCT_REVIEW_TYPES.includes(normalizedType)) {
    return res.status(400).json({ message: "Invalid review type" });
  }
  try {
    const table = normalizedType === "seller" ? "seller_reviews" : "product_reviews";
    await pool.query(`UPDATE ${table} SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [status, id]);
    res.status(200).json({ success: true, message: "Review status updated" });
  } catch (error) {
    console.error("Review status update error", error);
    res.status(500).json({ message: "Server error while updating review status" });
  }
};

exports.deleteReviewAdmin = async (req, res) => {
  const { id } = req.params;
  const { reviewType = "product" } = req.query;
  const normalizedType = reviewType.toLowerCase();
  if (!PRODUCT_REVIEW_TYPES.includes(normalizedType)) {
    return res.status(400).json({ message: "Invalid review type" });
  }
  try {
    const table = normalizedType === "seller" ? "seller_reviews" : "product_reviews";
    await pool.query(`UPDATE ${table} SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
    res.status(200).json({ success: true, message: "Review deleted" });
  } catch (error) {
    console.error("Admin delete review error", error);
    res.status(500).json({ message: "Server error while deleting review" });
  }
};

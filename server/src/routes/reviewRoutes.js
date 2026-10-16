const express = require("express");
const authenticateToken = require("../middlewares/authMiddleware");
const authorizeRoles = require("../middlewares/roleMiddleware");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Ensure uploads folder exists
const uploadDir = path.join(__dirname, "..", "..", "uploads", "review_images");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const name = Date.now() + "-" + Math.round(Math.random() * 1e9) + ext;
    cb(null, name);
  },
});

const upload = multer({ storage });
const {
  createProductReview,
  updateProductReview,
  deleteProductReview,
  getMyReviews,
  getProductReviews,
  submitHelpfulVote,
  reportReview,
  createSellerReview,
  getSellerReviews,
  createReply,
  listAdminReviews,
  updateReviewStatus,
  deleteReviewAdmin,
} = require("../controllers/reviewController");

const router = express.Router();

router.post("/product", authenticateToken, authorizeRoles("buyer", "both"), upload.array("images", 5), createProductReview);
router.put("/product/:id", authenticateToken, authorizeRoles("buyer", "both"), upload.array("images", 5), updateProductReview);
router.delete("/product/:id", authenticateToken, authorizeRoles("buyer", "both"), deleteProductReview);
router.get("/my", authenticateToken, authorizeRoles("buyer", "both"), getMyReviews);
router.post("/helpful", authenticateToken, submitHelpfulVote);
router.post("/report", authenticateToken, reportReview);
router.post("/seller", authenticateToken, authorizeRoles("buyer", "both"), createSellerReview);
router.post("/reply", authenticateToken, authorizeRoles("seller", "both", "admin"), createReply);

router.get("/admin", authenticateToken, authorizeRoles("admin"), listAdminReviews);
router.patch("/admin/:id/status", authenticateToken, authorizeRoles("admin"), updateReviewStatus);
router.delete("/admin/:id", authenticateToken, authorizeRoles("admin"), deleteReviewAdmin);

router.get("/products/:id/reviews", getProductReviews);
router.get("/sellers/:id/reviews", getSellerReviews);

module.exports = router;

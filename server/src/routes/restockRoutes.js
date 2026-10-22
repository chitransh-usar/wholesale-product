const express = require("express");
const authenticateToken = require("../middlewares/authMiddleware");
const authorizeRoles = require("../middlewares/roleMiddleware");
const {
  getSummary,
  getProducts,
  getProductDetail,
  recalculateForecasts,
  getReport,
} = require("../controllers/restockController");

const router = express.Router();

router.use(authenticateToken);
router.use(authorizeRoles("seller", "both"));

router.get("/summary", getSummary);
router.get("/products", getProducts);
router.get("/product/:id", getProductDetail);
router.post("/recalculate", recalculateForecasts);
router.get("/report", getReport);

module.exports = router;

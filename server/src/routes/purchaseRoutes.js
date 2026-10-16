const express = require("express");
const {
  createPurchase,
  listPurchases,
  getPurchaseById,
  updatePurchase,
  updatePurchaseStatus,
} = require("../controllers/purchaseController");
const authenticateToken = require("../middlewares/authMiddleware");
const authorizeRoles = require("../middlewares/roleMiddleware");
const { requirePermission } = require("../middlewares/businessContext");

const router = express.Router();

// A purchase book belongs to a wholesaler. Nothing here is buyer facing.
router.use(authenticateToken, authorizeRoles("seller", "both"));

router.get("/", requirePermission("purchases"), listPurchases);
router.post("/", requirePermission("purchases"), createPurchase);
router.get("/:id", requirePermission("purchases"), getPurchaseById);
router.put("/:id", requirePermission("purchases"), updatePurchase);
router.patch("/:id/status", requirePermission("purchases"), updatePurchaseStatus);

module.exports = router;

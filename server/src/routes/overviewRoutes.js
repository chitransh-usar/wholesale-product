const express = require("express");
const { getOverview, getBreakdown } = require("../controllers/overviewController");
const authenticateToken = require("../middlewares/authMiddleware");
const authorizeRoles = require("../middlewares/roleMiddleware");
const { requirePermission } = require("../middlewares/businessContext");

const router = express.Router();

router.get(
  "/",
  authenticateToken,
  authorizeRoles("seller", "both"),
  getOverview,
);

// The rows behind one of the three figures on the Overview.
router.get(
  "/breakdown",
  authenticateToken,
  authorizeRoles("seller", "both"),
  // This page is nothing but money, so it is gated whole. The Overview is not:
  // the lists on it are a packer's work, and only the money block is withheld.
  requirePermission("money"),
  getBreakdown,
);

module.exports = router;

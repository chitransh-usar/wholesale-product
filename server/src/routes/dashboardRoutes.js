const express = require("express");
const {
  getInventory,
} = require("../controllers/dashboardController");
const authenticateToken = require("../middlewares/authMiddleware");
const authorizeRoles = require("../middlewares/roleMiddleware");

const router = express.Router();

// Seller-only: these expose a supplier's inventory and revenue.
router.get("/inventory", authenticateToken, authorizeRoles("seller", "both"), getInventory);

module.exports = router;

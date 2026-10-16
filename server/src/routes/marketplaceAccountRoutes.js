const express = require("express");
const authenticateToken = require("../middlewares/authMiddleware");
const authorizeRoles = require("../middlewares/roleMiddleware");
const { requirePermission } = require("../middlewares/businessContext");
const {
  listAccounts,
  addAccount,
  updateAccount,
  removeAccount,
} = require("../controllers/marketplaceAccountController");

const router = express.Router();

// A wholesaler's extra Amazon and Flipkart accounts, each its own run of bill
// numbers. Gated on settings, like the rest of how their bills are numbered.
// The sale and bill forms do not call this: they read the accounts from
// /api/masters with the rest of their dropdowns.
router.use(authenticateToken, authorizeRoles("seller", "both"), requirePermission("settings"));

router.get("/", listAccounts);
router.post("/", addAccount);
router.put("/:id", updateAccount);
router.delete("/:id", removeAccount);

module.exports = router;

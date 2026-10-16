const express = require("express");
const {
  getRouteStatus,
  startOnboarding,
  listTransfers,
} = require("../controllers/routeController");
const authenticateToken = require("../middlewares/authMiddleware");
const authorizeRoles = require("../middlewares/roleMiddleware");
const { requirePermission } = require("../middlewares/businessContext");

const router = express.Router();

/**
 * Getting paid is the owner's business, not an employee's.
 *
 * Gated on the settings permission rather than invoices: this submits the
 * owner's PAN and names the bank account their takings land in, which is a
 * different thing from being allowed to raise a bill.
 */
router.use(authenticateToken, authorizeRoles("seller", "both"));

router.get("/status", requirePermission("settings"), getRouteStatus);
router.post("/onboard", requirePermission("settings"), startOnboarding);
router.get("/transfers", requirePermission("settings"), listTransfers);

module.exports = router;

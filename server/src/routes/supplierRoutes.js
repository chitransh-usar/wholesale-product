const express = require("express");
const {
  listSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
  getSupplierStats,
  recordSupplierPayment,
} = require("../controllers/supplierController");
const authenticateToken = require("../middlewares/authMiddleware");
const authorizeRoles = require("../middlewares/roleMiddleware");
const { requirePermission } = require("../middlewares/businessContext");

const router = express.Router();

router.use(authenticateToken, authorizeRoles("seller", "both"));

// Registered before "/:id" so the word is not read as a supplier id, the same
// ordering the party routes need for "stats".
router.get("/stats", requirePermission("purchases"), getSupplierStats);

router.get("/", requirePermission("purchases"), listSuppliers);
router.post("/", requirePermission("purchases"), createSupplier);
router.get("/:id", requirePermission("purchases"), getSupplierById);
router.put("/:id", requirePermission("purchases"), updateSupplier);
// Money leaving the till. Under the same permission as the rest of the
// purchase book rather than "payments", which is the right to record money
// COMING IN: a man trusted to take cash over the counter is not automatically
// trusted to send it out to a mill.
router.post("/:id/payments", requirePermission("purchases"), recordSupplierPayment);

module.exports = router;

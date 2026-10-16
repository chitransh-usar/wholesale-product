const express = require("express");
const {
  createSale,
  listSales,
  getSaleById,
  updateSale,
  updateSaleStatus,
  createInvoiceForSale,
  getInvoiceForSale,
} = require("../controllers/saleController");
const authenticateToken = require("../middlewares/authMiddleware");
const authorizeRoles = require("../middlewares/roleMiddleware");
const { requirePermission } = require("../middlewares/businessContext");

const router = express.Router();

// A wholesaler's own sales book. Retailer-created sales will arrive through
// a separate route when ordering is built; these are the ones they records.
router.use(authenticateToken, authorizeRoles("seller", "both"));

router.get("/", requirePermission("sales"), listSales);
router.post("/", requirePermission("sales"), createSale);
router.get("/:id", requirePermission("sales"), getSaleById);
router.put("/:id", requirePermission("sales"), updateSale);
router.patch("/:id/status", requirePermission("sales"), updateSaleStatus);
router.get("/:id/invoice", requirePermission("invoices"), getInvoiceForSale);
router.post("/:id/invoice", requirePermission("invoices"), createInvoiceForSale);

module.exports = router;

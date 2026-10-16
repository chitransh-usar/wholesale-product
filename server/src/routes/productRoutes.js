const express = require("express");
const {
  addProduct,
  getPublicCatalog,
  getCatalogCities,
  getProductById,
  getInventoryItemById,
  updateInventoryItem,
  deleteInventoryItem,
  contactSupplier,
  getWholesalerById,
  getListingById,
} = require("../controllers/productController");
const authenticateToken = require("../middlewares/authMiddleware");
const authorizeRoles = require("../middlewares/roleMiddleware");
const { requirePermission } = require("../middlewares/businessContext");

const router = express.Router();

router.get("/", getPublicCatalog);
// Ahead of "/:id", or Express reads "cities" as a product id.
router.get("/cities", getCatalogCities);
router.get("/wholesaler/:id", getWholesalerById);
// Unlisted share link for a private listing. Public by design: the id is the secret.
router.get("/listing/:inventoryId", getListingById);
router.get("/:id/contact", authenticateToken, contactSupplier);
router.get("/:id", getProductById);
router.post("/", authenticateToken, authorizeRoles("seller", "both"), requirePermission("products"), addProduct);
router.get("/inventory/:id", authenticateToken, authorizeRoles("seller", "both"), getInventoryItemById);
router.put("/inventory/:id", authenticateToken, authorizeRoles("seller", "both"), requirePermission("products"), updateInventoryItem);
router.delete("/inventory/:id", authenticateToken, authorizeRoles("seller", "both"), requirePermission("products"), deleteInventoryItem);

module.exports = router;

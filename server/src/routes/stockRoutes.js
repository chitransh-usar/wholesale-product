const express = require("express");
const { getStock, getStockRegister } = require("../controllers/stockController");
const authenticateToken = require("../middlewares/authMiddleware");
const authorizeRoles = require("../middlewares/roleMiddleware");
const { requirePermission } = require("../middlewares/businessContext");

const router = express.Router();

// Stock sits behind the products permission: whoever may see what is being
// sold may see how much of it there is.
router.use(authenticateToken, authorizeRoles("seller", "both"));

router.get("/", requirePermission("products"), getStock);
router.get("/:productId", requirePermission("products"), getStockRegister);

module.exports = router;

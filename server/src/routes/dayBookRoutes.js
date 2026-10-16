const express = require("express");
const { getDayBook, getPayableAgeing } = require("../controllers/dayBookController");
const authenticateToken = require("../middlewares/authMiddleware");
const authorizeRoles = require("../middlewares/roleMiddleware");
const { requirePermission } = require("../middlewares/businessContext");

const router = express.Router();

router.use(authenticateToken, authorizeRoles("seller", "both"));

// The day book shows both sides of the book, so it sits behind the sales
// permission and leaves out what the employee may not see. See the controller.
router.get("/", requirePermission("sales"), getDayBook);
router.get("/payable", requirePermission("purchases"), getPayableAgeing);

module.exports = router;

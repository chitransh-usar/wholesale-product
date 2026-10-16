const express = require("express");
const { suggestHsn } = require("../controllers/hsnController");
const authenticateToken = require("../middlewares/authMiddleware");
const authorizeRoles = require("../middlewares/roleMiddleware");

const router = express.Router();

// Suggestions are drawn from this wholesaler's own goods, so they are their
// business's data and are behind the same guard as the rest of it. No
// permission of its own: anyone who can reach a product or a sale screen is
// already typing into the box this fills in.
router.use(authenticateToken, authorizeRoles("seller", "both"));

router.get("/suggest", suggestHsn);

module.exports = router;

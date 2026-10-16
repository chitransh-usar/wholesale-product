const express = require("express");
const {
  getProfile,
  updateProfile,
} = require("../controllers/profileController");
const authenticateToken = require("../middlewares/authMiddleware");
const { requireOwner } = require("../middlewares/businessContext");

const router = express.Router();

router.get("/", authenticateToken, getProfile);
// Owner only, and not grantable. This screen holds the GSTIN that goes on
// every invoice and the UPI id money is paid into.
router.put("/", authenticateToken, requireOwner, updateProfile);

module.exports = router;

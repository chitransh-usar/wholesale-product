const express = require("express");
const {
  register,
  login,
  getMe,
  upgradeToSeller,
} = require("../controllers/authController");
const authenticateToken = require("../middlewares/authMiddleware");

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.get("/me", authenticateToken, getMe);
router.post("/upgrade", authenticateToken, upgradeToSeller);

module.exports = router;

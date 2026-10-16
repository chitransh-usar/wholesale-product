const express = require("express");
const {
  getMasters,
  saveMasterRow,
  setMasterRowActive,
  saveSettings,
} = require("../controllers/masterController");
const { requirePlatformAdmin } = require("../middlewares/platformAdmin");
const authenticateToken = require("../middlewares/authMiddleware");

const router = express.Router();

// Reading is open to any signed in user: these are the state list, the units,
// the GST slabs and a short list of HSN codes, public facts printed on
// documents that go to customers. Gating them would only mean a buyer's
// checkout could not name the state they live in.
router.get("/", authenticateToken, getMasters);

// Writing is the platform admin's. The guard reads the flag from the database
// on every request rather than from the token, so a revoked admin loses these
// at once rather than when their session expires.
// Before "/:list", or the word "settings" is read as a list name.
router.put("/settings", authenticateToken, requirePlatformAdmin, saveSettings);
router.put("/:list/:key/active", authenticateToken, requirePlatformAdmin, setMasterRowActive);
router.put("/:list", authenticateToken, requirePlatformAdmin, saveMasterRow);

module.exports = router;

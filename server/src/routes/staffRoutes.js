const express = require("express");
const {
  listStaff,
  inviteStaff,
  updateStaff,
  setStaffStatus,
  resendInvite,
  removeStaff,
  acceptInvite,
} = require("../controllers/staffController");
const authenticateToken = require("../middlewares/authMiddleware");
const { requireOwner } = require("../middlewares/businessContext");

const router = express.Router();

// The employee's way in. Public by necessity: they have no account yet, and the
// code in the body is the credential.
router.post("/accept", acceptInvite);

// Everything else is the owner's, and only the owner's. An employee who could
// edit permissions could grant themselves the rest of them, so this is the one
// part of the dashboard that is not delegable.
router.use(authenticateToken, requireOwner);

router.get("/", listStaff);
router.post("/", inviteStaff);
router.patch("/:id", updateStaff);
router.post("/:id/status", setStaffStatus);
router.post("/:id/invite", resendInvite);
router.delete("/:id", removeStaff);

module.exports = router;

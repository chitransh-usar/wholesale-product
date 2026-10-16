const express = require("express");
const authenticateToken = require("../middlewares/authMiddleware");
const authorizeRoles = require("../middlewares/roleMiddleware");
const {
  getNotifications,
  getUnreadNotifications,
  markNotificationRead,
  markAllRead,
  deleteNotification,
  getPreferences,
  updatePreferences,
  addDeviceToken,
  removeDeviceToken,
  getAdminNotifications,
  getNotificationLogs,
  sendAdminNotification,
} = require("../controllers/notificationController");

const router = express.Router();

router.use(authenticateToken);

router.get("/", getNotifications);
router.get("/unread", getUnreadNotifications);
router.patch("/:id/read", markNotificationRead);
router.patch("/read-all", markAllRead);
router.delete("/:id", deleteNotification);
router.get("/preferences", getPreferences);
router.put("/preferences", updatePreferences);
router.post("/device-token", addDeviceToken);
router.delete("/device-token", removeDeviceToken);

router.get("/admin/notifications", authorizeRoles("admin"), getAdminNotifications);
router.get("/admin/notification-logs", authorizeRoles("admin"), getNotificationLogs);
router.post("/admin/send-notification", authorizeRoles("admin"), sendAdminNotification);

module.exports = router;

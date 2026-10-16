const pool = require("../config/db");
const {
  getUserPreferences,
  ensureNotificationPreferences,
  enqueueNotification,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
} = require("../services/notificationManager");

const getNotifications = async (req, res) => {
  const userId = req.user.id;
  const search = req.query.search || "";
  const type = req.query.type || "";
  const startDate = req.query.startDate;
  const endDate = req.query.endDate;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, parseInt(req.query.limit, 10) || 20);
  const offset = (page - 1) * limit;

  let query = `SELECT * FROM notifications WHERE user_id = $1`;
  const params = [userId];

  if (search) {
    params.push(`%${search}%`);
    query += ` AND (title ILIKE $${params.length} OR message ILIKE $${params.length})`;
  }
  if (type) {
    params.push(type);
    query += ` AND notification_type = $${params.length}`;
  }
  if (startDate) {
    params.push(startDate);
    query += ` AND created_at >= $${params.length}`;
  }
  if (endDate) {
    params.push(endDate);
    query += ` AND created_at <= $${params.length}`;
  }

  query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  try {
    const result = await pool.query(query, params);
    const count = await pool.query("SELECT COUNT(*) FROM notifications WHERE user_id = $1", [userId]);
    res.json({ success: true, notifications: result.rows, total: Number(count.rows[0].count), page, limit });
  } catch (error) {
    console.error("Error fetching notifications", error);
    res.status(500).json({ success: false, message: "Server error fetching notifications" });
  }
};

const getUnreadNotifications = async (req, res) => {
  const userId = req.user.id;
  try {
    const result = await pool.query("SELECT * FROM notifications WHERE user_id = $1 AND is_read = false ORDER BY created_at DESC", [userId]);
    res.json({ success: true, unread: result.rows });
  } catch (error) {
    console.error("Error fetching unread notifications", error);
    res.status(500).json({ success: false, message: "Server error fetching unread notifications" });
  }
};

const markNotificationRead = async (req, res) => {
  const userId = req.user.id;
  const notificationId = parseInt(req.params.id, 10);
  if (Number.isNaN(notificationId)) return res.status(400).json({ success: false, message: "Invalid notification id" });

  try {
    const { rows } = await pool.query("SELECT user_id FROM notifications WHERE id = $1", [notificationId]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: "Notification not found" });
    if (rows[0].user_id !== userId) return res.status(403).json({ success: false, message: "Forbidden" });

    await pool.query("UPDATE notifications SET is_read = true WHERE id = $1", [notificationId]);
    res.json({ success: true, message: "Notification marked as read" });
  } catch (error) {
    console.error("Error marking notification read", error);
    res.status(500).json({ success: false, message: "Server error updating notification" });
  }
};

const markAllRead = async (req, res) => {
  const userId = req.user.id;
  try {
    await pool.query("UPDATE notifications SET is_read = true WHERE user_id = $1", [userId]);
    res.json({ success: true, message: "All notifications marked read" });
  } catch (error) {
    console.error("Error marking all notifications read", error);
    res.status(500).json({ success: false, message: "Server error updating notifications" });
  }
};

const deleteNotification = async (req, res) => {
  const userId = req.user.id;
  const notificationId = parseInt(req.params.id, 10);
  if (Number.isNaN(notificationId)) return res.status(400).json({ success: false, message: "Invalid notification id" });

  try {
    const { rows } = await pool.query("SELECT user_id FROM notifications WHERE id = $1", [notificationId]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: "Notification not found" });
    if (rows[0].user_id !== userId) return res.status(403).json({ success: false, message: "Forbidden" });

    await pool.query("DELETE FROM notifications WHERE id = $1", [notificationId]);
    res.json({ success: true, message: "Notification deleted" });
  } catch (error) {
    console.error("Error deleting notification", error);
    res.status(500).json({ success: false, message: "Server error deleting notification" });
  }
};

const getPreferences = async (req, res) => {
  const userId = req.user.id;
  try {
    const preferences = await ensureNotificationPreferences(userId);
    res.json({ success: true, preferences });
  } catch (error) {
    console.error("Error fetching preferences", error);
    res.status(500).json({ success: false, message: "Server error fetching preferences" });
  }
};

const updatePreferences = async (req, res) => {
  const userId = req.user.id;
  const {
    email_enabled,
    sms_enabled,
    push_enabled,
    whatsapp_enabled,
    marketing_enabled,
    order_updates_enabled,
    inventory_enabled,
  } = req.body;

  try {
    const { rows } = await pool.query("SELECT id FROM notification_preferences WHERE user_id = $1", [userId]);
    if (rows.length === 0) {
      await pool.query(
        `INSERT INTO notification_preferences (user_id, email_enabled, sms_enabled, push_enabled, whatsapp_enabled, marketing_enabled, order_updates_enabled, inventory_enabled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [userId, email_enabled, sms_enabled, push_enabled, whatsapp_enabled, marketing_enabled, order_updates_enabled, inventory_enabled],
      );
    } else {
      await pool.query(
        `UPDATE notification_preferences SET email_enabled = COALESCE($1, email_enabled), sms_enabled = COALESCE($2, sms_enabled), push_enabled = COALESCE($3, push_enabled), whatsapp_enabled = COALESCE($4, whatsapp_enabled), marketing_enabled = COALESCE($5, marketing_enabled), order_updates_enabled = COALESCE($6, order_updates_enabled), inventory_enabled = COALESCE($7, inventory_enabled), updated_at = NOW() WHERE user_id = $8`,
        [email_enabled, sms_enabled, push_enabled, whatsapp_enabled, marketing_enabled, order_updates_enabled, inventory_enabled, userId],
      );
    }
    res.json({ success: true, message: "Preferences updated" });
  } catch (error) {
    console.error("Error updating preferences", error);
    res.status(500).json({ success: false, message: "Server error updating preferences" });
  }
};

const addDeviceToken = async (req, res) => {
  const userId = req.user.id;
  const { token, platform } = req.body;
  if (!token || !platform) {
    return res.status(400).json({ success: false, message: "Token and platform are required" });
  }

  try {
    await pool.query(
      `INSERT INTO device_tokens (user_id, token, platform) VALUES ($1,$2,$3) ON CONFLICT (user_id, token) DO NOTHING`,
      [userId, token, platform],
    );
    res.json({ success: true, message: "Device token added" });
  } catch (error) {
    console.error("Error adding device token", error);
    res.status(500).json({ success: false, message: "Server error adding device token" });
  }
};

const removeDeviceToken = async (req, res) => {
  const userId = req.user.id;
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ success: false, message: "Token is required" });
  }

  try {
    await pool.query("DELETE FROM device_tokens WHERE user_id = $1 AND token = $2", [userId, token]);
    res.json({ success: true, message: "Device token removed" });
  } catch (error) {
    console.error("Error removing device token", error);
    res.status(500).json({ success: false, message: "Server error removing device token" });
  }
};

const getAdminNotifications = async (req, res) => {
  try {
    const result = await pool.query(`SELECT n.*, u.email, u.role FROM notifications n JOIN users u ON n.user_id = u.id ORDER BY n.created_at DESC LIMIT 200`);
    res.json({ success: true, notifications: result.rows });
  } catch (error) {
    console.error("Error fetching admin notifications", error);
    res.status(500).json({ success: false, message: "Server error fetching admin notifications" });
  }
};

const getNotificationLogs = async (req, res) => {
  try {
    const result = await pool.query(`SELECT nl.*, n.user_id, n.title, n.notification_type FROM notification_logs nl JOIN notifications n ON nl.notification_id = n.id ORDER BY nl.sent_at DESC LIMIT 200`);
    res.json({ success: true, logs: result.rows });
  } catch (error) {
    console.error("Error fetching notification logs", error);
    res.status(500).json({ success: false, message: "Server error fetching notification logs" });
  }
};

const sendAdminNotification = async (req, res) => {
  const { userId, title, message, notificationType, referenceId, referenceType, channels } = req.body;
  if (!userId || !title || !message) {
    return res.status(400).json({ success: false, message: "userId, title, and message are required" });
  }

  try {
    await enqueueNotification({
      userId,
      title,
      message,
      notificationType: notificationType || NOTIFICATION_TYPES.promotion,
      channels: channels || [NOTIFICATION_CHANNELS.IN_APP],
      referenceId,
      referenceType,
    });
    res.json({ success: true, message: "Notification queued" });
  } catch (error) {
    console.error("Error sending admin notification", error);
    res.status(500).json({ success: false, message: "Server error sending notification" });
  }
};

module.exports = {
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
};

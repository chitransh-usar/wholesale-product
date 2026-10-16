const pool = require("../config/db");
const { sendEmail } = require("./emailService");
const { sendSms } = require("./smsService");
const { sendPushNotification } = require("./pushService");
const { sendWhatsApp } = require("./whatsappService");
const { emitUserNotification, emitUnreadCount } = require("./socketService");

const NOTIFICATION_CHANNELS = {
  IN_APP: "in_app",
  EMAIL: "email",
  SMS: "sms",
  PUSH: "push",
  WHATSAPP: "whatsapp",
};

const NOTIFICATION_TYPES = {
  order_update: "order_update",
  payment_update: "payment_update",
  promotion: "promotion",
  inventory: "inventory",
  review: "review",
  auth: "auth",
};

/**
 * Whether the notifications table still carries the older "type" column.
 *
 * It does, it is NOT NULL, and it has no default, while everything here was
 * writing only the newer "notification_type". Every insert therefore failed
 * on the not null constraint, and because notifications are fire and forget
 * the error was swallowed by each caller in turn. The result was an app in
 * which the bell never showed anything and nobody was told why.
 *
 * Both columns are written, with the same value, so the record is right for
 * whichever one a reader happens to use. Asked once and remembered, so a
 * database that is behind on migrations still works.
 */
let hasLegacyType = null;
const legacyTypeColumn = async () => {
  if (hasLegacyType === null) {
    const { rows } = await pool.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'notifications'
            AND column_name = 'type'
       ) AS yes`,
    );
    hasLegacyType = rows[0].yes;
  }
  return hasLegacyType;
};

// For tests, which rebuild the schema underneath a running process.
const resetNotificationSchema = () => {
  hasLegacyType = null;
};

const createNotificationRecord = async ({ userId, title, message, notificationType, channel, referenceId = null, referenceType = null, priority = "normal" }) => {
  const legacy = await legacyTypeColumn();
  const columns = [
    "user_id", "title", "message", "notification_type", "channel",
    "reference_id", "reference_type", "priority",
  ];
  const values = [userId, title, message, notificationType, channel, referenceId, referenceType, priority];
  if (legacy) {
    columns.push("type");
    values.push(notificationType);
  }
  const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
  const query = `INSERT INTO notifications (${columns.join(", ")}, is_read, created_at)
                 VALUES (${placeholders}, false, NOW()) RETURNING *`;
  const { rows } = await pool.query(query, values);
  return rows[0];
};

const createNotificationPreference = async (userId) => {
  await pool.query(
    `INSERT INTO notification_preferences (user_id, email_enabled, sms_enabled, push_enabled, whatsapp_enabled, marketing_enabled, order_updates_enabled, inventory_enabled) VALUES ($1, true, false, false, false, false, true, true) ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
};

const getUserPreferences = async (userId) => {
  const { rows } = await pool.query("SELECT * FROM notification_preferences WHERE user_id = $1", [userId]);
  return rows[0] || null;
};

const ensureNotificationPreferences = async (userId) => {
  let preferences = await getUserPreferences(userId);
  if (!preferences) {
    await createNotificationPreference(userId);
    preferences = await getUserPreferences(userId);
  }
  return preferences;
};

// Notifications are delivered on the request that raises them. Callers treat
// this as fire and forget, so a failing channel must not fail their work.
const enqueueNotification = async (payload) => deliverNotification(payload);

const deliverNotification = async (payload) => {
  const {
    userId,
    title,
    message,
    notificationType,
    referenceId,
    referenceType,
    channels = [NOTIFICATION_CHANNELS.IN_APP],
    smsPayload,
    emailPayload,
    pushPayload,
    whatsappPayload,
    priority = "normal",
  } = payload;

  const preferences = await ensureNotificationPreferences(userId);
  if (!preferences) {
    throw new Error("Notification preferences were not found for user");
  }

  const deliveredChannels = [];
  const notificationRecord = await createNotificationRecord({
    userId,
    title,
    message,
    notificationType,
    channel: channels.join(","),
    referenceId,
    referenceType,
    priority,
  });

  if (channels.includes(NOTIFICATION_CHANNELS.EMAIL) && preferences.email_enabled) {
    if (emailPayload?.to) {
      const emailResult = await sendEmail({
        to: emailPayload.to,
        subject: emailPayload.subject || title,
        templateName: emailPayload.templateName || notificationType,
        variables: emailPayload.variables || {},
      });
      await logNotification(notificationRecord.id, NOTIFICATION_CHANNELS.EMAIL, "sent", emailResult);
      deliveredChannels.push(NOTIFICATION_CHANNELS.EMAIL);
    }
  }

  if (channels.includes(NOTIFICATION_CHANNELS.SMS) && preferences.sms_enabled) {
    if (smsPayload?.to) {
      const smsResult = await sendSms({ to: smsPayload.to, body: smsPayload.body });
      await logNotification(notificationRecord.id, NOTIFICATION_CHANNELS.SMS, "sent", smsResult);
      deliveredChannels.push(NOTIFICATION_CHANNELS.SMS);
    }
  }

  if (channels.includes(NOTIFICATION_CHANNELS.PUSH) && preferences.push_enabled) {
    const tokens = await getDeviceTokens(userId);
    if (tokens.length > 0) {
      const pushResult = await sendPushNotification({
        tokens,
        topic: pushPayload?.topic,
        title: pushPayload?.title || title,
        body: pushPayload?.body || message,
        data: pushPayload?.data || {},
      });
      await logNotification(notificationRecord.id, NOTIFICATION_CHANNELS.PUSH, "sent", pushResult);
      deliveredChannels.push(NOTIFICATION_CHANNELS.PUSH);
    }
  }

  if (channels.includes(NOTIFICATION_CHANNELS.WHATSAPP) && preferences.whatsapp_enabled) {
    if (whatsappPayload?.to) {
      const whatsappResult = await sendWhatsApp({
        to: whatsappPayload.to,
        body: whatsappPayload.body,
        templateName: whatsappPayload.templateName,
        variables: whatsappPayload.variables,
      });
      await logNotification(notificationRecord.id, NOTIFICATION_CHANNELS.WHATSAPP, "sent", whatsappResult);
      deliveredChannels.push(NOTIFICATION_CHANNELS.WHATSAPP);
    }
  }

  await emitUserNotification(userId, notificationRecord);
  await emitUnreadCount(userId, async (targetUserId) => {
    const { rows } = await pool.query("SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1 AND is_read = false", [targetUserId]);
    return Number(rows[0].count || 0);
  });

  return { notificationRecord, deliveredChannels };
};

const logNotification = async (notificationId, channel, status, providerResponse) => {
  await pool.query(
    `INSERT INTO notification_logs (notification_id, channel, status, provider_response, sent_at) VALUES ($1,$2,$3,$4,NOW())`,
    [notificationId, channel, status, JSON.stringify(providerResponse || {})],
  );
};

const getDeviceTokens = async (userId) => {
  const { rows } = await pool.query("SELECT token FROM device_tokens WHERE user_id = $1 AND token IS NOT NULL", [userId]);
  return rows.map((item) => item.token);
};

module.exports = {
  enqueueNotification,
  deliverNotification,
  getUserPreferences,
  ensureNotificationPreferences,
  getDeviceTokens,
  createNotificationRecord,
  createNotificationPreference,
  resetNotificationSchema,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
};

const admin = require("firebase-admin");

const initializeFirebase = () => {
  if (admin.apps.length) return;
  const serviceAccountJson = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    console.warn("FCM service account JSON is not configured. Push notifications are disabled.");
    return;
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(serviceAccountJson);
  } catch (err) {
    throw new Error("Invalid FCM_SERVICE_ACCOUNT_JSON payload");
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
};

const sendPushNotification = async ({ tokens = [], topic, title, body, data = {} }) => {
  initializeFirebase();
  if (!admin.apps.length) {
    throw new Error("Firebase admin is not initialized");
  }

  const message = {
    notification: {
      title,
      body,
    },
    data,
  };

  if (topic) {
    message.topic = topic;
  } else if (tokens.length > 0) {
    message.tokens = tokens;
  } else {
    throw new Error("Push notification requires tokens or topic");
  }

  const response = await admin.messaging().sendMulticast(message);
  return { provider: "fcm", response };
};

module.exports = {
  sendPushNotification,
};

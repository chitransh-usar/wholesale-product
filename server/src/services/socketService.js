let ioInstance = null;

const setSocketServer = (io) => {
  ioInstance = io;
};

const emitUserNotification = (userId, notification) => {
  if (!ioInstance || !userId) return;
  ioInstance.to(`user:${userId}`).emit("notification", notification);
};

const emitUnreadCount = async (userId, fetchUnreadCount) => {
  if (!ioInstance || !userId || typeof fetchUnreadCount !== "function") return;
  const count = await fetchUnreadCount(userId);
  ioInstance.to(`user:${userId}`).emit("notification_count", { unreadCount: count });
};

module.exports = {
  setSocketServer,
  emitUserNotification,
  emitUnreadCount,
};

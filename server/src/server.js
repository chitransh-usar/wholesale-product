const app = require("./app");
const { createServer } = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const pool = require("./config/db");
const { setSocketServer } = require("./services/socketService");

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    // Restrict to CLIENT_URL when configured; otherwise reflect the request
    // origin so the browser socket handshake isn't blocked in local dev.
    origin: process.env.CLIENT_URL || true,
    credentials: true,
  },
});

setSocketServer(io);
// Controllers reach the socket server through the app to push live updates.
app.set("io", io);

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error("Unauthorized"));
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = payload.id;
    next();
  } catch (err) {
    // Logged with the reason, for the same reason authMiddleware does it: a
    // signature failure here and an expiry here are different faults and
    // both used to arrive as the bare word "Unauthorized" in a browser
    // console, which says nothing about where to look.
    if (err.name !== "TokenExpiredError") {
      console.error(
        `Socket token rejected (${err.name}): ${err.message}. On a freshly issued token this means JWT_SECRET does not match the one it was signed with.`,
      );
    }
    next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  socket.join(`user:${socket.userId}`);
  socket.on("send_message", async ({ receiverId, text, tempId }) => {
    if (!text?.trim()) {
      return;
    }
    const targetId = receiverId;
    // ids are UUIDs, so validate as a non-empty value rather than a number
    if (!targetId || String(targetId) === String(socket.userId)) {
      console.error(
        `Rejected message from ${socket.userId} to ${targetId}: invalid recipient`,
      );
      socket.emit("message_error", { tempId, message: "Invalid recipient" });
      return;
    }
    try {
      const { rows } = await pool.query(
        `INSERT INTO messages(sender_id,receiver_id,message_text)
        VALUES ($1,$2,$3) RETURNING *`,
        [socket.userId, targetId, text.trim()],
      );
      const msg = rows[0];
      io.to(`user:${targetId}`).emit("new_message", msg);
      // Echo tempId back so the sender can reconcile its optimistic message
      socket.emit("message_sent", { ...msg, tempId });
    } catch (err) {
      console.error("Error saving message:", err);
      socket.emit("message_error", {
        tempId,
        message: "Failed to send message",
      });
    }
  });
});

const PORT = Number(process.env.PORT) || 5000;

/**
 * Said once at boot, so a misconfigured deployment is visible in the logs
 * before anybody tries to sign in and gets a 401 they cannot explain.
 *
 * JWT_EXPIRES_IN is checked because a bare number means SECONDS to
 * jsonwebtoken. Somebody setting it to 1 meaning "one day" issues tokens that
 * die a second after they are handed out, and every request after a
 * successful sign in comes back 401. That looks exactly like a broken login
 * and is nothing of the kind.
 */
const checkAuthConfig = () => {
  if (!process.env.JWT_SECRET) {
    console.error(
      "JWT_SECRET is not set. Signing in will fail and no token can be verified.",
    );
    return;
  }
  const expiry = process.env.JWT_EXPIRES_IN;
  if (expiry && /^\d+$/.test(String(expiry).trim())) {
    const seconds = Number(expiry);
    console.warn(
      `JWT_EXPIRES_IN is "${expiry}", which jsonwebtoken reads as ${seconds} SECONDS, not days. Write "30d" if you meant days.`,
    );
  }
};

httpServer.listen(PORT, () => {
  checkAuthConfig();
  console.log(`Server running on port ${PORT} with Enterprise Invoice System initialized`);
});

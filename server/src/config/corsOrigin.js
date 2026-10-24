const configuredOrigins = (process.env.CLIENT_URL || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean)
  .map((origin) => {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(
        "CLIENT_URL must contain comma-separated frontend origins such as https://shop.example.com.",
      );
    }

    const normalizedOrigin = origin.replace(/\/$/, "");
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.origin !== normalizedOrigin
    ) {
      throw new Error(
        "Each CLIENT_URL value must be an origin only, without a path.",
      );
    }

    return parsed.origin;
  });

const allowedOrigins = new Set(configuredOrigins);
const isProduction = process.env.NODE_ENV === "production";
if (isProduction && allowedOrigins.size === 0) {
  throw new Error("CLIENT_URL must be configured in production.");
}
if (!isProduction) {
  allowedOrigins.add("http://localhost:5173");
}

module.exports = (origin, callback) => {
  callback(null, !origin || allowedOrigins.has(origin));
};

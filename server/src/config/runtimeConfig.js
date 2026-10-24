function validateRuntimeConfig(env, logger = console) {
  if (!String(env.JWT_SECRET || "").trim()) {
    throw new Error("JWT_SECRET must be configured before the server starts.");
  }

  const configuredPort = env.PORT;
  const port =
    configuredPort === undefined || String(configuredPort).trim() === ""
      ? 5000
      : Number(configuredPort);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  const expiry = env.JWT_EXPIRES_IN;
  if (expiry && /^\d+$/.test(String(expiry).trim())) {
    const seconds = Number(expiry);
    logger.warn(
      `JWT_EXPIRES_IN is "${expiry}", which jsonwebtoken reads as ${seconds} SECONDS, not days. Write "30d" if you meant days.`,
    );
  }

  return port;
}

module.exports = validateRuntimeConfig;

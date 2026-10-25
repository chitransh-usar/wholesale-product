const UNAVAILABLE_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_TLS_HANDSHAKE_TIMEOUT",
  "53300",
  "57014",
  "57P01",
  "57P02",
  "57P03",
]);

function databaseErrorStatus(error) {
  const code = String(error?.code || "");
  return code.startsWith("08") || code.startsWith("28") ||
    UNAVAILABLE_ERROR_CODES.has(code)
    ? 503
    : 500;
}

function logDatabaseError(operation, error, logger = console) {
  const relation =
    error?.schema && error?.table
      ? `${error.schema}.${error.table}`
      : error?.table;
  logger.error(
    `${operation} failed:`,
    error?.code || error?.name || "unknown database error",
    ...(relation ? [`relation=${relation}`] : []),
  );
}

module.exports = { databaseErrorStatus, logDatabaseError };

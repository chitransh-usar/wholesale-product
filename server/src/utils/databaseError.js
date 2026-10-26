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

function sanitizeDiagnostic(value) {
  if (value === undefined || value === null) return undefined;
  return String(value)
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"'<>]+/gi, "postgresql://[REDACTED]")
    .replace(
      /\b(password|passwd|pwd|jwt_secret|database_url)\s*([=:])\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1$2[REDACTED]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(
      /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      "[REDACTED_JWT]",
    )
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      "[REDACTED_EMAIL]",
    )
    .replace(/(?<!\d)(?:\+?91[-\s]?)?[6-9]\d{9}(?!\d)/g, "[REDACTED_PHONE]");
}

function logDatabaseError(operation, error, logger = console) {
  const fields = [
    "code",
    "message",
    "severity",
    "routine",
    "file",
    "line",
    "where",
    "detail",
    "schema",
    "table",
    "constraint",
    "position",
  ];
  const diagnostics = {};
  for (const field of fields) {
    const value = sanitizeDiagnostic(error?.[field]);
    if (value !== undefined) diagnostics[field] = value;
  }
  if (diagnostics.schema && diagnostics.table) {
    diagnostics.relation = `${diagnostics.schema}.${diagnostics.table}`;
  }
  if (!diagnostics.code && error?.name) diagnostics.name = error.name;

  logger.error(`${operation} failed: ${JSON.stringify(diagnostics)}`);
}

module.exports = { databaseErrorStatus, logDatabaseError };

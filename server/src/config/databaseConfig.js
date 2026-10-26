const SSL_MODES = new Set(["disable", "require", "verify-full"]);
const SSL_URL_PARAMETERS = ["ssl", "sslcert", "sslkey", "sslrootcert"];

function buildDatabaseConfig(databaseUrl, caCertificate) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to start the server.");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }

  if (!["postgres:", "postgresql:"].includes(parsedUrl.protocol)) {
    throw new Error("DATABASE_URL must use the postgres or postgresql protocol.");
  }

  const host = parsedUrl.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || parsedUrl.pathname.length < 2) {
    throw new Error("DATABASE_URL must include a database host and name.");
  }

  const isLocalDb = ["localhost", "127.0.0.1", "::1"].includes(host);
  // Render's internal Postgres URL uses the bare dpg resource hostname.
  const isRenderInternal =
    host.endsWith(".render.internal") || /^dpg-[a-z0-9]+-[a-z]$/.test(host);
  const sslMode = parsedUrl.searchParams.get("sslmode")?.toLowerCase();

  if (sslMode && !SSL_MODES.has(sslMode)) {
    throw new Error(
      "DATABASE_URL sslmode must be disable, require, or verify-full.",
    );
  }

  if (sslMode === "disable" && !isLocalDb) {
    throw new Error("SSL cannot be disabled for a remote PostgreSQL connection.");
  }

  if (isRenderInternal && !caCertificate) {
    throw new Error(
      "Render internal PostgreSQL requires DATABASE_SSL_CA for verified TLS. Use a trusted CA certificate or the provider's verified external URL.",
    );
  }

  for (const parameter of SSL_URL_PARAMETERS) {
    if (parsedUrl.searchParams.has(parameter)) {
      throw new Error(
        `DATABASE_URL must not contain the ${parameter} parameter. Configure TLS through server settings.`,
      );
    }
  }

  parsedUrl.searchParams.delete("sslmode");
  parsedUrl.searchParams.delete("sslnegotiation");

  let ssl = false;
  if (!isLocalDb || sslMode === "require" || sslMode === "verify-full") {
    ssl = {
      rejectUnauthorized: true,
    };
    if (caCertificate) ssl.ca = caCertificate;
  }

  return {
    connectionString: parsedUrl.toString(),
    ssl,
    options: "-c search_path=public",
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    query_timeout: 9000,
    statement_timeout: 8000,
  };
}

module.exports = buildDatabaseConfig;

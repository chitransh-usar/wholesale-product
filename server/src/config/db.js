const { Pool } = require("pg");
require("dotenv").config();

const databaseUrl = process.env.DATABASE_URL;
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
const isLocalDb = ["localhost", "127.0.0.1", "::1"].includes(host);
const sslMode = parsedUrl.searchParams.get("sslmode");
const sslCertificateParams = ["ssl", "sslcert", "sslkey", "sslrootcert"];

if (!isLocalDb && sslMode && sslMode !== "verify-full") {
  throw new Error(
    "Remote DATABASE_URL must use sslmode=verify-full, or omit sslmode so the server can enforce certificate verification.",
  );
}

for (const parameter of sslCertificateParams) {
  if (parsedUrl.searchParams.has(parameter)) {
    throw new Error(
      `DATABASE_URL must not contain the ${parameter} parameter. Configure TLS through the server connection settings.`,
    );
  }
  parsedUrl.searchParams.delete(parameter);
}
parsedUrl.searchParams.delete("sslmode");
parsedUrl.searchParams.delete("sslnegotiation");

const pool = new Pool({
  connectionString: parsedUrl.toString(),
  ssl: isLocalDb || host.endsWith(".render.internal")
  ? false
  : { rejectUnauthorized: true },
});

module.exports = pool;

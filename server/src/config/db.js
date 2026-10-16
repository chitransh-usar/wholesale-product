const { Pool } = require("pg");
require("dotenv").config();

// The live schema is defined by the files in server/migrations, which are the
// only authority on it.
//
// SSL is disabled for local connections (localhost / 127.0.0.1) because the
// default PostgreSQL installation does not have SSL configured. For remote
// databases (e.g. Render, Railway, Supabase) ssl is enabled but certificate
// verification is relaxed because managed providers use self-signed certs that
// would fail strict verification.
const isLocalDb =
  !process.env.DATABASE_URL ||
  process.env.DATABASE_URL.includes("localhost") ||
  process.env.DATABASE_URL.includes("127.0.0.1");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocalDb ? false : { rejectUnauthorized: false },
});

module.exports = pool;

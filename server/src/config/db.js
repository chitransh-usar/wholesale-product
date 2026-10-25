const { Pool } = require("pg");
require("dotenv").config();
const buildDatabaseConfig = require("./databaseConfig");

const pool = new Pool(
  buildDatabaseConfig(
    process.env.DATABASE_URL,
    process.env.DATABASE_SSL_CA || undefined,
  ),
);

pool.on("error", (error) => {
  console.error(
    "Unexpected PostgreSQL pool error:",
    error.code || error.name || "unknown error",
  );
});

module.exports = pool;

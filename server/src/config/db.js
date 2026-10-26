const { Pool } = require("pg");
require("dotenv").config();
const buildDatabaseConfig = require("./databaseConfig");
const { logDatabaseError } = require("../utils/databaseError");

const pool = new Pool(
  buildDatabaseConfig(
    process.env.DATABASE_URL,
    process.env.DATABASE_SSL_CA || undefined,
  ),
);

pool.on("error", (error) => {
  logDatabaseError("Unexpected PostgreSQL pool error", error);
});

module.exports = pool;

require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const buildDatabaseConfig = require("../src/config/databaseConfig");
const { logDatabaseError } = require("../src/utils/databaseError");
const {
  MIGRATION_FILES,
  validateHistoryRows,
  validateManifest,
} = require("../run_migrations");

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

function requiredTables() {
  validateManifest();
  const tables = new Set();

  for (const filename of MIGRATION_FILES) {
    const sql = fs
      .readFileSync(path.join(MIGRATIONS_DIR, filename), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*--.*$/gm, "");

    for (const match of sql.matchAll(
      /\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:"?([A-Za-z_][\w$]*)"?\s*\.\s*)?)"?([A-Za-z_][\w$]*)"?/gi,
    )) {
      const schema = match[1]?.toLowerCase();
      if (schema && schema !== "public") {
        throw new Error(
          `${filename} creates a table outside public; update the schema verifier before applying it.`,
        );
      }
      tables.add(match[2].toLowerCase());
    }
  }

  if (!tables.has("users") || !tables.has("wholesaler_profiles")) {
    throw new Error(
      "The migration manifest does not declare the required users and wholesaler_profiles tables.",
    );
  }
  return [...tables].sort();
}

function parseArguments(args) {
  if (
    args.length !== 2 ||
    args[0] !== "--database" ||
    !args[1]
  ) {
    throw new Error(
      "Usage: npm run db:verify -- --database <expected-database-name>",
    );
  }
  return { expectedDatabase: args[1] };
}

async function verifySchema({
  expectedDatabase,
  databaseUrl = process.env.DATABASE_URL,
  caCertificate = process.env.DATABASE_SSL_CA || undefined,
  poolFactory = (config) => new Pool({ ...config, max: 1 }),
  logger = console,
}) {
  if (!expectedDatabase) {
    throw new Error("An expected database name is required.");
  }
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for read-only schema verification.");
  }

  const tables = requiredTables();
  const pool = poolFactory(buildDatabaseConfig(databaseUrl, caCertificate));

  try {
    const targetResult = await pool.query(
      `SELECT current_database() AS database_name,
              current_schema() AS schema_name,
              current_setting('search_path') AS search_path`,
    );
    const target = targetResult.rows[0];
    if (
      target?.database_name !== expectedDatabase ||
      target?.schema_name !== "public" ||
      !String(target?.search_path || "").split(",").some((schema) =>
        schema.trim().replace(/^"|"$/g, "") === "public",
      )
    ) {
      throw new Error(
        "Connected database/schema did not match the explicitly confirmed target.",
      );
    }

    const missingResult = await pool.query(
      `SELECT expected.table_name
         FROM unnest($1::text[]) AS expected(table_name)
        WHERE to_regclass(format('public.%I', expected.table_name)) IS NULL
        ORDER BY expected.table_name`,
      [tables],
    );
    const missingTables = missingResult.rows.map((row) => row.table_name);

    const historyResult = await pool.query(
      "SELECT to_regclass('public.schema_migrations') AS relation",
    );
    const hasHistory = Boolean(historyResult.rows[0]?.relation);
    let applied = new Map();
    if (hasHistory) {
      const appliedResult = await pool.query(
        "SELECT filename, checksum FROM public.schema_migrations ORDER BY filename",
      );
      applied = validateHistoryRows(appliedResult.rows);
    }

    const pendingMigrations = MIGRATION_FILES.filter(
      (filename) => !applied.has(filename),
    );
    const report = {
      databaseName: target.database_name,
      schemaName: target.schema_name,
      expectedTableCount: tables.length,
      missingTables,
      migrationHistoryPresent: hasHistory,
      appliedMigrationCount: applied.size,
      pendingMigrations,
    };

    logger.log(`Connected database: ${report.databaseName}`);
    logger.log(`Schema checked: ${report.schemaName}`);
    logger.log(
      `Application tables found: ${tables.length - missingTables.length}/${tables.length}`,
    );
    if (missingTables.length) {
      logger.error(`Missing tables: ${missingTables.join(", ")}`);
    } else {
      logger.log("Missing tables: none");
    }
    logger.log(
      `Migration history: ${hasHistory ? `${applied.size}/${MIGRATION_FILES.length} recorded` : "not initialized"}`,
    );
    if (pendingMigrations.length) {
      logger.error(`Pending migrations: ${pendingMigrations.join(", ")}`);
    } else {
      logger.log("Pending migrations: none");
    }

    return report;
  } finally {
    await pool.end();
  }
}

async function main(args = process.argv.slice(2), logger = console) {
  const { expectedDatabase } = parseArguments(args);
  const report = await verifySchema({ expectedDatabase, logger });
  if (report.missingTables.length || report.pendingMigrations.length) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    if (error?.code) {
      logDatabaseError("Schema verification", error);
      console.error(`Schema verification failed: ${error.code}`);
    } else {
      console.error(`Schema verification failed: ${error.message}`);
    }
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  parseArguments,
  requiredTables,
  verifySchema,
};

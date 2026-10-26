const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");
const buildDatabaseConfig = require("../src/config/databaseConfig");
const { logDatabaseError } = require("../src/utils/databaseError");
const {
  BASELINE_FILE,
  EXCLUDED_FILES,
  HISTORY_TABLE,
  LOCK_ID,
  MIGRATION_FILES,
  assertBaselineSchemaClean,
  checksum,
  cleanupPool,
  ensureHistoryTable,
  removeOuterTransaction,
  validateHistoryRows,
  validateManifest,
} = require("../run_migrations");

function parseArguments(args) {
  if (args.length === 0 || (args.length === 1 && args[0] === "--plan")) {
    return { mode: "plan" };
  }

  if (
    args.length !== 7 ||
    args[0] !== "--apply" ||
    args[1] !== "--database" ||
    !args[2] ||
    args[3] !== "--endpoint" ||
    !args[4] ||
    args[5] !== "--confirm-backup" ||
    args[6] !== "yes"
  ) {
    throw new Error(
      "Usage: node scripts/migrate_neon.js [--plan | --apply --database <name> --endpoint <host> --confirm-backup yes]",
    );
  }

  return {
    mode: "apply",
    expectedDatabase: args[2],
    expectedHost: args[4],
    backupConfirmed: true,
  };
}

function parseDirectNeonUrl(databaseUrl, expectedDatabase, expectedHost) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("NEON_MIGRATION_DATABASE_URL must be a valid PostgreSQL URL.");
  }

  const host = parsed.hostname.toLowerCase();
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("NEON_MIGRATION_DATABASE_URL must use PostgreSQL.");
  }
  if (!host.endsWith(".neon.tech")) {
    throw new Error("Neon migrations require a Neon PostgreSQL endpoint.");
  }
  if (!expectedHost || host !== expectedHost.toLowerCase()) {
    throw new Error(
      "The Neon URL hostname must match --endpoint exactly.",
    );
  }
  if (host.includes("-pooler")) {
    throw new Error(
      "Neon migrations require the direct endpoint, not a pooled endpoint.",
    );
  }
  if (!database || database !== expectedDatabase) {
    throw new Error(
      "The database name in the Neon URL must match --database exactly.",
    );
  }
  if (parsed.searchParams.get("sslmode")?.toLowerCase() === "disable") {
    throw new Error("TLS cannot be disabled for a Neon migration connection.");
  }

  return { database };
}

function printPlan(logger = console) {
  validateManifest();
  logger.log("Neon migration plan only. No database connection was opened.");
  MIGRATION_FILES.forEach((file, index) => {
    logger.log(`${String(index + 1).padStart(2, "0")}. ${file}`);
  });
  logger.log("\nExcluded SQL files:");
  for (const [file, reason] of Object.entries(EXCLUDED_FILES)) {
    logger.log(`- ${file}: ${reason}`);
  }
}

async function applyNeonMigrations({
  expectedDatabase,
  expectedHost,
  backupConfirmed,
  databaseUrl = process.env.NEON_MIGRATION_DATABASE_URL,
  caCertificate = process.env.DATABASE_SSL_CA || undefined,
  poolFactory = (config) => new Pool(config),
  logger = console,
}) {
  if (!expectedDatabase) {
    throw new Error("An expected Neon database name is required.");
  }
  if (!expectedHost) {
    throw new Error("The exact Neon endpoint hostname must be confirmed.");
  }
  if (backupConfirmed !== true) {
    throw new Error("Confirm a verified database backup before applying migrations.");
  }
  if (!databaseUrl) {
    throw new Error("NEON_MIGRATION_DATABASE_URL is required.");
  }
  if (!parseDirectNeonUrl(databaseUrl, expectedDatabase, expectedHost)) {
    throw new Error("The Neon migration target could not be verified.");
  }

  validateManifest();
  const pool = poolFactory(buildDatabaseConfig(databaseUrl, caCertificate));
  let client;
  let lockAcquired = false;
  let lockAttempted = false;

  try {
    client = await pool.connect();

    const targetResult = await client.query(
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
        "Connected Neon database/schema did not match the explicitly confirmed target.",
      );
    }

    lockAttempted = true;
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);
    lockAcquired = true;

    const hasHistoryTable = await ensureHistoryTable(client);
    const appliedResult = await client.query(
      `SELECT filename, checksum FROM ${HISTORY_TABLE}`,
    );
    const applied = validateHistoryRows(appliedResult.rows);

    if (!applied.has(BASELINE_FILE)) {
      await assertBaselineSchemaClean(client, hasHistoryTable);
    }

    for (const file of MIGRATION_FILES) {
      const contents = fs.readFileSync(
        path.join(__dirname, "..", "migrations", file),
        "utf8",
      );
      const digest = checksum(contents);

      if (applied.has(file)) {
        logger.log(`  recorded  ${file}`);
        continue;
      }
      if (file !== BASELINE_FILE && !applied.has(BASELINE_FILE)) {
        throw new Error(
          `Refusing to apply ${file} before ${BASELINE_FILE} is recorded.`,
        );
      }

      await client.query("BEGIN");
      try {
        await client.query(removeOuterTransaction(file, contents));
        await client.query(
          `INSERT INTO ${HISTORY_TABLE} (filename, checksum)
           VALUES ($1, $2)`,
          [file, digest],
        );
        await client.query("COMMIT");
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            "Migration failed and rollback also failed.",
          );
        }
        throw error;
      }

      applied.set(file, digest);
      logger.log(`  applied   ${file}`);
    }

    logger.log(`\n${MIGRATION_FILES.length} planned migrations are recorded.`);
  } catch (error) {
    if (client && error?.code) {
      logDatabaseError("Neon migration", error, logger);
    }
    throw error;
  } finally {
    await cleanupPool(pool, client, lockAcquired, lockAttempted);
  }
}

async function main(
  args = process.argv.slice(2),
  apply = applyNeonMigrations,
  logger = console,
) {
  const options = parseArguments(args);
  if (options.mode === "plan") {
    printPlan(logger);
    return;
  }
  await apply({
    expectedDatabase: options.expectedDatabase,
    expectedHost: options.expectedHost,
    backupConfirmed: options.backupConfirmed,
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(
      "Neon migration failed:",
      error.code || error.name || "unknown error",
    );
    if (error.message && !error.code) console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  applyNeonMigrations,
  main,
  parseArguments,
  parseDirectNeonUrl,
  printPlan,
};

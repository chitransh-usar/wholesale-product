const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  MIGRATION_FILES,
  checksum,
} = require("../run_migrations");
const {
  parseArguments,
  requiredTables,
  verifySchema,
} = require("../scripts/verify_schema");

test("schema verifier derives all application tables from the migration manifest", () => {
  const tables = requiredTables();
  assert.equal(tables.length, 77);
  assert.ok(tables.includes("users"));
  assert.ok(tables.includes("wholesaler_profiles"));
  assert.ok(tables.includes("products"));
  assert.ok(tables.includes("supplier_inventory"));
});

test("schema verifier requires an expected target database", () => {
  assert.deepEqual(parseArguments(["--database", "wholesale_marketplace"]), {
    expectedDatabase: "wholesale_marketplace",
  });
  assert.throws(() => parseArguments([]), /Usage/);
});

test("schema verification is read-only and reports absent tables and pending migrations", async () => {
  const queries = [];
  let ended = false;
  const logs = [];
  const report = await verifySchema({
    expectedDatabase: "wholesale_marketplace",
    databaseUrl: "postgresql://app@ep-example-pooler.neon.tech/wholesale_marketplace",
    poolFactory(config) {
      assert.equal(Object.hasOwn(config, "options"), false);
      assert.deepEqual(config.ssl, { rejectUnauthorized: true });
      return {
        async query(sql) {
          queries.push(sql);
          if (sql.startsWith("SELECT current_database()")) {
            return {
              rows: [{
                database_name: "wholesale_marketplace",
                schema_name: "public",
                search_path: "public",
              }],
            };
          }
          if (sql.includes("FROM unnest")) {
            return { rows: [{ table_name: "users" }, { table_name: "wholesaler_profiles" }] };
          }
          if (sql.includes("to_regclass('public.schema_migrations')")) {
            return { rows: [{ relation: null }] };
          }
          assert.fail(`Unexpected query: ${sql}`);
        },
        async end() {
          ended = true;
        },
      };
    },
    logger: {
      log: (...args) => logs.push(args.join(" ")),
      error: (...args) => logs.push(args.join(" ")),
    },
  });

  assert.equal(ended, true);
  assert.equal(report.expectedTableCount, 77);
  assert.deepEqual(report.missingTables, ["users", "wholesaler_profiles"]);
  assert.equal(report.migrationHistoryPresent, false);
  assert.equal(report.appliedMigrationCount, 0);
  assert.deepEqual(report.pendingMigrations, MIGRATION_FILES);
  assert.equal(queries.some((sql) => /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER)\b/i.test(sql)), false);
  assert.ok(logs.some((line) => line.includes("Missing tables: users, wholesaler_profiles")));
});

test("schema verification refuses a database other than the confirmed target", async () => {
  let ended = false;
  await assert.rejects(
    verifySchema({
      expectedDatabase: "wholesale_marketplace",
      databaseUrl: "postgresql://app@ep-example-pooler.neon.tech/another_database",
      poolFactory() {
        return {
          async query() {
            return {
              rows: [{
                database_name: "another_database",
                schema_name: "public",
                search_path: "public",
              }],
            };
          },
          async end() {
            ended = true;
          },
        };
      },
    }),
    /did not match the explicitly confirmed target/,
  );
  assert.equal(ended, true);
});

test("schema verification succeeds when all required tables and migrations are present", async () => {
  const migrationDir = path.join(__dirname, "..", "migrations");
  const appliedRows = MIGRATION_FILES.map((filename) => ({
    filename,
    checksum: checksum(fs.readFileSync(path.join(migrationDir, filename), "utf8")),
  }));
  const report = await verifySchema({
    expectedDatabase: "wholesale_marketplace",
    databaseUrl: "postgresql://app@ep-example-pooler.neon.tech/wholesale_marketplace",
    poolFactory() {
      return {
        async query(sql) {
          if (sql.startsWith("SELECT current_database()")) {
            return {
              rows: [{
                database_name: "wholesale_marketplace",
                schema_name: "public",
                search_path: "public",
              }],
            };
          }
          if (sql.includes("FROM unnest")) return { rows: [] };
          if (sql.includes("to_regclass('public.schema_migrations')")) {
            return { rows: [{ relation: "schema_migrations" }] };
          }
          if (sql.includes("FROM public.schema_migrations")) {
            return { rows: appliedRows };
          }
          assert.fail(`Unexpected query: ${sql}`);
        },
        async end() {},
      };
    },
    logger: { log() {}, error() {} },
  });

  assert.deepEqual(report.missingTables, []);
  assert.equal(report.migrationHistoryPresent, true);
  assert.equal(report.appliedMigrationCount, MIGRATION_FILES.length);
  assert.deepEqual(report.pendingMigrations, []);
});

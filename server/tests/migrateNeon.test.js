const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  HISTORY_TABLE,
  MIGRATION_FILES,
  checksum,
} = require("../run_migrations");
const {
  applyNeonMigrations,
  main,
  parseArguments,
  parseDirectNeonUrl,
} = require("../scripts/migrate_neon");

const directUrl =
  "postgresql://migration-user:private-password@ep-example.us-east-2.aws.neon.tech/marketplace";

test("Neon migration CLI requires apply, exact target, and backup confirmation", () => {
  assert.deepEqual(parseArguments([]), { mode: "plan" });
  assert.deepEqual(parseArguments(["--plan"]), { mode: "plan" });
  assert.deepEqual(
    parseArguments([
      "--apply",
      "--database",
      "marketplace",
      "--endpoint",
      "ep-example.us-east-2.aws.neon.tech",
      "--confirm-backup",
      "yes",
    ]),
    {
      mode: "apply",
      expectedDatabase: "marketplace",
      expectedHost: "ep-example.us-east-2.aws.neon.tech",
      backupConfirmed: true,
    },
  );
  assert.throws(
    () => parseArguments(["--apply"]),
    /Usage/,
  );
  assert.throws(
    () => parseArguments([
      "--apply",
      "--database",
      "marketplace",
      "--endpoint",
      "ep-example.us-east-2.aws.neon.tech",
      "--confirm-backup",
      "no",
    ]),
    /Usage/,
  );
});

test("Neon migrations accept only the exact direct endpoint and database name", () => {
  assert.deepEqual(
    parseDirectNeonUrl(
      directUrl,
      "marketplace",
      "ep-example.us-east-2.aws.neon.tech",
    ),
    { database: "marketplace" },
  );
  assert.throws(
    () => parseDirectNeonUrl(directUrl, "other", "ep-example.us-east-2.aws.neon.tech"),
    /database name.*match/i,
  );
  assert.throws(
    () => parseDirectNeonUrl(directUrl, "marketplace", "another.neon.tech"),
    /hostname.*match/i,
  );
  assert.throws(
    () => parseDirectNeonUrl(
      "postgresql://u:p@ep-example-pooler.us-east-2.aws.neon.tech/marketplace",
      "marketplace",
      "ep-example-pooler.us-east-2.aws.neon.tech",
    ),
    /direct endpoint/,
  );
  assert.throws(
    () => parseDirectNeonUrl(
      "postgresql://u:p@db.example.com/marketplace",
      "marketplace",
      "db.example.com",
    ),
    /Neon PostgreSQL endpoint/,
  );
});

test("Neon migration refuses to connect without explicit backup confirmation", async () => {
  let poolCreated = false;
  await assert.rejects(
    applyNeonMigrations({
      expectedDatabase: "marketplace",
      expectedHost: "ep-example.us-east-2.aws.neon.tech",
      backupConfirmed: false,
      databaseUrl: directUrl,
      poolFactory() {
        poolCreated = true;
        throw new Error("pool must not be created");
      },
    }),
    /Confirm a verified database backup/,
  );
  assert.equal(poolCreated, false);
});

test("Neon migration uses the reviewed manifest and records each SQL file transactionally", async () => {
  const queries = [];
  let unlocked = false;
  let ended = false;
  let released = false;

  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.startsWith("SELECT current_database()")) {
        return {
          rows: [{
            database_name: "marketplace",
            schema_name: "public",
            search_path: "public",
          }],
        };
      }
      if (sql.includes("FROM pg_class c") && sql.includes("c.relname = $1")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("WITH history_table AS")) {
        return { rows: [] };
      }
      if (sql.startsWith("SELECT filename, checksum FROM public.schema_migrations")) {
        return { rows: [] };
      }
      if (sql === "SELECT pg_advisory_unlock($1)") {
        unlocked = true;
        return { rows: [{ pg_advisory_unlock: true }] };
      }
      return { rows: [] };
    },
    release() {
      released = true;
    },
  };

  const logs = [];
  await applyNeonMigrations({
    expectedDatabase: "marketplace",
    expectedHost: "ep-example.us-east-2.aws.neon.tech",
    backupConfirmed: true,
    databaseUrl: directUrl,
    poolFactory(config) {
      assert.equal(new URL(config.connectionString).hostname, "ep-example.us-east-2.aws.neon.tech");
      assert.deepEqual(config.ssl, { rejectUnauthorized: true });
      return {
        async connect() {
          return client;
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

  assert.equal(
    queries.filter(({ sql }) => sql.startsWith("INSERT INTO public.schema_migrations")).length,
    MIGRATION_FILES.length,
  );
  assert.equal(queries.filter(({ sql }) => sql === "BEGIN").length, MIGRATION_FILES.length);
  assert.equal(queries.filter(({ sql }) => sql === "COMMIT").length, MIGRATION_FILES.length);
  assert.equal(queries.filter(({ sql }) => sql === "ROLLBACK").length, 0);
  assert.equal(unlocked, true);
  assert.equal(released, true);
  assert.equal(ended, true);
  assert.ok(logs.some((line) => line.includes("planned migrations are recorded")));
});

test("Neon migration refuses if the connected database does not match the confirmed target", async () => {
  let ended = false;
  const client = {
    async query(sql) {
      if (sql.startsWith("SELECT current_database()")) {
        return {
          rows: [{
            database_name: "different_database",
            schema_name: "public",
            search_path: "public",
          }],
        };
      }
      assert.fail("Migration must stop before locking or issuing migration SQL.");
    },
    release() {},
  };

  await assert.rejects(
    applyNeonMigrations({
      expectedDatabase: "marketplace",
      expectedHost: "ep-example.us-east-2.aws.neon.tech",
      backupConfirmed: true,
      databaseUrl: directUrl,
      poolFactory() {
        return {
          async connect() {
            return client;
          },
          async end() {
            ended = true;
          },
        };
      },
      logger: { log() {}, error() {} },
    }),
    /did not match/,
  );
  assert.equal(ended, true);
});

test("Neon migration repeat run verifies the ledger and does not reapply files", async () => {
  const migrationDir = path.join(__dirname, "..", "migrations");
  const appliedRows = MIGRATION_FILES.map((filename) => ({
    filename,
    checksum: checksum(fs.readFileSync(path.join(migrationDir, filename), "utf8")),
  }));
  const queries = [];
  let ended = false;
  let unlocked = false;
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql.startsWith("SELECT current_database()")) {
        return {
          rows: [{
            database_name: "marketplace",
            schema_name: "public",
            search_path: "public",
          }],
        };
      }
      if (sql.includes("FROM pg_class c") && sql.includes("c.relname = $1")) {
        return { rowCount: 1, rows: [{ relkind: "r" }] };
      }
      if (sql.includes("information_schema.columns")) {
        return {
          rows: [
            {
              column_name: "filename",
              data_type: "text",
              is_nullable: "NO",
              column_default: null,
              is_identity: "NO",
              is_generated: "NEVER",
            },
            {
              column_name: "checksum",
              data_type: "text",
              is_nullable: "NO",
              column_default: null,
              is_identity: "NO",
              is_generated: "NEVER",
            },
            {
              column_name: "applied_at",
              data_type: "timestamp with time zone",
              is_nullable: "NO",
              column_default: "CURRENT_TIMESTAMP",
              is_identity: "NO",
              is_generated: "NEVER",
            },
          ],
        };
      }
      if (sql.includes("FROM pg_constraint con")) {
        return {
          rowCount: 1,
          rows: [{
            contype: "p",
            condeferrable: false,
            condeferred: false,
            convalidated: true,
            columns: ["filename"],
          }],
        };
      }
      if (sql.includes("AS extra_indexes")) {
        return {
          rows: [{
            extra_indexes: 0,
            user_triggers: 0,
            row_security_policies: 0,
            row_security_enabled: 0,
            user_rules: 0,
          }],
        };
      }
      if (sql === `SELECT filename, checksum FROM ${HISTORY_TABLE}`) {
        return { rows: appliedRows };
      }
      if (sql === "SELECT pg_advisory_unlock($1)") {
        unlocked = true;
        return { rows: [{ pg_advisory_unlock: true }] };
      }
      return { rows: [] };
    },
    release() {},
  };

  await applyNeonMigrations({
    expectedDatabase: "marketplace",
    expectedHost: "ep-example.us-east-2.aws.neon.tech",
    backupConfirmed: true,
    databaseUrl: directUrl,
    poolFactory: () => ({
      async connect() {
        return client;
      },
      async end() {
        ended = true;
      },
    }),
    logger: { log() {}, error() {} },
  });

  assert.equal(queries.filter((sql) => sql === "BEGIN").length, 0);
  assert.equal(queries.filter((sql) => sql === "COMMIT").length, 0);
  assert.equal(queries.filter((sql) => sql.startsWith("INSERT INTO")).length, 0);
  assert.equal(unlocked, true);
  assert.equal(ended, true);
});

test("Neon plan mode does not invoke the database migration path", async () => {
  let applied = false;
  const logs = [];
  await main(["--plan"], async () => {
    applied = true;
  }, { log: (...args) => logs.push(args.join(" ")) });
  assert.equal(applied, false);
  assert.match(logs.join("\n"), /Neon migration plan only/);
  assert.match(logs.join("\n"), /000_baseline\.sql/);
});

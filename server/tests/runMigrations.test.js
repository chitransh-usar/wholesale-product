const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const fs = require("node:fs");
const path = require("node:path");
const {
  EXCLUDED_FILES,
  MIGRATION_FILES,
  assertBaselineSchemaClean,
  assertHistoryTableShape,
  assertLocalTestConnection,
  checksum,
  cleanupPool,
  ensureHistoryTable,
  loadTestDatabaseUrl,
  main,
  parseTestDatabaseUrl,
  validateHistoryRows,
  validateManifest,
} = require("../run_migrations");

function migrationChecksum(filename) {
  return checksum(
    fs.readFileSync(path.join(__dirname, "..", "migrations", filename), "utf8"),
  );
}

test("manifest classifies every SQL file into 57 included and 7 excluded", () => {
  validateManifest();
  assert.equal(MIGRATION_FILES.length, 57);
  assert.equal(Object.keys(EXCLUDED_FILES).length, 7);
});

test("plan mode does not load the database module", async () => {
  const originalLoad = Module._load;
  const originalLog = console.log;
  const output = [];
  let databaseModuleRequested = false;

  Module._load = function (request, parent, isMain) {
    if (request === "./src/config/db" && parent?.filename.endsWith("run_migrations.js")) {
      databaseModuleRequested = true;
      throw new Error("Plan mode must not request the database module.");
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  console.log = (...args) => output.push(args.join(" "));

  try {
    await main([]);
    await main(["--plan"]);
    await assert.rejects(main(["--apply", "--plan"]), /Usage/);
  } finally {
    Module._load = originalLoad;
    console.log = originalLog;
  }

  assert.equal(databaseModuleRequested, false);
  assert.match(output.join("\n"), /Migration plan only/);
});

test("--apply dispatches to the apply path and invalid arguments fail", async () => {
  let applyCalled = false;
  await main(["--apply"], async () => {
    applyCalled = true;
  });
  assert.equal(applyCalled, true);

  await assert.rejects(main(["--apply", "--force"], async () => {
    assert.fail("Invalid arguments must not invoke apply.");
  }), /Usage/);
  await assert.rejects(main(["unexpected"]), /Usage/);
});

test("configured migration URL must identify the dedicated local target", () => {
  for (const value of [
    "postgresql://localhost:5432/wholesale_marketplace_test",
    "postgres://127.0.0.1/wholesale_marketplace_test",
    "postgresql://[::1]:5432/wholesale_marketplace_test",
  ]) {
    assert.doesNotThrow(() => parseTestDatabaseUrl(value));
  }

  for (const value of [
    "postgresql://db.example.com:5432/wholesale_marketplace_test",
    "postgresql://127.0.0.1:5433/wholesale_marketplace_test",
    "postgresql://127.0.0.1:5432/production",
    "https://127.0.0.1:5432/wholesale_marketplace_test",
    "not a database URL",
  ]) {
    assert.throws(() => parseTestDatabaseUrl(value), /Refusing to migrate|Invalid DATABASE_URL/);
  }
});

test("actual PostgreSQL target must match database, local address, and port", () => {
  assert.doesNotThrow(() =>
    assertLocalTestConnection({
      database_name: "wholesale_marketplace_test",
      server_address: "127.0.0.1",
      server_port: 5432,
    }),
  );
  for (const target of [
    {
      database_name: "production",
      server_address: "127.0.0.1",
      server_port: 5432,
    },
    {
      database_name: "wholesale_marketplace_test",
      server_address: "203.0.113.10",
      server_port: 5432,
    },
    {
      database_name: "wholesale_marketplace_test",
      server_address: "127.0.0.1",
      server_port: 5433,
    },
    null,
  ]) {
    assert.throws(() => assertLocalTestConnection(target), /permitted local test target/);
  }
});

test("test environment overrides inherited database URLs before the pool loads", () => {
  const originalUrl = process.env.DATABASE_URL;
  const safeTestUrl = "postgresql://localhost:5432/wholesale_marketplace_test";
  let configOptions;
  process.env.DATABASE_URL = "postgresql://remote.example/production";

  try {
    const loadedUrl = loadTestDatabaseUrl({
      config: (options) => {
        configOptions = options;
        return { parsed: { DATABASE_URL: safeTestUrl } };
      },
    }, "server/.env.test");
    assert.equal(loadedUrl, safeTestUrl);
    assert.equal(process.env.DATABASE_URL, safeTestUrl);
    assert.equal(configOptions.path, "server/.env.test");
    assert.equal(configOptions.override, true);
  } finally {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
  }
});

test("migration history accepts an empty ledger and an exact prefix", () => {
  assert.equal(validateHistoryRows([]).size, 0);

  const firstFile = MIGRATION_FILES[0];
  const secondFile = MIGRATION_FILES[1];
  const result = validateHistoryRows([
    { filename: firstFile, checksum: migrationChecksum(firstFile) },
    { filename: secondFile, checksum: migrationChecksum(secondFile) },
  ]);
  assert.equal(result.size, 2);
});

test("migration history rejects unknown IDs, duplicates, gaps, and changed checksums", () => {
  const firstFile = MIGRATION_FILES[0];
  const secondFile = MIGRATION_FILES[1];
  const firstChecksum = migrationChecksum(firstFile);

  assert.throws(
    () => validateHistoryRows([{ filename: "not-a-migration.sql", checksum: firstChecksum }]),
    /unknown migration ID/,
  );
  assert.throws(
    () => validateHistoryRows([
      { filename: firstFile, checksum: firstChecksum },
      { filename: firstFile, checksum: firstChecksum },
    ]),
    /duplicate records/,
  );
  assert.throws(
    () => validateHistoryRows([{ filename: secondFile, checksum: migrationChecksum(secondFile) }]),
    /incomplete/,
  );
  assert.throws(
    () => validateHistoryRows([{ filename: firstFile, checksum: "0".repeat(64) }]),
    /changed since it was recorded/,
  );
});

test("baseline preflight accepts an empty schema and fails closed on objects", async () => {
  await assertBaselineSchemaClean({
    query: async () => ({ rows: [], rowCount: 0 }),
  }, false);

  await assert.rejects(
    assertBaselineSchemaClean({
      query: async () => ({
        rows: [{ object_type: "view", object_name: "private_view" }],
        rowCount: 1,
      }),
    }, false),
    /view private_view/,
  );
});

test("baseline object query covers required PostgreSQL object categories", async () => {
  let queryText = "";
  await assertBaselineSchemaClean({
    query: async (sql) => {
      queryText = sql;
      return { rows: [], rowCount: 0 };
    },
  }, false);

  for (const relationKind of ["'r'", "'p'", "'v'", "'m'", "'S'", "'f'", "'i'", "'I'"]) {
    assert.ok(queryText.includes(relationKind));
  }
  assert.match(queryText, /FROM pg_type/);
  assert.match(queryText, /FROM pg_proc/);
  assert.match(queryText, /FROM pg_operator/);
  assert.match(queryText, /FROM pg_event_trigger/);
});

test("baseline preflight excludes only the runner history table", async () => {
  await assertBaselineSchemaClean({
    query: async () => ({
      rows: [{ object_type: "table", object_name: "schema_migrations" }],
      rowCount: 1,
    }),
  }, true);

  await assert.rejects(
    assertBaselineSchemaClean({
      query: async (_sql, parameters) => ({
        rows: parameters[1]
          ? []
          : [{ object_type: "table", object_name: "schema_migrations" }],
        rowCount: parameters[1] ? 0 : 1,
      }),
    }, false),
    /schema_migrations/,
  );

  await assertBaselineSchemaClean({
    query: async () => ({
      rows: [
        { object_type: "table", object_name: "schema_migrations" },
        { object_type: "function", object_name: "unexpected_function()" },
      ],
      rowCount: 2,
    }),
  }, true).then(
    () => assert.fail("Unexpected public functions must not be permitted."),
    (error) => assert.match(error.message, /unexpected_function/),
  );
});

test("new history table is permitted during the baseline preflight", async () => {
  const calls = [];
  const client = {
    query: async (sql, parameters) => {
      if (sql.includes("FROM pg_class c") && !sql.includes("pg_index")) {
        calls.push("history lookup");
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("WITH history_table AS")) {
        calls.push(`baseline preflight:${parameters[1]}`);
        return {
          rows: parameters[1]
            ? [{ object_type: "table", object_name: "schema_migrations" }]
            : [],
          rowCount: parameters[1] ? 1 : 0,
        };
      }
      if (sql.includes("CREATE TABLE public.schema_migrations")) {
        calls.push("create history table");
        return { rows: [], rowCount: 0 };
      }
      assert.fail("Unexpected query in history-table setup.");
    },
  };

  assert.equal(await ensureHistoryTable(client), true);
  await assertBaselineSchemaClean(client, true);
  assert.deepEqual(calls, [
    "history lookup",
    "baseline preflight:false",
    "create history table",
    "baseline preflight:true",
  ]);
});

test("migration history table shape requires the runner schema", async () => {
  const responses = [
    { rows: [{ relkind: "r" }], rowCount: 1 },
    {
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
      rowCount: 3,
    },
    {
      rows: [{
        contype: "p",
        condeferrable: false,
        condeferred: false,
        convalidated: true,
        columns: ["filename"],
      }],
      rowCount: 1,
    },
    {
      rows: [{
        extra_indexes: 0,
        user_triggers: 0,
        row_security_policies: 0,
        row_security_enabled: 0,
        user_rules: 0,
      }],
      rowCount: 1,
    },
  ];
  const queries = [];
  await assertHistoryTableShape({
    query: async (sql) => {
      queries.push(sql);
      return responses.shift();
    },
  });
  assert.match(queries[2], /con\.contype <> 'n'/);
  assert.match(queries[2], /a\.attname::text/);
});

test("migration history table rejects unexpected defaults and generated columns", async () => {
  const makeColumns = () => [
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
  ];
  const invalidColumnSets = [
    makeColumns().map((column, index) =>
      index === 0 ? { ...column, column_default: "now()" } : column,
    ),
    makeColumns().map((column, index) =>
      index === 1
        ? { ...column, is_identity: "YES", is_generated: "ALWAYS" }
        : column,
    ),
  ];

  for (const columns of invalidColumnSets) {
    const responses = [
      { rows: [{ relkind: "r" }], rowCount: 1 },
      { rows: columns, rowCount: 3 },
    ];
    await assert.rejects(
      assertHistoryTableShape({
        query: async () => responses.shift(),
      }),
      /unexpected column definition/,
    );
  }
});

test("failed advisory unlock destroys the borrowed client and still ends the pool", async () => {
  const calls = [];
  const unlockError = new Error("unlock failed");
  const client = {
    query: async () => {
      calls.push("unlock");
      throw unlockError;
    },
    release: (destroy) => calls.push(`release:${destroy}`),
  };
  const pool = {
    end: async () => calls.push("pool:end"),
  };

  await assert.rejects(cleanupPool(pool, client, true), /unlock failed/);
  assert.deepEqual(calls, ["unlock", "release:true", "pool:end"]);
});

test("uncertain advisory lock acquisition destroys the borrowed client", async () => {
  const calls = [];
  const client = {
    query: async () => assert.fail("No unlock is attempted without confirmed acquisition."),
    release: (destroy) => calls.push(`release:${destroy}`),
  };
  const pool = {
    end: async () => calls.push("pool:end"),
  };

  await cleanupPool(pool, client, false, true);
  assert.deepEqual(calls, ["release:true", "pool:end"]);
});

test("successful advisory lock cleanup checks release and closes the pool", async () => {
  const calls = [];
  const client = {
    query: async () => {
      calls.push("unlock");
      return { rows: [{ pg_advisory_unlock: true }] };
    },
    release: (destroy) => calls.push(`release:${destroy}`),
  };
  const pool = {
    end: async () => calls.push("pool:end"),
  };

  await cleanupPool(pool, client, true, true);
  assert.deepEqual(calls, ["unlock", "release:false", "pool:end"]);
});

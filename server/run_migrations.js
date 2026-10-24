const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const MIGRATION_FILES = [
  "000_baseline.sql",
  "add_installment_payments.sql",
  "add_order_delivery_fields.sql",
  "add_seller_profile_columns.sql",
  "add_upi_id_field.sql",
  "enterprise_invoice_module.sql",
  "enterprise_order_management.sql",
  "inventory_forecast_intelligence.sql",
  "listing_visibility.sql",
  "messaging_system.sql",
  "notification_system.sql",
  "phase2_a_tracking.sql",
  "phase2_b_driver_links.sql",
  "phase2_c_warehouse.sql",
  "retail_features.sql",
  "reviews_system.sql",
  "retire_vanity_metrics.sql",
  "align_schema_with_app.sql",
  "fix_order_status_constraint.sql",
  "wholesale3_parties_and_sales.sql",
  "wholesale3_items.sql",
  "wholesale3_platform_masters.sql",
  "wholesale3_master_settings.sql",
  "wholesale3_purchases.sql",
  "wholesale3_opening_balance.sql",
  "wholesale3_party_state.sql",
  "wholesale3_listing_billing_fields.sql",
  "wholesale3_tax_on_top.sql",
  "wholesale3_tax_terms_and_cess.sql",
  "wholesale3_uqc_master_units.sql",
  "wholesale3_razorpay_route.sql",
  "wholesale3_invoice_numbers_per_wholesaler.sql",
  "wholesale3_invoice_number_format.sql",
  "wholesale3_invoice_document_block.sql",
  "wholesale3_invoice_rule46_fields.sql",
  "wholesale3_fractional_invoice_quantity.sql",
  "wholesale3_drop_invented_hsn.sql",
  "wholesale3_sales_channels.sql",
  "wholesale3_order_party.sql",
  "wholesale3_one_ledger.sql",
  "wholesale3_order_to_sale.sql",
  "wholesale3_invoice_from_sale.sql",
  "wholesale3_credit_notes.sql",
  "wholesale3_delivery_challans.sql",
  "wholesale3_sale_transport.sql",
  "wholesale3_order_transport.sql",
  "wholesale3_series_financial_year.sql",
  "wholesale3_challans_two_kinds.sql",
  "wholesale3_order_sequences.sql",
  "wholesale3_order_number_sequence.sql",
  "wholesale3_order_number_per_owner.sql",
  "wholesale3_imports.sql",
  "wholesale3_stock_ledger.sql",
  "wholesale3_staff_accounts.sql",
  "wholesale3_one_invoice_per_order.sql",
  "wholesale3_marketplace_linkages.sql",
  "z_fix_order_payment_status_constraint.sql",
];

const EXCLUDED_FILES = {
  "marketplace_schema.sql":
    "byte-identical duplicate of 000_baseline.sql, not a second baseline",
  "check_self_dealing_orders.sql":
    "read-only diagnostics; cleanup statements are comments",
  "backfill_paid_invoices.sql":
    "data repair that inserts payment/audit rows and updates paid invoices/orders",
  "fix_uuid_column_types.sql":
    "legacy type repair; it can delete order history or payment transaction rows",
  "add_trust_score_and_response_rate.sql":
    "adds unverified default vanity metrics instead of computed values",
  "drop_trust_score_and_response_rate.sql":
    "optional cleanup that drops profile metric columns",
  "wholesale3_drop_stale_credit_columns.sql":
    "optional guarded cleanup that may drop five stale party credit columns",
};

const MIGRATIONS_DIR = path.join(__dirname, "migrations");
const HISTORY_TABLE = "public.schema_migrations";
const HISTORY_TABLE_NAME = "schema_migrations";
const BASELINE_FILE = "000_baseline.sql";
const LOCK_ID = 1782667521;
const FILES_WITH_OUTER_TRANSACTION = new Set(["listing_visibility.sql"]);
const PUBLIC_SCHEMA_OBJECTS_QUERY = `
  WITH history_table AS (
    SELECT c.oid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = $1
      AND c.relkind = 'r'
  ),
  unexpected_objects AS (
    SELECT
      CASE c.relkind
        WHEN 'r' THEN 'table'
        WHEN 'p' THEN 'partitioned table'
        WHEN 'v' THEN 'view'
        WHEN 'm' THEN 'materialized view'
        WHEN 'S' THEN 'sequence'
        WHEN 'f' THEN 'foreign table'
        WHEN 'c' THEN 'composite relation'
        WHEN 'i' THEN 'index'
        WHEN 'I' THEN 'partitioned index'
      END AS object_type,
      c.relname AS object_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'c', 'i', 'I')
      AND NOT (
        $2::boolean
        AND
        c.relname = $1
        AND c.relkind = 'r'
      )
      AND NOT (
        $2::boolean
        AND
        c.relkind IN ('i', 'I')
        AND EXISTS (
          SELECT 1
          FROM pg_index i
          JOIN history_table h ON h.oid = i.indrelid
          JOIN pg_constraint con
            ON con.conrelid = h.oid
           AND con.conindid = i.indexrelid
           AND con.contype = 'p'
          WHERE i.indexrelid = c.oid
        )
      )
    UNION ALL
    SELECT 'user-defined type', t.typname
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typrelid = 0
      AND t.typelem = 0
      AND t.typtype IN ('b', 'd', 'e', 'p', 'r', 'm')
    UNION ALL
    SELECT
      CASE p.prokind
        WHEN 'p' THEN 'procedure'
        WHEN 'a' THEN 'aggregate'
        WHEN 'w' THEN 'window function'
        ELSE 'function'
      END,
      p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
    UNION ALL
    SELECT 'operator', o.oprname
    FROM pg_operator o
    JOIN pg_namespace n ON n.oid = o.oprnamespace
    WHERE n.nspname = 'public'
    UNION ALL
    SELECT 'operator class', opc.opcname
    FROM pg_opclass opc
    JOIN pg_namespace n ON n.oid = opc.opcnamespace
    WHERE n.nspname = 'public'
    UNION ALL
    SELECT 'operator family', opf.opfname
    FROM pg_opfamily opf
    JOIN pg_namespace n ON n.oid = opf.opfnamespace
    WHERE n.nspname = 'public'
    UNION ALL
    SELECT 'collation', coll.collname
    FROM pg_collation coll
    JOIN pg_namespace n ON n.oid = coll.collnamespace
    WHERE n.nspname = 'public'
    UNION ALL
    SELECT 'conversion', conv.conname
    FROM pg_conversion conv
    JOIN pg_namespace n ON n.oid = conv.connamespace
    WHERE n.nspname = 'public'
    UNION ALL
    SELECT 'text search configuration', cfg.cfgname
    FROM pg_ts_config cfg
    JOIN pg_namespace n ON n.oid = cfg.cfgnamespace
    WHERE n.nspname = 'public'
    UNION ALL
    SELECT 'text search dictionary', dict.dictname
    FROM pg_ts_dict dict
    JOIN pg_namespace n ON n.oid = dict.dictnamespace
    WHERE n.nspname = 'public'
    UNION ALL
    SELECT 'text search parser', parser.prsname
    FROM pg_ts_parser parser
    JOIN pg_namespace n ON n.oid = parser.prsnamespace
    WHERE n.nspname = 'public'
    UNION ALL
    SELECT 'text search template', template.tmplname
    FROM pg_ts_template template
    JOIN pg_namespace n ON n.oid = template.tmplnamespace
    WHERE n.nspname = 'public'
    UNION ALL
    SELECT 'event trigger', evt.evtname
    FROM pg_event_trigger evt
  )
  SELECT object_type, object_name
  FROM unexpected_objects
  ORDER BY object_type, object_name
`;

function readMigration(file) {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
}

function checksum(contents) {
  return crypto.createHash("sha256").update(contents).digest("hex");
}

function validateManifest() {
  const actualFiles = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const accountedFiles = new Set([
    ...MIGRATION_FILES,
    ...Object.keys(EXCLUDED_FILES),
  ]);
  const missing = actualFiles.filter((file) => !accountedFiles.has(file));
  const unknown = [...accountedFiles].filter((file) => !actualFiles.includes(file));

  if (missing.length || unknown.length) {
    throw new Error(
      [
        "Migration manifest does not match server/migrations.",
        missing.length ? `Unclassified SQL files: ${missing.join(", ")}` : "",
        unknown.length ? `Missing SQL files: ${unknown.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
}

function parseTestDatabaseUrl(databaseUrl) {
  let targetUrl;
  try {
    targetUrl = new URL(databaseUrl);
  } catch {
    throw new Error(
      "Invalid DATABASE_URL in server/.env.test. No database connection opened.",
    );
  }

  const host = targetUrl.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const database = decodeURIComponent(targetUrl.pathname.replace(/^\//, ""));
  const port = Number(targetUrl.port || 5432);

  if (
    !["postgres:", "postgresql:"].includes(targetUrl.protocol) ||
    !["localhost", "127.0.0.1", "::1"].includes(host) ||
    database !== "wholesale_marketplace_test" ||
    port !== 5432
  ) {
    throw new Error(
      "Refusing to migrate: only local wholesale_marketplace_test on port 5432 is permitted.",
    );
  }

  return targetUrl;
}

function loadTestDatabaseUrl(dotenv, envPath) {
  const envResult = dotenv.config({
    path: envPath,
    override: true,
    quiet: true,
  });

  if (envResult.error || !envResult.parsed?.DATABASE_URL) {
    throw new Error(
      "Cannot load DATABASE_URL from server/.env.test. No database connection opened.",
    );
  }

  parseTestDatabaseUrl(envResult.parsed.DATABASE_URL);
  process.env.DATABASE_URL = envResult.parsed.DATABASE_URL;
  return envResult.parsed.DATABASE_URL;
}

function assertLocalTestConnection(target) {
  if (
    target?.database_name !== "wholesale_marketplace_test" ||
    !["127.0.0.1", "::1"].includes(target?.server_address) ||
    target?.server_port !== 5432
  ) {
    throw new Error(
      "Connected server/database is not the permitted local test target. Migrations refused.",
    );
  }
}

function validateHistoryRows(rows) {
  const applied = new Map();
  for (const row of rows) {
    if (typeof row.filename !== "string" || !MIGRATION_FILES.includes(row.filename)) {
      throw new Error(
        `Migration history contains an unknown migration ID: ${String(row.filename)}.`,
      );
    }
    if (applied.has(row.filename)) {
      throw new Error(
        `Migration history contains duplicate records for ${row.filename}.`,
      );
    }
    if (typeof row.checksum !== "string" || !/^[a-f0-9]{64}$/i.test(row.checksum)) {
      throw new Error(
        `Migration history contains an invalid checksum for ${row.filename}.`,
      );
    }

    const expectedChecksum = checksum(readMigration(row.filename));
    if (row.checksum.toLowerCase() !== expectedChecksum) {
      throw new Error(
        `${row.filename} has changed since it was recorded. Resolve the migration history manually before continuing.`,
      );
    }
    applied.set(row.filename, row.checksum.toLowerCase());
  }

  for (let index = 0; index < applied.size; index += 1) {
    const expectedFile = MIGRATION_FILES[index];
    if (!applied.has(expectedFile)) {
      throw new Error(
        `Migration history is incomplete: ${expectedFile} is missing before a later recorded migration.`,
      );
    }
  }

  return applied;
}

async function assertHistoryTableShape(client) {
  const relationResult = await client.query(
    `SELECT c.relkind
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = $1`,
    [HISTORY_TABLE_NAME],
  );
  if (relationResult.rowCount !== 1 || relationResult.rows[0].relkind !== "r") {
    throw new Error(
      "public.schema_migrations exists but is not the runner's ordinary table.",
    );
  }

  const columnsResult = await client.query(
    `SELECT column_name, data_type, is_nullable, column_default,
            is_identity, is_generated
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
      ORDER BY ordinal_position`,
    [HISTORY_TABLE_NAME],
  );
  const expectedColumns = [
    ["filename", "text", "NO", null],
    ["checksum", "text", "NO", null],
    ["applied_at", "timestamp with time zone", "NO", "CURRENT_TIMESTAMP"],
  ];
  const actualColumns = columnsResult.rows.map((column) => [
    column.column_name,
    column.data_type,
    column.is_nullable,
    column.column_default,
    column.is_identity,
    column.is_generated,
  ]);
  const columnsMatch =
    actualColumns.length === expectedColumns.length &&
    expectedColumns.every(
      (column, index) =>
        column[0] === actualColumns[index][0] &&
        column[1] === actualColumns[index][1] &&
        column[2] === actualColumns[index][2] &&
        (column[3] === null
          ? actualColumns[index][3] === null
          : actualColumns[index][3]?.trim().toUpperCase() === column[3]) &&
        actualColumns[index][4] === "NO" &&
        actualColumns[index][5] === "NEVER",
    );
  if (!columnsMatch) {
    throw new Error(
      "public.schema_migrations has an unexpected column definition.",
    );
  }

  const constraintsResult = await client.query(
    `SELECT con.contype,
            con.condeferrable,
            con.condeferred,
            con.convalidated,
            ARRAY(
              SELECT a.attname::text
              FROM unnest(con.conkey) WITH ORDINALITY AS key(attnum, ord)
              JOIN pg_attribute a
                ON a.attrelid = con.conrelid
               AND a.attnum = key.attnum
              ORDER BY key.ord
            ) AS columns
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
         AND c.relname = $1
         -- NOT NULL constraints are checked through information_schema above.
         AND con.contype <> 'n'`,
    [HISTORY_TABLE_NAME],
  );
  if (
    constraintsResult.rowCount !== 1 ||
    constraintsResult.rows[0].contype !== "p" ||
    constraintsResult.rows[0].condeferrable ||
    constraintsResult.rows[0].condeferred ||
    !constraintsResult.rows[0].convalidated ||
    constraintsResult.rows[0].columns.join(",") !== "filename"
  ) {
    throw new Error(
      "public.schema_migrations must have only a primary key on filename.",
    );
  }

  const extrasResult = await client.query(
    `SELECT
       (SELECT count(*)::int
          FROM pg_index i
          JOIN pg_class t ON t.oid = i.indrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'public'
           AND t.relname = $1
           AND NOT i.indisprimary) AS extra_indexes,
       (SELECT count(*)::int
          FROM pg_trigger tr
          JOIN pg_class t ON t.oid = tr.tgrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'public'
           AND t.relname = $1
           AND NOT tr.tgisinternal) AS user_triggers,
       (SELECT count(*)::int
          FROM pg_policy pol
          JOIN pg_class t ON t.oid = pol.polrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'public'
           AND t.relname = $1) AS row_security_policies,
       (SELECT count(*)::int
          FROM pg_class t
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'public'
           AND t.relname = $1
           AND (t.relrowsecurity OR t.relforcerowsecurity)) AS row_security_enabled,
       (SELECT count(*)::int
          FROM pg_rewrite rw
          JOIN pg_class t ON t.oid = rw.ev_class
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'public'
           AND t.relname = $1
           AND rw.rulename <> '_RETURN') AS user_rules`,
    [HISTORY_TABLE_NAME],
  );
  const extras = extrasResult.rows[0];
  if (
    Number(extras.extra_indexes) ||
    Number(extras.user_triggers) ||
    Number(extras.row_security_policies) ||
    Number(extras.row_security_enabled) ||
    Number(extras.user_rules)
  ) {
    throw new Error(
      "public.schema_migrations has indexes, triggers, row security, policies, or rules not created by the runner.",
    );
  }
}

async function assertBaselineSchemaClean(client, allowHistoryTable) {
  const result = await client.query(PUBLIC_SCHEMA_OBJECTS_QUERY, [
    HISTORY_TABLE_NAME,
    allowHistoryTable,
  ]);
  const unexpected = result.rows.filter(
    (object) =>
      !allowHistoryTable ||
      object.object_type !== "table" ||
      object.object_name !== HISTORY_TABLE_NAME,
  );
  if (unexpected.length) {
    const summary = unexpected
      .slice(0, 10)
      .map((object) => `${object.object_type} ${object.object_name}`)
      .join(", ");
    throw new Error(
      `The public schema contains objects outside the permitted empty-baseline state: ${summary}${unexpected.length > 10 ? ", ..." : ""}. Refusing to apply the baseline.`,
    );
  }
}

async function ensureHistoryTable(client) {
  const historyRelation = await client.query(
    `SELECT c.relkind
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = $1`,
    [HISTORY_TABLE_NAME],
  );

  if (historyRelation.rowCount > 0) {
    await assertHistoryTableShape(client);
    return true;
  }

  await assertBaselineSchemaClean(client, false);
  await client.query(
    `CREATE TABLE ${HISTORY_TABLE} (
       filename TEXT PRIMARY KEY,
       checksum TEXT NOT NULL,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
  );
  return true;
}

function printPlan() {
  validateManifest();
  console.log("Migration plan only. No database connection was opened.");
  MIGRATION_FILES.forEach((file, index) => {
    console.log(`${String(index + 1).padStart(2, "0")}. ${file}`);
  });
  console.log("\nExcluded SQL files:");
  for (const [file, reason] of Object.entries(EXCLUDED_FILES)) {
    console.log(`- ${file}: ${reason}`);
  }
}

function removeOuterTransaction(file, sql) {
  if (!FILES_WITH_OUTER_TRANSACTION.has(file)) return sql;

  const lines = sql.split(/\r?\n/);
  const beginIndex = lines.findIndex((line) => line.trim() === "BEGIN;");
  const commitIndex = lines.findLastIndex
    ? lines.findLastIndex((line) => line.trim() === "COMMIT;")
    : (() => {
        for (let index = lines.length - 1; index >= 0; index -= 1) {
          if (lines[index].trim() === "COMMIT;") return index;
        }
        return -1;
      })();

  if (beginIndex < 0 || commitIndex <= beginIndex) {
    throw new Error(
      `Expected one outer BEGIN/COMMIT pair in ${file}; refusing to run it.`,
    );
  }

  lines.splice(commitIndex, 1);
  lines.splice(beginIndex, 1);
  return lines.join("\n");
}

function safeErrorMessage(error) {
  const message = error?.message || String(error);
  return message.replace(/(postgres(?:ql)?:\/\/)[^@\s/]+@/gi, "$1[redacted]@");
}

async function rollback(client, migrationError) {
  try {
    await client.query("ROLLBACK");
  } catch (rollbackError) {
    throw new AggregateError(
      [migrationError, rollbackError],
      `Migration failed and rollback also failed: ${safeErrorMessage(rollbackError)}`,
    );
  }
}

async function cleanupPool(pool, client, lockAcquired, lockAttempted) {
  let destroyClient = Boolean(lockAttempted && !lockAcquired);
  const cleanupErrors = [];

  if (client && lockAcquired) {
    try {
      const result = await client.query(
        "SELECT pg_advisory_unlock($1)",
        [LOCK_ID],
      );
      if (result.rows[0]?.pg_advisory_unlock !== true) {
        throw new Error("PostgreSQL advisory lock was not held at cleanup.");
      }
    } catch (error) {
      destroyClient = true;
      cleanupErrors.push(error);
    }
  }

  try {
    if (client) client.release(destroyClient);
  } catch (error) {
    cleanupErrors.push(error);
  } finally {
    try {
      await pool.end();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  if (cleanupErrors.length > 1) {
    throw new AggregateError(
      cleanupErrors,
      "Migration connection cleanup failed.",
    );
  }
}




async function applyMigrations() {
  validateManifest();

  // Load only the dedicated test environment for this command.
  const envPath = path.join(__dirname, ".env.test");
  const dotenv = require("dotenv");
  loadTestDatabaseUrl(dotenv, envPath);

  const pool = require("./src/config/db");
  let client;
  let lockAcquired = false;
  let lockAttempted = false;

  try {
    client = await pool.connect();

    // Verify the actual PostgreSQL connection before any migration SQL.
    const targetCheck = await client.query(
      "SELECT current_database() AS database_name, host(inet_server_addr()) AS server_address, inet_server_port() AS server_port",
    );
    assertLocalTestConnection(targetCheck.rows[0]);

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
      const contents = readMigration(file);
      const digest = checksum(contents);
      const previousDigest = applied.get(file);

      if (previousDigest) {
        console.log(`  recorded  ${file}`);
        continue;
      }

      if (file !== BASELINE_FILE && !applied.has(BASELINE_FILE)) {
        throw new Error(
          `Refusing to apply ${file} before ${BASELINE_FILE} is recorded.`,
        );
      }

      const sql = removeOuterTransaction(file, contents);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO ${HISTORY_TABLE} (filename, checksum)
           VALUES ($1, $2)`,
          [file, digest],
        );
        await client.query("COMMIT");
      } catch (error) {
        await rollback(client, error);
        throw error;
      }
      applied.set(file, digest);
      console.log(`  applied   ${file}`);
    }

    console.log(`\n${MIGRATION_FILES.length} planned migrations are recorded.`);
  } finally {
    await cleanupPool(pool, client, lockAcquired, lockAttempted);
  }
}


async function main(args = process.argv.slice(2), apply = applyMigrations) {
  if (args.length === 0 || (args.length === 1 && args[0] === "--plan")) {
    printPlan();
    return;
  }
  if (args.length === 1 && args[0] === "--apply") {
    await apply();
    return;
  }
  throw new Error("Usage: node run_migrations.js [--plan | --apply]");
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Migration run failed:", safeErrorMessage(error));
    process.exitCode = 1;
  });
}

module.exports = {
  MIGRATION_FILES,
  EXCLUDED_FILES,
  assertBaselineSchemaClean,
  assertHistoryTableShape,
  assertLocalTestConnection,
  ensureHistoryTable,
  checksum,
  cleanupPool,
  loadTestDatabaseUrl,
  main,
  parseTestDatabaseUrl,
  printPlan,
  validateHistoryRows,
  validateManifest,
};

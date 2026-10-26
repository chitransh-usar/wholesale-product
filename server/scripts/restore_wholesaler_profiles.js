const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const buildDatabaseConfig = require("../src/config/databaseConfig");
const {
  MIGRATION_FILES,
  LOCK_ID,
  assertHistoryTableShape,
  checksum,
  validateHistoryRows,
} = require("../run_migrations");

const PROFILE_MIGRATIONS = [
  "wholesale3_restore_wholesaler_profiles.sql",
  "wholesale3_restore_wholesaler_profile_payout_fields.sql",
];
const REQUIRED_PROFILE_COLUMNS = [
  "id",
  "user_id",
  "company_name",
  "gstin",
  "is_verified",
  "upi_id",
  "city",
  "country",
  "gst_verified",
  "years_in_business",
  "contact_phone",
  "created_at",
  "updated_at",
  "lat",
  "lng",
  "geocoded_at",
  "warehouse_address",
  "warehouse_city",
  "warehouse_state",
  "warehouse_pincode",
  "warehouse_pinned",
  "registered_address",
  "registered_state",
  "registered_pincode",
  "razorpay_account_id",
  "razorpay_kyc_status",
  "razorpay_status_note",
  "razorpay_onboarded_at",
  "razorpay_checked_at",
];
const REQUIRED_PAYOUT_COLUMNS = [
  "bank_account_number",
  "bank_ifsc",
  "bank_branch",
];
const REQUIRED_PROFILE_CONSTRAINTS = [
  "wholesaler_profiles_pkey",
  "wholesaler_profiles_user_id_fkey",
  "wholesaler_profiles_razorpay_kyc_status_check",
];
const REQUIRED_PROFILE_INDEXES = ["idx_wholesaler_razorpay_account"];
const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

function parseArgs(args) {
  let apply = false;
  let confirmBackup = false;
  let databaseName;

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--apply") {
      apply = true;
    } else if (args[index] === "--confirm-backup") {
      confirmBackup = true;
    } else if (args[index] === "--database" && args[index + 1]) {
      databaseName = args[index + 1];
      index += 1;
    } else {
      throw new Error(
        "Usage: npm run migrate:restore-wholesaler-profile -- --apply --database <database-name> --confirm-backup",
      );
    }
  }

  if (!apply || !confirmBackup || !databaseName) {
    throw new Error(
      "Refusing migration. Supply --apply, the verified --database name, and --confirm-backup.",
    );
  }
  return { databaseName };
}

async function inspectProfile(client, { allowMissingPayoutFields = false } = {}) {
  const relation = await client.query(
    "SELECT to_regclass('public.wholesaler_profiles') IS NOT NULL AS exists",
  );
  if (!relation.rows[0].exists) return { exists: false };

  const [columns, constraints, indexes] = await Promise.all([
    client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'wholesaler_profiles'`,
    ),
    client.query(
      `SELECT conname, contype, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid = 'public.wholesaler_profiles'::regclass`,
    ),
    client.query(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'wholesaler_profiles'`,
    ),
  ]);

  const columnNames = new Set(columns.rows.map((row) => row.column_name));
  const constraintByName = new Map(constraints.rows.map((row) => [row.conname, row]));
  const indexByName = new Map(indexes.rows.map((row) => [row.indexname, row.indexdef]));
  const kycConstraint = constraintByName.get(
    "wholesaler_profiles_razorpay_kyc_status_check",
  );
  const kycDefinition = String(kycConstraint?.definition || "").toLowerCase();
  const accountIndex = String(indexByName.get("idx_wholesaler_razorpay_account") || "")
    .toLowerCase();
  const malformedConstraints =
    constraintByName.get("wholesaler_profiles_pkey")?.contype !== "p" ||
    constraintByName.get("wholesaler_profiles_user_id_fkey")?.contype !== "f" ||
    !/foreign key \(user_id\) references (public\.)?users\(id\) on delete cascade/i
      .test(constraintByName.get("wholesaler_profiles_user_id_fkey")?.definition || "") ||
    kycConstraint?.contype !== "c" ||
    ![
      "not_started",
      "created",
      "under_review",
      "needs_clarification",
      "activated",
      "suspended",
    ].every((status) => kycDefinition.includes(status));
  const malformedIndex =
    !/create unique index/.test(accountIndex) ||
    !accountIndex.includes("razorpay_account_id") ||
    !accountIndex.includes("where") ||
    !accountIndex.includes("is not null");
  const missing = [
    ...REQUIRED_PROFILE_COLUMNS.filter((name) => !columnNames.has(name)),
    ...(allowMissingPayoutFields
      ? []
      : REQUIRED_PAYOUT_COLUMNS.filter((name) => !columnNames.has(name))),
    ...REQUIRED_PROFILE_CONSTRAINTS.filter((name) => !constraintByName.has(name)),
    ...(malformedConstraints ? ["constraint definitions"] : []),
    ...REQUIRED_PROFILE_INDEXES.filter((name) => !indexByName.has(name)),
    ...(malformedIndex ? ["idx_wholesaler_razorpay_account definition"] : []),
  ];
  if (missing.length) {
    throw new Error(
      `public.wholesaler_profiles exists but does not match the expected schema. Missing: ${missing.join(", ")}. Stop and review the live schema.`,
    );
  }
  return {
    exists: true,
    payoutFieldsComplete: REQUIRED_PAYOUT_COLUMNS.every((name) => columnNames.has(name)),
  };
}

async function readMigrationHistory(client, exists) {
  if (!exists) return null;
  await assertHistoryTableShape(client);
  const result = await client.query(
    "SELECT filename, checksum FROM public.schema_migrations ORDER BY filename",
  );
  validateHistoryRows(result.rows);
  if (result.rows.length < MIGRATION_FILES.length - PROFILE_MIGRATIONS.length) {
    throw new Error(
      "Migration history is not at the profile-repair boundary. Reconcile applied migrations before proceeding.",
    );
  }
  return new Map(result.rows.map((row) => [row.filename, row.checksum]));
}

async function runRepair({ pool, databaseName }) {
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query(
      "SELECT pg_advisory_xact_lock($1)",
      [LOCK_ID],
    );

    const identity = await client.query(
      `SELECT current_database() AS database_name,
              current_schemas(true) AS effective_schemas,
              to_regclass('public.users') IS NOT NULL AS users_exists,
              to_regclass('public.schema_migrations') IS NOT NULL AS history_exists`,
    );
    const target = identity.rows[0];
    if (target.database_name !== databaseName) {
      throw new Error(
        "Connected database does not match --database. No schema changes were made.",
      );
    }
    if (!target.effective_schemas.includes("public")) {
      throw new Error(
        "The active search_path does not include public. No schema changes were made.",
      );
    }
    if (!target.users_exists) {
      throw new Error(
        "public.users is missing. Do not restore profiles until the intended database and user schema are verified.",
      );
    }

    const nonPublicProfile = await client.query(
      `SELECT table_schema FROM information_schema.tables
       WHERE table_name = 'wholesaler_profiles' AND table_schema <> 'public'
       LIMIT 1`,
    );
    if (nonPublicProfile.rowCount) {
      throw new Error(
        "A wholesaler_profiles relation exists outside public. Review the database schema before proceeding.",
      );
    }

    const history = await readMigrationHistory(client, target.history_exists);
    const profile = await inspectProfile(client, { allowMissingPayoutFields: true });
    if (!profile.exists && history?.has(PROFILE_MIGRATIONS[0])) {
      throw new Error(
        "Migration history records the profile repair, but public.wholesaler_profiles is absent. Treat this as schema drift and investigate before proceeding.",
      );
    }

    if (profile.exists && profile.payoutFieldsComplete && !history) {
      await client.query("COMMIT");
      transactionOpen = false;
      return { changed: false };
    }

    let changed = false;
    for (const filename of PROFILE_MIGRATIONS) {
      if (history?.has(filename)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), "utf8");
      await client.query(sql);
      changed = true;
      if (history) {
        await client.query(
          `INSERT INTO public.schema_migrations (filename, checksum)
           VALUES ($1, $2)`,
          [filename, checksum(sql)],
        );
        history.set(filename, checksum(sql));
      }
    }

    const verified = await inspectProfile(client);
    if (!verified.exists) {
      throw new Error(
        "The profile migrations completed without creating public.wholesaler_profiles.",
      );
    }
    await client.query("COMMIT");
    transactionOpen = false;
    return { changed };
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK").catch(() => {});
      transactionOpen = false;
    }
    throw error;
  } finally {
    client.release();
  }
}

async function main(args = process.argv.slice(2)) {
  const { databaseName } = parseArgs(args);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");

  let parsedUrl;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }
  const host = parsedUrl.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error("This repair command refuses local database targets.");
  }

  const pool = new Pool({
    ...buildDatabaseConfig(databaseUrl, process.env.DATABASE_SSL_CA || undefined),
    max: 1,
  });
  try {
    const result = await runRepair({ pool, databaseName });
    console.log(
      result.changed
        ? "Wholesaler profile repair committed and verified."
        : "Wholesaler profile schema already exists and was verified. No changes were needed.",
    );
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(
      error.code
        ? `Wholesaler profile repair failed (${error.code}). No database details were logged.`
        : `Wholesaler profile repair failed: ${error.message}`,
    );
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, runRepair };

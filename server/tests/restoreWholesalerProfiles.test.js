const test = require("node:test");
const assert = require("node:assert/strict");
const { parseArgs, runRepair } = require("../scripts/restore_wholesaler_profiles");

test("profile repair requires an explicit target, apply flag, and backup confirmation", () => {
  assert.deepEqual(
    parseArgs([
      "--apply",
      "--database",
      "production_db",
      "--confirm-backup",
    ]),
    { databaseName: "production_db" },
  );
  assert.throws(() => parseArgs([]), /Refusing migration/);
  assert.throws(
    () => parseArgs(["--apply", "--database", "production_db"]),
    /confirm-backup/,
  );
});

for (const identity of [
  {
    database_name: "unexpected_db",
    effective_schemas: ["public"],
    users_exists: true,
    history_exists: false,
  },
  {
    database_name: "production_db",
    effective_schemas: ["public"],
    users_exists: false,
    history_exists: false,
  },
  {
    database_name: "production_db",
    effective_schemas: ["other"],
    users_exists: true,
    history_exists: false,
  },
]) {
  test(`profile repair refuses unsafe database preflight: ${JSON.stringify(identity)}`, async () => {
    const queries = [];
    const pool = {
      async connect() {
        return {
          async query(sql) {
            queries.push(sql);
            if (sql.startsWith("SELECT current_database()")) {
              return { rows: [identity] };
            }
            if (sql.startsWith("SELECT table_schema")) {
              return { rows: [], rowCount: 0 };
            }
            return { rows: [], rowCount: 0 };
          },
          release() {},
        };
      },
    };

    await assert.rejects(
      runRepair({ pool, databaseName: "production_db" }),
      /(?:does not match|public\.users is missing|search_path does not include public)/,
    );
    assert.equal(
      queries.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS public.wholesaler_profiles")),
      false,
    );
    assert.ok(queries.includes("ROLLBACK"));
  });
}

test("profile repair creates and verifies the established table in one transaction", async () => {
  const queries = [];
  let profileExists = false;
  const profileColumns = [
    "id", "user_id", "company_name", "gstin", "is_verified", "upi_id",
    "city", "country", "gst_verified", "years_in_business", "contact_phone",
    "created_at", "updated_at", "lat", "lng", "geocoded_at",
    "warehouse_address", "warehouse_city", "warehouse_state", "warehouse_pincode",
    "warehouse_pinned", "registered_address", "registered_state",
    "registered_pincode", "bank_account_number", "bank_ifsc", "bank_branch",
    "razorpay_account_id", "razorpay_kyc_status", "razorpay_status_note",
    "razorpay_onboarded_at", "razorpay_checked_at",
  ];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql.startsWith("SELECT current_database()")) {
        return {
          rows: [{
            database_name: "production_db",
            effective_schemas: ["public"],
            users_exists: true,
            history_exists: false,
          }],
        };
      }
      if (sql.startsWith("SELECT table_schema")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("SELECT to_regclass('public.wholesaler_profiles')")) {
        return { rows: [{ exists: profileExists }] };
      }
      if (sql.includes("CREATE TABLE IF NOT EXISTS public.wholesaler_profiles")) {
        profileExists = true;
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("information_schema.columns")) {
        return { rows: profileColumns.map((column_name) => ({ column_name })) };
      }
      if (sql.includes("FROM pg_constraint")) {
        return {
          rows: [
            {
              conname: "wholesaler_profiles_pkey",
              contype: "p",
              definition: "PRIMARY KEY (id)",
            },
            {
              conname: "wholesaler_profiles_user_id_fkey",
              contype: "f",
              definition: "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE",
            },
            {
              conname: "wholesaler_profiles_razorpay_kyc_status_check",
              contype: "c",
              definition:
                "CHECK (razorpay_kyc_status IN ('not_started', 'created', 'under_review', 'needs_clarification', 'activated', 'suspended'))",
            },
          ],
        };
      }
      if (sql.includes("FROM pg_indexes")) {
        return {
          rows: [{
            indexname: "idx_wholesaler_razorpay_account",
            indexdef:
              "CREATE UNIQUE INDEX idx_wholesaler_razorpay_account ON public.wholesaler_profiles USING btree (razorpay_account_id) WHERE (razorpay_account_id IS NOT NULL)",
          }],
        };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const pool = {
    async connect() {
      return client;
    },
  };

  const result = await runRepair({ pool, databaseName: "production_db" });

  assert.deepEqual(result, { changed: true });
  assert.equal(queries[0], "BEGIN");
  assert.ok(queries.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS public.wholesaler_profiles")));
  assert.ok(queries.some((sql) => sql.includes("ADD COLUMN IF NOT EXISTS bank_account_number")));
  assert.equal(queries.at(-1), "COMMIT");
  assert.equal(queries.some((sql) => sql.includes("INSERT INTO users")), false);
  assert.equal(queries.some((sql) => sql.includes("INSERT INTO wholesaler_profiles")), false);

  queries.length = 0;
  const replay = await runRepair({ pool, databaseName: "production_db" });
  assert.deepEqual(replay, { changed: false });
  assert.equal(
    queries.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS public.wholesaler_profiles")),
    false,
  );
  assert.equal(queries.at(-1), "COMMIT");
});

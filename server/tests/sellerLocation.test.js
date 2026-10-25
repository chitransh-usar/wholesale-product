const test = require("node:test");
const assert = require("node:assert/strict");
const {
  citySqlFor,
  resolveCitySql,
} = require("../src/services/sellerLocation");

test("seller location reads only optional city columns from public profiles", async () => {
  let sql;
  const result = await resolveCitySql({
    async query(query) {
      sql = query;
      return {
        rows: [{
          profile_exists: true,
          profile_columns: ["city", "warehouse_city"],
        }],
      };
    },
  });

  assert.match(sql, /to_regclass\('public\.wholesaler_profiles'\)/);
  assert.match(sql, /FROM information_schema\.columns/);
  assert.match(sql, /table_schema = 'public'/);
  assert.match(sql, /table_name = 'wholesaler_profiles'/);
  assert.deepEqual(
    {
      hasCity: result.hasLegacyCity,
      hasWarehouseCity: result.hasWarehouseCity,
    },
    { hasCity: true, hasWarehouseCity: true },
  );
  assert.match(result.citySql, /wp\.warehouse_city/);
  assert.match(result.citySql, /wp\.city/);
});

test("seller location supports older profiles without either city column", async () => {
  const result = await resolveCitySql({
    async query() {
      return { rows: [{ profile_exists: true, profile_columns: [] }] };
    },
  });

  assert.equal(result.hasLegacyCity, false);
  assert.equal(result.hasWarehouseCity, false);
  assert.equal(result.citySql, "NULL");
  assert.equal(citySqlFor({ hasLegacyCity: false, hasWarehouseCity: false }), "NULL");
});

test("seller location identifies a missing required profile relation", async () => {
  await assert.rejects(
    resolveCitySql({
      async query() {
        return { rows: [{ profile_exists: false, profile_columns: [] }] };
      },
    }),
    (error) =>
      error.code === "42P01" &&
      error.schema === "public" &&
      error.table === "wholesaler_profiles",
  );
});

test("seller location does not conceal errors reading PostgreSQL metadata", async () => {
  const missingMetadata = Object.assign(
    new Error("sensitive database details"),
    {
      code: "42P01",
      schema: "information_schema",
      table: "columns",
    },
  );

  await assert.rejects(
    resolveCitySql({
      async query() {
        throw missingMetadata;
      },
    }),
    (error) => error === missingMetadata,
  );
});

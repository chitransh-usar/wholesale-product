const test = require("node:test");
const assert = require("node:assert/strict");
const {
  cityFilterFrom,
  cityKey,
  cityKeySqlFor,
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

test("seller location parses PostgreSQL array text for both city columns", async () => {
  const result = await resolveCitySql({
    async query() {
      return {
        rows: [{
          profile_exists: true,
          profile_columns: "{city,warehouse_city}",
        }],
      };
    },
  });

  assert.equal(result.hasWarehouseCity, true);
  assert.equal(result.hasLegacyCity, true);
  assert.equal(
    result.citySql.replace(/\s+/g, " ").trim(),
    "COALESCE( NULLIF(btrim(wp.warehouse_city), ''), NULLIF(btrim(wp.city), '') )",
  );
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

test("seller location treats null, empty, and unexpected metadata as missing city columns", async () => {
  for (const profileColumns of [null, [], "{}", "city,warehouse_city", "{region}"]) {
    const result = await resolveCitySql({
      async query() {
        return { rows: [{ profile_exists: true, profile_columns: profileColumns }] };
      },
    });

    assert.equal(result.hasLegacyCity, false, `profile_columns=${profileColumns}`);
    assert.equal(result.hasWarehouseCity, false, `profile_columns=${profileColumns}`);
    assert.equal(result.citySql, "NULL", `profile_columns=${profileColumns}`);
  }
});

test("seller location generates valid expressions for either optional city column", async () => {
  assert.match(
    citySqlFor({ hasWarehouseCity: true, hasLegacyCity: false }),
    /wp\.warehouse_city/,
  );
  assert.doesNotMatch(
    citySqlFor({ hasWarehouseCity: true, hasLegacyCity: false }),
    /wp\.city/,
  );
  assert.equal(
    citySqlFor({ hasWarehouseCity: false, hasLegacyCity: true }),
    "NULLIF(btrim(wp.city), '')",
  );
  assert.match(
    cityKeySqlFor("NULLIF(btrim(wp.warehouse_city), '')"),
    /lower\(regexp_replace/,
  );
  const warehouseOnly = await resolveCitySql({
    async query() {
      return { rows: [{ profile_exists: true, profile_columns: ["warehouse_city"] }] };
    },
  });
  assert.match(warehouseOnly.citySql, /wp\.warehouse_city/);
  assert.doesNotMatch(warehouseOnly.citySql, /wp\.city/);
});

test("city filtering folds whitespace and ignores all-city selections", () => {
  assert.equal(cityKey(" Surat  Textile  Market "), "surat textile market");
  assert.equal(cityFilterFrom({ city: " Surat  Textile  Market " }), "surat textile market");
  assert.equal(cityFilterFrom({}), null);
  assert.equal(cityFilterFrom({ city: "All India" }), null);
  assert.equal(cityFilterFrom({ city: "all" }), null);
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

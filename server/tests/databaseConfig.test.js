const test = require("node:test");
const assert = require("node:assert/strict");
const { Client } = require("pg");
const buildDatabaseConfig = require("../src/config/databaseConfig");
const { databaseErrorStatus, logDatabaseError } = require("../src/utils/databaseError");

test("database URL is required and malformed or non-PostgreSQL URLs are rejected safely", () => {
  assert.throws(() => buildDatabaseConfig(), /DATABASE_URL is required/);
  assert.throws(
    () => buildDatabaseConfig("not a URL containing secret"),
    /valid PostgreSQL connection URL/,
  );
  assert.throws(
    () => buildDatabaseConfig("https://user:secret@example.com/db"),
    /postgres or postgresql protocol/,
  );
  assert.throws(
    () => buildDatabaseConfig("postgresql://user:secret@example.com"),
    /database host and name/,
  );
});

test("local PostgreSQL defaults to no TLS but can explicitly require TLS", () => {
  const local = buildDatabaseConfig("postgresql://user:secret@localhost:5432/app");
  assert.equal(local.ssl, false);
  assert.equal(local.options, "-c search_path=public");
  assert.equal(local.connectionTimeoutMillis, 5000);
  assert.equal(local.idleTimeoutMillis, 30000);
  assert.equal(local.query_timeout, 9000);
  assert.equal(local.statement_timeout, 8000);
  assert.equal(new URL(local.connectionString).password, "secret");

  const localTls = buildDatabaseConfig(
    "postgresql://localhost:5432/app?sslmode=require",
  );
  assert.deepEqual(localTls.ssl, { rejectUnauthorized: true });
  assert.equal(new URL(localTls.connectionString).searchParams.has("sslmode"), false);
});

test("external PostgreSQL connections always require verified TLS", () => {
  for (const url of [
    "postgresql://user:secret@db.example.com:5432/app",
    "postgresql://user:secret@db.example.com:5432/app?sslmode=require",
    "postgresql://user:secret@db.example.com:5432/app?sslmode=verify-full",
  ]) {
    const config = buildDatabaseConfig(url);
    assert.deepEqual(config.ssl, { rejectUnauthorized: true });
    assert.equal(new URL(config.connectionString).searchParams.has("sslmode"), false);
  }

  const ca = "-----BEGIN CERTIFICATE-----\ntrusted-ca\n-----END CERTIFICATE-----";
  assert.deepEqual(
    buildDatabaseConfig("postgresql://user:secret@db.example.com/app", ca).ssl,
    { rejectUnauthorized: true, ca },
  );
});

test("node-postgres receives the explicit public schema search path", () => {
  const config = buildDatabaseConfig("postgresql://db.example.com/app");
  const client = new Client(config);

  assert.equal(client.connectionParameters.options, "-c search_path=public");
});

test("Render internal PostgreSQL requires a trusted CA for verified TLS", () => {
  const internalUrl = "postgresql://user:secret@abc.render.internal/db";
  assert.throws(() => buildDatabaseConfig(internalUrl), /requires DATABASE_SSL_CA/);
  assert.throws(
    () => buildDatabaseConfig(`${internalUrl}?sslmode=require`),
    /requires DATABASE_SSL_CA/,
  );

  const ca = "-----BEGIN CERTIFICATE-----\ntrusted-ca\n-----END CERTIFICATE-----";
  assert.deepEqual(
    buildDatabaseConfig(`${internalUrl}?sslmode=require`, ca).ssl,
    { rejectUnauthorized: true, ca },
  );
});

test("Render's bare internal database hostname also requires verified TLS", () => {
  const host = "dpg-dbep0c8ae00c73ds38dg-a";
  assert.throws(() => buildDatabaseConfig(`postgresql://${host}/db`), /requires DATABASE_SSL_CA/);
});

test("remote plaintext and conflicting URL SSL parameters are refused", () => {
  assert.throws(
    () => buildDatabaseConfig("postgresql://db.example.com/app?sslmode=disable"),
    /SSL cannot be disabled/,
  );
  assert.throws(
    () => buildDatabaseConfig("postgresql://db.example.com/app?sslrootcert=%2Ftmp%2Fca.pem"),
    /sslrootcert parameter/,
  );
  assert.throws(
    () => buildDatabaseConfig("postgresql://db.example.com/app?sslmode=prefer"),
    /sslmode must be/,
  );
});

test("database errors map to availability status and log no error message", () => {
  assert.equal(databaseErrorStatus({ code: "DEPTH_ZERO_SELF_SIGNED_CERT" }), 503);
  assert.equal(databaseErrorStatus({ code: "28P01" }), 503);
  assert.equal(databaseErrorStatus({ code: "57014" }), 503);
  assert.equal(databaseErrorStatus({ code: "42P01" }), 500);

  const logged = [];
  logDatabaseError("Login", {
    code: "DEPTH_ZERO_SELF_SIGNED_CERT",
    message: "secret connection URL",
  }, { error: (...args) => logged.push(args.join(" ")) });
  assert.equal(logged.join(" "), "Login failed: DEPTH_ZERO_SELF_SIGNED_CERT");

  logged.length = 0;
  logDatabaseError("Catalogue", {
    code: "42P01",
    schema: "public",
    table: "wholesaler_profiles",
    message: "sensitive SQL details",
  }, { error: (...args) => logged.push(args.join(" ")) });
  assert.equal(
    logged.join(" "),
    "Catalogue failed: 42P01 relation=public.wholesaler_profiles",
  );
});

const test = require("node:test");
const assert = require("node:assert/strict");
const { Client } = require("pg");
const buildDatabaseConfig = require("../src/config/databaseConfig");
const {
  databaseErrorStatus,
  logDatabaseError,
} = require("../src/utils/databaseError");

test("database URL is required and malformed or non-PostgreSQL URLs are rejected safely", () => {
  assert.throws(() => buildDatabaseConfig(), /DATABASE_URL is required/);
  assert.throws(
    () => buildDatabaseConfig("not a URL containing secret"),
    /valid PostgreSQL connection URL/,
  );
  assert.throws(
    () => buildDatabaseConfig("https://example.com/db"),
    /postgres or postgresql protocol/,
  );
  assert.throws(
    () => buildDatabaseConfig("postgresql://example.com"),
    /database host and name/,
  );
});

test("local PostgreSQL defaults to no TLS but can explicitly require TLS", () => {
  const local = buildDatabaseConfig("postgresql://localhost:5432/app");
  assert.equal(local.ssl, false);
  assert.equal(Object.hasOwn(local, "options"), false);
  assert.equal(local.connectionTimeoutMillis, 5000);
  assert.equal(local.idleTimeoutMillis, 30000);
  assert.equal(local.query_timeout, 9000);
  assert.equal(local.statement_timeout, 8000);

  const localTls = buildDatabaseConfig(
    "postgresql://localhost:5432/app?sslmode=require",
  );
  assert.deepEqual(localTls.ssl, { rejectUnauthorized: true });
  assert.equal(new URL(localTls.connectionString).searchParams.has("sslmode"), false);
});

test("external PostgreSQL connections always require verified TLS", () => {
  for (const url of [
    "postgresql://db.example.com:5432/app",
    "postgresql://db.example.com:5432/app?sslmode=require",
    "postgresql://db.example.com:5432/app?sslmode=verify-full",
  ]) {
    const config = buildDatabaseConfig(url);
    assert.deepEqual(config.ssl, { rejectUnauthorized: true });
    assert.equal(new URL(config.connectionString).searchParams.has("sslmode"), false);
  }

  const ca = "-----BEGIN CERTIFICATE-----\ntrusted-ca\n-----END CERTIFICATE-----";
  assert.deepEqual(
    buildDatabaseConfig("postgresql://db.example.com/app", ca).ssl,
    { rejectUnauthorized: true, ca },
  );
});

test("Neon pooled connections do not receive a search_path startup option", () => {
  const config = buildDatabaseConfig(
    "postgresql://app-user@ep-example-pooler.neon.tech/app",
  );
  const client = new Client(config);

  assert.equal(client.connectionParameters.options, undefined);
  assert.doesNotMatch(config.connectionString, /(?:^|[?&])options=/i);
});

test("search_path in URL-encoded PostgreSQL startup options is rejected", () => {
  for (const url of [
    "postgresql://db.example.com/app?options=-c%20search_path%3Dpublic",
    "postgresql://db.example.com/app?options=--search_path%3Dpublic",
    "postgresql://db.example.com/app?options=-c%20statement_timeout%3D8000&options=-c%20search_path%3Dpublic",
  ]) {
    assert.throws(
      () => buildDatabaseConfig(url),
      /must not set search_path through the options parameter/,
    );
  }
});

test("Render internal PostgreSQL requires a trusted CA for verified TLS", () => {
  const internalUrl = "postgresql://abc.render.internal/db";
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
  assert.throws(
    () => buildDatabaseConfig(`postgresql://${host}/db`),
    /requires DATABASE_SSL_CA/,
  );
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

test("database errors log PostgreSQL diagnostic fields and map availability status", () => {
  assert.equal(databaseErrorStatus({ code: "DEPTH_ZERO_SELF_SIGNED_CERT" }), 503);
  assert.equal(databaseErrorStatus({ code: "28P01" }), 503);
  assert.equal(databaseErrorStatus({ code: "08P01" }), 503);
  assert.equal(databaseErrorStatus({ code: "57014" }), 503);
  assert.equal(databaseErrorStatus({ code: "42P01" }), 500);

  const logged = [];
  logDatabaseError("Login", {
    code: "08P01",
    message: "bind message parameter count mismatch",
    severity: "ERROR",
    routine: "exec_bind_message",
    file: "postgres.c",
    line: "1234",
    where: "unnamed portal parameter binding",
    detail: "provided parameter count differs from prepared statement",
    schema: "public",
    table: "users",
  }, { error: (...args) => logged.push(args.join(" ")) });

  const output = logged.join(" ");
  const diagnostics = JSON.parse(output.slice("Login failed: ".length));
  for (const field of [
    "code",
    "message",
    "severity",
    "routine",
    "file",
    "line",
    "where",
    "detail",
  ]) {
    assert.ok(diagnostics[field], `expected ${field} in diagnostics`);
  }
  assert.equal(diagnostics.code, "08P01");
  assert.equal(diagnostics.relation, "public.users");
});

test("database error diagnostics redact URLs, credential assignments, and bearer tokens", () => {
  const uri = [
    "postgresql",
    "://",
    "diagnostic-user",
    ":",
    "diagnostic",
    "-secret",
    "@",
    "neon.example",
    "/db",
  ].join("");
  const urlField = ["DATABASE_URL", "=", uri].join("");
  const passwordValue = ["do", "not", "log"].join("-");
  const passwordField = ["password", "=", passwordValue].join("");
  const bearer = ["Bearer", " ", "token-part", ".", "second", ".", "third"].join("");
  const email = ["private", "person", "@example.com"].join("");
  const phone = ["98765", "43210"].join("");
  const jwt = [
    "eyJ",
    "hbGciOiJIUzI1NiJ9",
    ".",
    "eyJ",
    "zdWIiOiIxMjMifQ",
    ".signature",
  ].join("");
  const logged = [];

  logDatabaseError("Login", {
    code: "08P01",
    message: `${uri} ${passwordField} ${email} ${phone}`,
    detail: `${urlField} ${bearer} ${jwt}`,
  }, { error: (...args) => logged.push(args.join(" ")) });

  const output = logged.join(" ");
  for (const secret of [uri, passwordValue, urlField, bearer, jwt, email, phone]) {
    assert.ok(!output.includes(secret));
  }
  assert.match(output, /"code":"08P01"/);
  assert.match(output, /"message":/);
  assert.match(output, /"detail":/);
});

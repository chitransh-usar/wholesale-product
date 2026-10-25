const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const Module = require("node:module");
const path = require("node:path");

const controllerPath = path.join(__dirname, "..", "src", "controllers", "authController.js");

function loadController(pool) {
  delete require.cache[controllerPath];
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent?.filename === controllerPath) {
      if (request === "../config/db") return pool;
      if (request === "../utils/gstin") return { checkGstin: () => ({ ok: true }) };
      if (request === "../services/placeOfSupply") return { asState: (state) => state || null };
      if (request === "../config/brand") return { BRAND: { name: "Test" } };
      if (request === "../services/notificationManager") {
        return {
          enqueueNotification: async () => {},
          createNotificationPreference: async () => {},
          NOTIFICATION_CHANNELS: { IN_APP: "in_app", EMAIL: "email" },
          NOTIFICATION_TYPES: { auth: "auth" },
        };
      }
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(controllerPath);
  } finally {
    Module._load = originalLoad;
  }
}

function makeResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function makeRegistrationPool({ existingUser = false, profileError } = {}) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.startsWith("SELECT id FROM users")) {
        return { rows: existingUser ? [{ id: "existing-user" }] : [] };
      }
      if (sql.startsWith("INSERT INTO users")) {
        return { rows: [{ id: "new-user", role: params[5] }] };
      }
      if (sql.startsWith("INSERT INTO wholesaler_profiles") && profileError) {
        throw profileError;
      }
      return { rows: [] };
    },
    release() {
      calls.push({ sql: "RELEASE" });
    },
  };
  return {
    calls,
    client,
    async connect() {
      return client;
    },
  };
}

test("seller registration creates user and profile in one transaction", async () => {
  const pool = makeRegistrationPool();
  const controller = loadController(pool);
  const response = makeResponse();

  await controller.register({
    body: {
      firstName: "  Asha ",
      lastName: " Patel ",
      email: " ASHA@EXAMPLE.COM ",
      phone: " 1234567890 ",
      password: "long-enough-password",
      role: "seller",
      state: "Gujarat",
    },
  }, response);

  assert.equal(response.statusCode, 201);
  assert.equal(pool.calls[0].sql, "BEGIN");
  assert.match(
    pool.calls.find((call) => call.sql.startsWith("SELECT id FROM users")).sql,
    /FROM users/,
  );
  assert.deepEqual(pool.calls.find((call) => call.sql.startsWith("INSERT INTO users")).params.slice(0, 4), [
    "Asha",
    "Patel",
    "asha@example.com",
    "1234567890",
  ]);
  assert.ok(pool.calls.some((call) => call.sql.startsWith("INSERT INTO wholesaler_profiles")));
  assert.ok(pool.calls.some((call) => call.sql === "COMMIT"));
  assert.equal(pool.calls.at(-1).sql, "RELEASE");
});

test("seller registration rolls back on profile SQL failure and returns a safe error", async () => {
  const pool = makeRegistrationPool({
    profileError: Object.assign(new Error("private connection detail"), {
      code: "42P01",
    }),
  });
  const controller = loadController(pool);
  const response = makeResponse();
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args.join(" "));

  try {
    await controller.register({
      body: {
        firstName: "Asha",
        lastName: "Patel",
        email: "asha@example.com",
        phone: "1234567890",
        password: "long-enough-password",
        role: "seller",
        state: "Gujarat",
      },
    }, response);
  } finally {
    console.error = originalError;
  }

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, { message: "Server error" });
  assert.ok(pool.calls.some((call) => call.sql === "ROLLBACK"));
  assert.ok(!pool.calls.some((call) => call.sql === "COMMIT"));
  assert.doesNotMatch(JSON.stringify(response.body) + logs.join(" "), /private connection detail/);
});

test("registration reports database outages as unavailable without exposing details", async () => {
  const controller = loadController({
    async connect() {
      throw Object.assign(new Error("private connection details"), {
        code: "ECONNREFUSED",
      });
    },
  });
  const response = makeResponse();
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args.join(" "));

  try {
    await controller.register({
      body: {
        firstName: "Asha",
        lastName: "Patel",
        email: "asha@example.com",
        phone: "1234567890",
        password: "long-enough-password",
        role: "buyer",
      },
    }, response);
  } finally {
    console.error = originalError;
  }

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { message: "Server error" });
  assert.match(logs.join(" "), /ECONNREFUSED/);
  assert.doesNotMatch(logs.join(" "), /private connection details/);
});

test("duplicate registration and malformed bodies return client errors", async () => {
  const duplicateController = loadController(makeRegistrationPool({ existingUser: true }));
  const duplicateResponse = makeResponse();
  await duplicateController.register({
    body: {
      firstName: "Asha",
      lastName: "Patel",
      email: "asha@example.com",
      phone: "1234567890",
      password: "long-enough-password",
      role: "buyer",
    },
  }, duplicateResponse);
  assert.equal(duplicateResponse.statusCode, 400);

  const malformedResponse = makeResponse();
  await duplicateController.register({ body: null }, malformedResponse);
  assert.equal(malformedResponse.statusCode, 400);

  for (const invalidInput of [
    { email: "not-an-email" },
    { phone: "123" },
    { password: "short" },
  ]) {
    const invalidPool = makeRegistrationPool();
    const invalidController = loadController(invalidPool);
    const invalidResponse = makeResponse();
    await invalidController.register({
      body: {
        firstName: "Asha",
        lastName: "Patel",
        email: "asha@example.com",
        phone: "1234567890",
        password: "long-enough-password",
        role: "buyer",
        ...invalidInput,
      },
    }, invalidResponse);
    assert.equal(invalidResponse.statusCode, 400);
    assert.equal(invalidPool.calls.length, 0);
  }
});

test("login succeeds with normalized email and returns the existing response shape", async () => {
  const passwordHash = await bcrypt.hash("a valid password", 4);
  let parameters;
  let sql;
  const pool = {
    async query(query, values) {
      sql = query;
      parameters = values;
      return {
        rows: [{
          id: "user-1",
          password_hash: passwordHash,
          role: "buyer",
          first_name: "Asha",
          last_name: "Patel",
          email: "asha@example.com",
        }],
      };
    },
  };
  const oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-only-jwt-secret";
  try {
    const controller = loadController(pool);
    const response = makeResponse();
    await controller.login({ body: { email: " ASHA@EXAMPLE.COM ", password: "a valid password" } }, response);
    assert.equal(response.statusCode, 200);
    assert.match(sql, /FROM users/);
    assert.equal(parameters[0], "asha@example.com");
    assert.equal(response.body.user.email, "asha@example.com");
    assert.ok(response.body.token);
  } finally {
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
  }
});

test("login rejects invalid credentials without identifying whether the user exists", async () => {
  const passwordHash = await bcrypt.hash("correct password", 4);
  const controller = loadController({
    async query() {
      return {
        rows: [{
          id: "user-1",
          password_hash: passwordHash,
          role: "buyer",
          first_name: "Asha",
          last_name: "Patel",
          email: "asha@example.com",
        }],
      };
    },
  });
  const response = makeResponse();
  await controller.login({ body: { email: "asha@example.com", password: "wrong password" } }, response);
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { message: "Invalid credentials" });
});

test("login reports database outages as 503 and logs only a sanitized code", async () => {
  const controller = loadController({
    async query() {
      throw Object.assign(new Error("db://user:secret@host"), { code: "28P01" });
    },
  });
  const response = makeResponse();
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args.join(" "));
  try {
    await controller.login({ body: { email: "asha@example.com", password: "password" } }, response);
  } finally {
    console.error = originalError;
  }
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { message: "Server error" });
  assert.doesNotMatch(JSON.stringify(response.body) + logs.join(" "), /secret|db:\/\//);
  assert.match(logs.join(" "), /28P01/);
});

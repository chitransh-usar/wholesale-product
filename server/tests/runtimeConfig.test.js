const test = require("node:test");
const assert = require("node:assert/strict");
const validateRuntimeConfig = require("../src/config/runtimeConfig");
const registerGracefulShutdown = require("../src/services/gracefulShutdown");

test("production CORS requires an explicit frontend origin", () => {
  const corsPath = require.resolve("../src/config/corsOrigin");
  const originalNodeEnv = process.env.NODE_ENV;
  const originalClientUrl = process.env.CLIENT_URL;

  try {
    process.env.NODE_ENV = "production";
    delete process.env.CLIENT_URL;
    delete require.cache[corsPath];
    assert.throws(() => require(corsPath), /CLIENT_URL must be configured/);

    process.env.CLIENT_URL = "https://shop.example";
    delete require.cache[corsPath];
    const corsOrigin = require(corsPath);
    let allowed;
    corsOrigin("https://shop.example", (_error, result) => {
      allowed = result;
    });
    assert.equal(allowed, true);

    corsOrigin("https://unlisted.example", (_error, result) => {
      allowed = result;
    });
    assert.equal(allowed, false);
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalClientUrl === undefined) delete process.env.CLIENT_URL;
    else process.env.CLIENT_URL = originalClientUrl;
    delete require.cache[corsPath];
  }
});

test("runtime config requires a non-empty JWT secret", () => {
  assert.throws(
    () => validateRuntimeConfig({ JWT_SECRET: "   " }),
    /JWT_SECRET must be configured/,
  );
});

test("runtime config defaults the port and accepts a valid configured port", () => {
  assert.equal(validateRuntimeConfig({ JWT_SECRET: "configured" }), 5000);
  assert.equal(
    validateRuntimeConfig({ JWT_SECRET: "configured", PORT: "8080" }),
    8080,
  );
});

test("runtime config rejects invalid ports", () => {
  for (const PORT of ["not-a-port", "0", "65536", "80.5"]) {
    assert.throws(
      () => validateRuntimeConfig({ JWT_SECRET: "configured", PORT }),
      /PORT must be an integer/,
    );
  }
});

test("runtime config preserves the warning for numeric JWT expiry values", () => {
  const warnings = [];
  const logger = { warn: (message) => warnings.push(message) };
  const port = validateRuntimeConfig(
    { JWT_SECRET: "configured", JWT_EXPIRES_IN: "86400" },
    logger,
  );

  assert.equal(port, 5000);
  assert.match(warnings[0], /86400 SECONDS/);
});

test("graceful shutdown closes Socket.IO before the pool and runs only once", async () => {
  const calls = [];
  const handlers = new Map();
  const processRef = {
    exitCode: 0,
    once: (signal, handler) => handlers.set(signal, handler),
  };
  const io = {
    close: (callback) => {
      calls.push("io.close");
      callback();
    },
  };
  const pool = {
    end: async () => calls.push("pool.end"),
  };
  const logger = { info: () => {}, error: () => {} };

  const shutdown = registerGracefulShutdown({ io, pool, processRef, logger });
  await shutdown("SIGTERM");
  await shutdown("SIGINT");

  assert.deepEqual(calls, ["io.close", "pool.end"]);
  assert.equal(handlers.size, 2);
});

test("graceful shutdown still closes the pool if Socket.IO close fails", async () => {
  const calls = [];
  const errors = [];
  const processRef = { exitCode: 0, once: () => {} };
  const io = {
    close: (callback) => callback(Object.assign(new Error("close failed"), { code: "EIO" })),
  };
  const pool = {
    end: async () => calls.push("pool.end"),
  };

  await registerGracefulShutdown({
    io,
    pool,
    processRef,
    logger: { info: () => {}, error: (message) => errors.push(message) },
  })("SIGTERM");

  assert.deepEqual(calls, ["pool.end"]);
  assert.equal(processRef.exitCode, 1);
  assert.match(errors[0], /EIO/);
});

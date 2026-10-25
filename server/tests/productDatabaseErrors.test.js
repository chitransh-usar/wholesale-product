const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

const controllerPath = path.join(
  __dirname,
  "..",
  "src",
  "controllers",
  "productController.js",
);

function loadController(pool) {
  delete require.cache[controllerPath];
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent?.filename === controllerPath) {
      if (request === "../config/db") return pool;
      if (request === "../config/features") return { FEATURES: { STOCK_TRACKING: false } };
      if (request === "../utils/money") return { clean: (value) => value, optionalNumber: Number };
      if (request === "../services/stockLedger") return {};
      if (request === "../repositories/invoiceRepository") return {};
      if (request === "../services/hsnService") {
        return { checkHsn: () => ({ ok: true }), minHsnDigits: async () => 4 };
      }
      if (request === "../middlewares/businessContext") return { businessId: () => "seller-1" };
      if (request === "../services/sellerLocation") {
        return {
          resolveCitySql: async (dbPool) => {
            await dbPool.query("SELECT column_name FROM information_schema.columns");
            return { citySql: "NULL", cityKeySql: "NULL" };
          },
          cityFilterFrom: () => null,
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

for (const [name, handlerName] of [
  ["product catalogue", "getPublicCatalog"],
  ["catalogue cities", "getCatalogCities"],
]) {
  test(`${name} reports PostgreSQL outages instead of returning successful empty data`, async () => {
    let queryCount = 0;
    const controller = loadController({
      async query() {
        queryCount += 1;
        if (queryCount === 1) return { rows: [{ column_name: "city" }] };
        throw Object.assign(new Error("database URL must not be exposed"), {
          code: "ECONNREFUSED",
        });
      },
    });
    const response = makeResponse();
    const originalError = console.error;
    const logs = [];
    console.error = (...args) => logs.push(args.join(" "));

    try {
      await controller[handlerName]({ query: {} }, response);
    } finally {
      console.error = originalError;
    }

    assert.equal(response.statusCode, 503);
    assert.equal(typeof response.body.message, "string");
    assert.doesNotMatch(JSON.stringify(response.body) + logs.join(" "), /database URL/);
    assert.match(logs.join(" "), /ECONNREFUSED/);
  });

  test(`${name} reports a missing PostgreSQL relation without leaking error details`, async () => {
    let queryCount = 0;
    const queries = [];
    const controller = loadController({
      async query(sql) {
        queryCount += 1;
        queries.push(sql);
        if (queryCount === 1) return { rows: [{ column_name: "city" }] };
        throw Object.assign(
          new Error("relation details must not be exposed"),
          {
            code: "42P01",
            schema: "public",
            table: "wholesaler_profiles",
          },
        );
      },
    });
    const response = makeResponse();
    const originalError = console.error;
    const logs = [];
    console.error = (...args) => logs.push(args.join(" "));

    try {
      await controller[handlerName]({ query: {} }, response);
    } finally {
      console.error = originalError;
    }

    assert.equal(response.statusCode, 500);
    assert.doesNotMatch(
      JSON.stringify(response.body) + logs.join(" "),
      /relation details must not be exposed/,
    );
    assert.match(logs.join(" "), /42P01/);
    assert.match(logs.join(" "), /relation=public\.wholesaler_profiles/);
    assert.match(queries[0], /information_schema\.columns/);
    assert.match(queries[1], /supplier_inventory/);
    assert.match(queries[1], /JOIN users/);
    assert.match(queries[1], /wholesaler_profiles/);
    if (handlerName === "getPublicCatalog") {
      assert.match(queries[1], /FROM products/);
    }
  });
}

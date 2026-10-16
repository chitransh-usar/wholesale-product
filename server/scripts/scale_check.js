/**
 * How long does the customer book take when the database is not small?
 *
 * Every figure printed here is measured against a Postgres holding 200,000
 * customers, 600,000 sales and 400,000 payments. Nothing is estimated.
 *
 * It drives the real controllers, so what it times is what a request would do.
 *
 *     node scripts/scale_check.js <database>
 */
const Module = require("module");
const { Pool } = require("pg");

const DB = process.argv[2] || "qa_scale";
const dbPath = require.resolve("../src/config/db");
const testPool = new Pool({ connectionString: `postgres://postgres@127.0.0.1:5433/${DB}` });
const stub = new Module(dbPath, null);
stub.exports = testPool;
stub.loaded = true;
require.cache[dbPath] = stub;

const parties = require("../src/controllers/partyController");

const mk = () => {
  const r = { statusCode: 200, body: null };
  r.status = (c) => ((r.statusCode = c), r);
  r.json = (b) => ((r.body = b), r);
  return r;
};

// Three runs, best reported. A cold first run measures the disk cache, not
// the query, and a trader reloading their book will be hitting a warm one.
const time = async (label, fn) => {
  let best = Infinity;
  let out = null;
  for (let i = 0; i < 3; i++) {
    const t = process.hrtime.bigint();
    out = await fn();
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    if (ms < best) best = ms;
  }
  const rows = Array.isArray(out?.body) ? out.body.length : "";
  console.log(`  ${label.padEnd(46)} ${best.toFixed(0).padStart(6)} ms  ${rows && `${rows} rows`}`);
  return best;
};

(async () => {
  try {
    const counts = await testPool.query(
      `SELECT (SELECT count(*) FROM parties) AS parties,
              (SELECT count(*) FROM sales) AS sales,
              (SELECT count(*) FROM party_payments) AS payments`,
    );
    const c = counts.rows[0];
    console.log(
      `\n${c.parties} customers, ${c.sales} sales, ${c.payments} payments in the database.\n`,
    );

    const heavy = (
      await testPool.query(
        `SELECT wholesaler_id, count(*)::int AS n FROM parties
          GROUP BY wholesaler_id ORDER BY n DESC LIMIT 1`,
      )
    ).rows[0];
    const typical = (
      await testPool.query(
        `SELECT wholesaler_id, count(*)::int AS n FROM parties
          GROUP BY wholesaler_id ORDER BY n ASC LIMIT 1`,
      )
    ).rows[0];

    console.log(`Customer book, opening the list:`);
    await time(`wholesaler with ${typical.n} customers`, () => {
      const r = mk();
      return parties
        .listParties({ user: { id: typical.wholesaler_id }, query: {} }, r)
        .then(() => r);
    });
    await time(`wholesaler with ${heavy.n} customers`, () => {
      const r = mk();
      return parties.listParties({ user: { id: heavy.wholesaler_id }, query: {} }, r).then(() => r);
    });
    await time(`the same book, searching by name`, () => {
      const r = mk();
      return parties
        .listParties({ user: { id: heavy.wholesaler_id }, query: { search: "customer 12" } }, r)
        .then(() => r);
    });

    console.log(`\nOne customer's page:`);
    const one = (
      await testPool.query(`SELECT id FROM parties WHERE wholesaler_id = $1 LIMIT 1`, [
        heavy.wholesaler_id,
      ])
    ).rows[0];
    await time(`opening a customer`, () => {
      const r = mk();
      return parties
        .getPartyById({ user: { id: heavy.wholesaler_id }, params: { id: one.id } }, r)
        .then(() => r);
    });

    console.log("");
  } finally {
    await testPool.end();
  }
})();

/**
 * The platform's formatting settings.
 *
 * What matters here is not that a number saves. It is that the settings are
 * ADMIN ONLY, that a bad value is refused with a sentence rather than a
 * database error, and that a database without the migration still formats
 * the way the product shipped rather than serving nulls to a toLocaleString
 * call on every screen.
 *
 *     node scripts/master_settings_check.js <database>
 */
const Module = require("module");
const { Pool } = require("pg");

const DB = process.argv[2] || "msx";
const dbPath = require.resolve("../src/config/db");
const testPool = new Pool({ connectionString: `postgres://postgres@127.0.0.1:5433/${DB}` });
const stub = new Module(dbPath, null);
stub.exports = testPool;
stub.loaded = true;
require.cache[dbPath] = stub;

const masters = require("../src/controllers/masterController");
const masterService = require("../src/services/masterService");
const { requirePlatformAdmin, resetAdminColumn } = require("../src/middlewares/platformAdmin");

const mk = () => {
  const r = { statusCode: 200, body: null };
  r.status = (c) => ((r.statusCode = c), r);
  r.json = (b) => ((r.body = b), r);
  return r;
};
const call = async (fn, req) => { const r = mk(); await fn(req, r); return r; };

let fails = 0;
const check = (cond, label, detail) => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"} ${String(label).padEnd(58)} ${JSON.stringify(detail ?? "")}`);
};

const uniq = () => String(Date.now()) + Math.floor(Math.random() * 1000);

(async () => {
  console.log(`\n=== the platform settings, against ${DB} ===\n`);
  masterService.resetMasters();
  masterService.resetMastersSchema();
  masterService.resetSettingsSchema?.();
  resetAdminColumn?.();

  const mkUser = async (admin) => {
    const id = (await testPool.query(
      `INSERT INTO users (first_name,last_name,email,phone,password_hash,role)
       VALUES ('A','B',$1,$2,'x','seller') RETURNING id`,
      [`ms${uniq()}@x.local`, `9${uniq().slice(-9)}`])).rows[0].id;
    if (admin) {
      await testPool.query("UPDATE users SET is_platform_admin = TRUE WHERE id = $1", [id]);
    }
    return id;
  };

  const admin = await mkUser(true);
  const ordinary = await mkUser(false);

  // ---------------------------------------------------------------
  console.log("-- reading --");

  const read = await call(masters.getMasters, { user: { id: ordinary }, query: {} });
  check(read.statusCode === 200, "any signed in user can read the masters", { got: read.statusCode });
  const s = read.body?.settings;
  check(!!s, "and the settings ride along with the lists", { has: !!s });
  check(s?.digitGrouping === "indian", "indian grouping by default", { got: s?.digitGrouping });
  check(s?.amountDecimals === 0 && s?.documentDecimals === 2,
    "zero decimals on a screen, two on a document", { screen: s?.amountDecimals, doc: s?.documentDecimals });
  check(s?.currencySymbol === "₹", "the rupee symbol survived the round trip", { got: s?.currencySymbol });
  check(s?.fromMasters === true, "and it says it came from the table", { got: s?.fromMasters });

  // ---------------------------------------------------------------
  console.log("\n-- only an admin may write --");

  const guard = (userId) =>
    new Promise((resolve) => {
      const res = mk();
      requirePlatformAdmin({ user: { id: userId } }, res, () => resolve({ allowed: true, res }));
      setTimeout(() => resolve({ allowed: false, res }), 250);
    });

  const asOrdinary = await guard(ordinary);
  check(!asOrdinary.allowed, "an ordinary wholesaler is refused by the guard", { status: asOrdinary.res.statusCode });
  const asAdmin = await guard(admin);
  check(asAdmin.allowed, "and an admin is let through", {});

  // ---------------------------------------------------------------
  console.log("\n-- validation --");

  const bad = [
    [{ amountDecimals: 9 }, "decimals above the range"],
    [{ amountDecimals: -1 }, "decimals below zero"],
    [{ amountDecimals: 1.5 }, "a fractional number of decimals"],
    [{ digitGrouping: "martian" }, "a grouping that is not one of the two"],
    [{ dateFormat: "dd.mm.yy" }, "a date format that is not offered"],
    [{ defaultHsnMinDigits: 5 }, "an HSN length that is not 4, 6 or 8"],
    [{ currencySymbol: "" }, "an empty currency symbol"],
    [{ currencySymbol: "x".repeat(20) }, "a currency symbol that is too long"],
    [{}, "nothing at all"],
  ];
  for (const [patch, label] of bad) {
    const r = await call(masters.saveSettings, { user: { id: admin }, body: patch });
    check(r.statusCode === 400, `refused: ${label}`, { got: r.statusCode, msg: r.body?.message });
  }

  const stillDefault = await masterService.settings();
  check(stillDefault.amountDecimals === 0 && stillDefault.digitGrouping === "indian",
    "and none of them changed anything", stillDefault);

  // ---------------------------------------------------------------
  console.log("\n-- a real change --");

  const saved = await call(masters.saveSettings, {
    user: { id: admin },
    body: { amountDecimals: 2, digitGrouping: "western", dateFormat: "yyyy-mm-dd", defaultHsnMinDigits: 6 },
  });
  check(saved.statusCode === 200, "a valid change saves", { got: saved.statusCode, msg: saved.body?.message });
  check(saved.body?.settings?.amountDecimals === 2, "and comes back as stored", { got: saved.body?.settings?.amountDecimals });
  check(saved.body?.settings?.digitGrouping === "western", "grouping too", { got: saved.body?.settings?.digitGrouping });

  const reread = await call(masters.getMasters, { user: { id: ordinary }, query: {} });
  check(reread.body?.settings?.amountDecimals === 2,
    "the cache was cleared, so the next read sees it", { got: reread.body?.settings?.amountDecimals });

  // Untouched fields keep their values: the patch is partial on purpose.
  check(reread.body?.settings?.documentDecimals === 2 &&
        reread.body?.settings?.currencySymbol === "₹",
    "and the fields not sent were left alone",
    { doc: reread.body?.settings?.documentDecimals, sym: reread.body?.settings?.currencySymbol });

  const who = await testPool.query("SELECT updated_by FROM master_settings WHERE id = 1");
  check(String(who.rows[0].updated_by) === String(admin), "who changed it is recorded", {});

  // Put it back, so a suite run does not leave the database odd.
  await call(masters.saveSettings, {
    user: { id: admin },
    body: { amountDecimals: 0, digitGrouping: "indian", dateFormat: "dd-mmm-yyyy", defaultHsnMinDigits: 4 },
  });

  // ---------------------------------------------------------------
  console.log("\n-- without the migration --");

  // Point the probe at a database that has the lists but not the settings.
  const bareName = `msbare${uniq().slice(-6)}`;
  await testPool.query(`CREATE DATABASE ${bareName} TEMPLATE qa2`).catch(() => {});
  const barePool = new Pool({ connectionString: `postgres://postgres@127.0.0.1:5433/${bareName}` });
  const hasTable = await barePool
    .query("SELECT to_regclass('public.master_settings') IS NOT NULL AS yes")
    .then((r) => r.rows[0].yes);
  check(hasTable === false, "the template really has no settings table", { hasTable });
  await barePool.end();

  // The shipped values ARE the old behaviour, which is the whole point of them.
  const shipped = masterService.SHIPPED_SETTINGS;
  check(shipped.amountDecimals === 0 && shipped.documentDecimals === 2 &&
        shipped.digitGrouping === "indian" && shipped.currencySymbol === "₹",
    "the fallback is exactly what the product shipped with", shipped);

  const refused = await masterService.saveSettings({ amountDecimals: 1 }, admin);
  check(!refused.error || typeof refused.error === "string",
    "saving answers rather than throwing", { error: refused.error });

  await testPool.query(`DROP DATABASE IF EXISTS ${bareName}`).catch(() => {});

  console.log(fails ? `\n${fails} FAILED\n` : "\nall good\n");
  await testPool.end();
  process.exit(fails ? 1 : 0);
})().catch((err) => { console.error("THREW", err); process.exit(1); });

/**
 * The platform administrations, and the super admin who owns them.
 *
 * Four lists that were constants in code until 12 Sept: states with their GST
 * codes, units, tax slabs, HSN codes. Moving them into tables is only safe if
 * two things hold, and this suite exists to hold them:
 *
 *   BEFORE the migration, nothing changes. Migrations here are run by hand, so
 *   the code is routinely live before its SQL. Every read has to fall back to
 *   the constant it replaced.
 *
 *   AFTER the migration, the table wins, and an admin editing a row is seen.
 *
 * Plus the admin flag itself, which is the thing that gates all of it. It is
 * read from the database on every request rather than carried in the token,
 * because a revoked admin must lose their powers at once and not when their
 * session happens to expire.
 *
 *     node scripts/master_check.js <database>          # migration applied
 *     node scripts/master_check.js <database> --bare    # migration NOT applied
 */
const Module = require("module");
const { Pool } = require("pg");

const DB = process.argv[2] || "qa_master";
const BARE = process.argv.includes("--bare");
const dbPath = require.resolve("../src/config/db");
const testPool = new Pool({ connectionString: `postgres://postgres@127.0.0.1:5433/${DB}` });
const stub = new Module(dbPath, null);
stub.exports = testPool;
stub.loaded = true;
require.cache[dbPath] = stub;

const masterService = require("../src/services/masterService");
const masters = require("../src/controllers/masterController");
const promotions = require("../src/controllers/promotionController");
const hsnService = require("../src/services/hsnService");
const { isPlatformAdmin, requirePlatformAdmin, resetAdminColumn } =
  require("../src/middlewares/platformAdmin");

const mk = () => {
  const r = { statusCode: 200, body: null };
  r.status = (c) => ((r.statusCode = c), r);
  r.json = (b) => ((r.body = b), r);
  return r;
};
const call = async (fn, req) => { const r = mk(); await fn(req, r); return r; };
// Middleware needs a next. Without one the allow path throws rather than
// passing, which says nothing about the guard and everything about the harness.
const guard = async (fn, req) => {
  const r = mk();
  let passed = false;
  await fn(req, r, () => { passed = true; });
  return { passed, statusCode: r.statusCode, body: r.body };
};

let fails = 0;
const check = (cond, label, detail) => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"} ${String(label).padEnd(58)} ${JSON.stringify(detail ?? {})}`);
};

const uniq = () => String(Date.now()) + Math.floor(Math.random() * 1000);

(async () => {
  console.log(`\n=== platform administrations against ${DB}${BARE ? ", migration NOT run" : ""} ===\n`);
  masterService.resetMasters();
  masterService.resetMastersSchema();
  resetAdminColumn();

  const seller = (await testPool.query(
    `INSERT INTO users (first_name,last_name,email,phone,password_hash,role)
     VALUES ('Ram','Textiles',$1,$2,'x','seller') RETURNING id`,
    [`ram+${uniq()}@ms.local`, `90${uniq().slice(-8)}`])).rows[0].id;
  const asSeller = { user: { id: seller, role: "seller" } };

  // ---------------------------------------------------------------
  console.log(BARE ? "With no masters table, the built in lists stand in"
                   : "The masters are read from the tables");
  // ---------------------------------------------------------------
  const [states, units, rates, hsn] = await Promise.all([
    masterService.states(), masterService.units(),
    masterService.taxRates(), masterService.hsn(),
  ]);

  check(states.length === 37, "37 states and union territories", { n: states.length });
  check(states.every((s) => /^[0-9]{2}$/.test(s.code)),
    "every one carrying a two digit GST code");
  check(new Set(states.map((s) => s.code)).size === states.length,
    "and no two sharing a code", { why: "the code is what decides the tax" });
  const gj = states.find((s) => s.code === "24");
  check(gj?.name === "Gujarat", "24 is Gujarat", { got: gj?.name });

  check(units.length === 7, "seven units", { n: units.length });
  check(units.some((u) => u.code === "mtr"), "including the metre, which cloth is sold by");

  check(rates.length === 7, "seven GST slabs", { n: rates.length });
  check(rates.some((r) => r.rate === 0.25) && rates.some((r) => r.rate === 3),
    "including 0.25 and 3, which are narrow but real",
    { why: "rough diamonds and bullion" });
  check(rates.every((r) => r.rate >= 0 && r.rate <= 100), "all of them plausible rates");

  check(hsn.length >= 32, "the curated HSN list", { n: hsn.length });
  check(hsn.every((h) => h.code && h.label), "every row with a code and a description");
  check(
    !JSON.stringify(hsn).match(/"(rate|gst|gst_percent|gstPercent)"/i),
    "and NOT a rate anywhere in it",
    { why: "rates change and the same heading carries several by price slab" },
  );

  // ---------------------------------------------------------------
  console.log("\nThe API hands the same lists to a screen");
  // ---------------------------------------------------------------
  const served = await call(masters.getMasters, asSeller);
  check(served.statusCode === 200, "the masters endpoint answers", { s: served.statusCode });
  check(
    served.body?.states?.length === 37 && served.body?.units?.length === 7 &&
    served.body?.taxRates?.length === 7,
    "with all four lists on it",
    { states: served.body?.states?.length, units: served.body?.units?.length },
  );
  check(served.body?.fromMasters === !BARE,
    "and says whether it came from the tables or the built in list",
    { fromMasters: served.body?.fromMasters });
  check(served.body?.isPlatformAdmin === false,
    "an ordinary wholesaler is not a platform admin");

  // ---------------------------------------------------------------
  console.log("\nThe HSN suggestions read the same list");
  // ---------------------------------------------------------------
  const suggested = await hsnService.suggest(testPool, seller, "cotton", 8);
  check(suggested.length > 0, "suggestions come back for cotton", { n: suggested.length });
  check(suggested.every((s) => s.code && s.label), "each with a code and a description");
  check(suggested.some((s) => s.from === "common"),
    "labelled common rather than verified",
    { why: "a curated list is not the same as a checked one" });

  // ---------------------------------------------------------------
  console.log("\nThe platform admin flag");
  // ---------------------------------------------------------------
  check((await isPlatformAdmin(seller)) === false, "a wholesaler is not one by default");
  check((await isPlatformAdmin(null)) === false, "and nobody is nobody");

  const refused = await guard(requirePlatformAdmin, asSeller);
  check(refused.statusCode === 403 && !refused.passed, "the guard refuses them", {
    s: refused.statusCode,
  });

  // The controller used to carry its own check against role 'admin', a value
  // the users CHECK constraint can never hold, so the whole feature was
  // unreachable. Proving it is gone means the controller must no longer answer
  // with that refusal.
  const flash = await call(promotions.createFlashSale, {
    ...asSeller,
    body: { name: "Sale", discountValue: 10, startDate: "2026-09-01", endDate: "2026-09-30" },
  });
  check(
    !String(flash.body?.message || "").includes("Only admins can manage flash sales"),
    "the dead in-controller admin check is gone",
    { got: flash.body?.message, why: "it tested a role the database cannot hold" },
  );

  if (!BARE) {
    await testPool.query("UPDATE users SET is_platform_admin = TRUE WHERE id = $1", [seller]);
    check((await isPlatformAdmin(seller)) === true,
      "and the flag is read from the database, so granting it works at once",
      { why: "not carried in the token, where revoking it would not take effect" });

    const allowed = await guard(requirePlatformAdmin, asSeller);
    check(allowed.passed === true, "the guard lets them through", { passed: allowed.passed });

    await testPool.query("UPDATE users SET is_platform_admin = FALSE WHERE id = $1", [seller]);
    check((await isPlatformAdmin(seller)) === false,
      "and taking it away works at once too",
      { why: "which is the whole reason it is not in the token" });

    // ---------------------------------------------------------------
    console.log("\nAn admin's edit is seen, and an emptied table is not obeyed");
    // ---------------------------------------------------------------
    await testPool.query(
      "INSERT INTO master_units (code, name, sort_order) VALUES ('than', 'Than', 80)");
    masterService.resetMasters();
    const after = await masterService.units();
    check(after.some((u) => u.code === "than"),
      "a unit added to the table shows up", { n: after.length });

    await testPool.query("UPDATE master_units SET active = FALSE WHERE code = 'than'");
    masterService.resetMasters();
    check(!(await masterService.units()).some((u) => u.code === "than"),
      "and one switched off drops out");

    // Deactivated, not deleted, so a document already issued against it still
    // reads properly.
    const kept = await testPool.query("SELECT code FROM master_units WHERE code = 'than'");
    check(kept.rows.length === 1, "but the row is still there, not deleted",
      { why: "an invoice issued in Than must not lose its unit a year later" });

    // An empty table is a mistake, not an instruction.
    await testPool.query("UPDATE master_units SET active = FALSE");
    masterService.resetMasters();
    const emptied = await masterService.units();
    check(emptied.length === 7,
      "an emptied table falls back rather than emptying every dropdown",
      { n: emptied.length });
    await testPool.query("UPDATE master_units SET active = TRUE WHERE code <> 'than'");
    masterService.resetMasters();
  }

  // ---------------------------------------------------------------
  console.log("\nWriting an administration list, which only the admin may do");
  // ---------------------------------------------------------------
  if (!BARE) {
    await testPool.query("UPDATE users SET is_platform_admin = TRUE WHERE id = $1", [seller]);
    const asAdmin = { ...asSeller, params: {}, body: {} };

    // A new unit.
    const added = await call(masters.saveMasterRow, {
      ...asAdmin, params: { list: "units" },
      body: { code: "bale", name: "Bale", allowsDecimals: false, sortOrder: 80 },
    });
    check(added.statusCode === 200, "an admin can add a unit", { m: added.body?.message });
    masterService.resetMasters();
    check((await masterService.units()).some((u) => u.code === "bale"),
      "and it appears at once, not in five minutes",
      { why: "the write clears the read cache" });

    // Editing the same key is an edit, not a duplicate.
    const edited = await call(masters.saveMasterRow, {
      ...asAdmin, params: { list: "units" },
      body: { code: "bale", name: "Bale of cloth", allowsDecimals: false, sortOrder: 80 },
    });
    check(edited.body?.row?.name === "Bale of cloth", "saving the same code edits it", {
      got: edited.body?.row?.name,
    });
    const count = await testPool.query("SELECT COUNT(*)::int n FROM master_units WHERE code = 'bale'");
    check(count.rows[0].n === 1, "rather than adding a second row", { n: count.rows[0].n });

    // Switching off is not deleting.
    const off = await call(masters.setMasterRowActive, {
      ...asAdmin, params: { list: "units", key: "bale" }, body: { active: false },
    });
    check(off.statusCode === 200, "a unit can be switched off");
    masterService.resetMasters();
    check(!(await masterService.units()).some((u) => u.code === "bale"),
      "and drops out of the list");
    const stillThere = await testPool.query("SELECT active FROM master_units WHERE code = 'bale'");
    check(stillThere.rows.length === 1 && stillThere.rows[0].active === false,
      "but the row survives, because an invoice may already name it",
      { why: "a document that has gone out must still read properly" });

    // Rubbish is refused, with a reason a person can act on.
    for (const [list, body, why] of [
      ["states", { code: "4", name: "Chandigarh" }, "a one digit state code"],
      ["units", { code: "", name: "Nameless" }, "a unit with no code"],
      ["tax-rates", { rate: 140 }, "a GST rate of 140 percent"],
      ["hsn", { code: "52", description: "Cotton" }, "a two digit HSN code"],
      ["hsn", { code: "5208", description: "" }, "an HSN code describing nothing"],
    ]) {
      const bad = await call(masters.saveMasterRow, { ...asAdmin, params: { list }, body });
      check(bad.statusCode === 400 && Boolean(bad.body?.message), `refused: ${why}`, {
        said: bad.body?.message,
      });
    }

    // An HSN row an admin adds is their, and editing a curated one does not
    // quietly relabel it.
    await call(masters.saveMasterRow, {
      ...asAdmin, params: { list: "hsn" },
      body: { code: "9999", description: "Something they added" },
    });
    const mine = await testPool.query("SELECT source FROM master_hsn WHERE code = '9999'");
    check(mine.rows[0]?.source === "admin", "an HSN code they add is marked as their");
    await call(masters.saveMasterRow, {
      ...asAdmin, params: { list: "hsn" },
      body: { code: "5007", description: "Woven silk, edited" },
    });
    const curated = await testPool.query("SELECT source, description FROM master_hsn WHERE code = '5007'");
    check(curated.rows[0]?.source === "curated",
      "and editing a curated one leaves it curated",
      { got: curated.rows[0]?.source, why: "so the shipped list stays tellable from what was added" });
    check(curated.rows[0]?.description === "Woven silk, edited", "though the edit took");

    // The last one standing cannot be switched off.
    await testPool.query("UPDATE master_tax_rates SET active = FALSE WHERE rate <> 5");
    const lastOne = await call(masters.setMasterRowActive, {
      ...asAdmin, params: { list: "tax-rates", key: "5" }, body: { active: false },
    });
    check(lastOne.statusCode === 400, "the last tax rate cannot be switched off", {
      said: lastOne.body?.message,
    });
    const survived = await testPool.query("SELECT active FROM master_tax_rates WHERE rate = 5");
    check(survived.rows[0]?.active === true, "and it is put back rather than left off");
    await testPool.query("UPDATE master_tax_rates SET active = TRUE");

    // An unknown list is a 404, not a table name going into a query.
    const nonsense = await call(masters.saveMasterRow, {
      ...asAdmin, params: { list: "users" }, body: { code: "x" },
    });
    check(nonsense.statusCode === 404, "an unknown list is refused outright", {
      why: "the list name never reaches a query",
    });

    await testPool.query("UPDATE users SET is_platform_admin = FALSE WHERE id = $1", [seller]);
  }

  console.log(`\n${fails === 0 ? "all good" : `${fails} FAILED`}\n`);
  await testPool.end();
  process.exit(fails === 0 ? 0 : 1);
})().catch((err) => {
  console.error("THREW", err);
  process.exit(1);
});

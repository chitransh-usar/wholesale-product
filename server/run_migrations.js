const fs = require("fs");
const path = require("path");
const pool = require("./src/config/db");

/**
 * Applies every .sql file in migrations/ against DATABASE_URL.
 *
 * Ordering is the whole problem here. The files are named by subject, not by
 * sequence, so alphabetical order puts wholesale3_credit_notes.sql ahead of
 * the file that creates the tables it points at. That fails with "relation
 * sales does not exist", which is loud and harmless, but it also means a
 * single pass can leave a database half migrated and a person wondering
 * whether it worked.
 *
 * Rather than encode a dependency order that would go stale the moment
 * somebody adds a file, this makes passes until nothing new succeeds. Every
 * migration in this directory is written to be safe to run twice, which is
 * what makes that legitimate: a file that failed only because its dependency
 * had not run yet will succeed on the next pass, and a file that already
 * applied is a no op.
 *
 * A file that fails for a real reason fails on every pass, and is reported at
 * the end with its error rather than buried in the middle of the log.
 *
 * Notices are printed. A migration that has to make a judgement, such as
 * whether a column is safe to drop, says so with RAISE NOTICE, and running
 * through pool.query threw all of that away: the run said "34 of 34 applied"
 * and the one thing the operator needed to read had gone. They arrive as an
 * event on the connection rather than in the result, which is why this holds a
 * single client instead of borrowing one per statement.
 */
async function run() {
  const dir = path.join(__dirname, "migrations");
  const all = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // z_fix_order_payment_status_constraint.sql is named to sort last on
  // purpose: it re-applies a CHECK constraint that earlier files drop. Keep
  // it last on every pass.
  let pending = all;
  const applied = [];
  let failures = new Map();

  const client = await pool.connect();

  /**
   * The baseline builds an empty database. It is not a migration.
   *
   * 000_baseline.sql is a snapshot of the live schema taken on one day, and a
   * later migration is free to drop something it describes. Once that happens
   * the snapshot can no longer be replayed: the drop takes the constraints on
   * that column with it, the baseline tries to add them back, and the run ends
   * with "column credit_status does not exist" on a database that is in fact
   * perfectly up to date.
   *
   * So it runs only when there is nothing there to migrate. On a database that
   * already has tables it is skipped, which is the honest reading of what it
   * is for.
   */
  const populated = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM pg_tables WHERE schemaname = 'public'
     ) AS any_tables`,
  );
  const isBaseline = (file) => /^000[_-]/.test(file);
  const skipped = populated.rows[0].any_tables ? pending.filter(isBaseline) : [];
  if (skipped.length > 0) {
    pending = pending.filter((f) => !isBaseline(f));
    for (const file of skipped) {
      console.log(`  skipped  ${file}`);
      console.log("           the database already has tables, so there is nothing to build");
    }
  }
  // Filled by the notice listener while a file runs, drained after it.
  let notices = [];
  client.on("notice", (n) => {
    // "Already exists, skipping" and "does not exist, skipping" are the sound
    // of an idempotent migration doing its job on a database that has seen it
    // before. Printing every one buries the messages a person has to read.
    //
    // Filtered by message, not by code, because DROP ... IF EXISTS reports
    // itself as 00000, successful completion, which is also what a migration's
    // own RAISE NOTICE comes back as. The code cannot tell them apart.
    if (n.severity !== "NOTICE") return;
    if (/(already exists|does not exist), skipping$/.test(n.message || "")) return;
    notices.push(n.message);
  });

  for (let pass = 1; pending.length > 0 && pass <= 5; pass++) {
    const stillPending = [];
    failures = new Map();

    for (const file of pending) {
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      notices = [];
      try {
        await client.query(sql);
        applied.push(file);
        console.log(`  applied  ${file}`);
      } catch (err) {
        stillPending.push(file);
        failures.set(file, err.message);
      }
      for (const message of notices) {
        console.log(`           ${message}`);
      }
    }

    if (stillPending.length === pending.length) {
      // Nothing moved, so another pass will not help either.
      break;
    }
    if (stillPending.length > 0) {
      console.log(
        `  ${stillPending.length} file(s) not ready on pass ${pass}, retrying`,
      );
    }
    pending = stillPending;
  }

  client.release();
  await pool.end();

  console.log(
    `\n${applied.length} of ${all.length - skipped.length} migrations applied` +
      (skipped.length > 0 ? `, ${skipped.length} skipped.` : "."),
  );
  if (failures.size > 0) {
    console.error("\nStill failing:");
    for (const [file, message] of failures) {
      console.error(`  ${file}\n    ${message}`);
    }
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Migration run failed:", err.message);
  process.exit(1);
});

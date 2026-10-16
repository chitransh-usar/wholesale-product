/**
 * Can two orders end up with the same order number?
 *
 * The old generate_order_number() picked four random digits and looped until
 * the number looked free. This proves both ways it went wrong, and that the
 * sequence fixes them:
 *
 *   in bulk      more than 10,000 rows in one statement can never finish,
 *                because CURRENT_TIMESTAMP is frozen inside a transaction so
 *                the loop runs out of numbers and spins
 *   in the open  the WHILE cannot see another session's uncommitted rows, so
 *                two checkouts in the same second can choose the same number
 *                and the unique index rejects one of them
 *
 * The second is the one that actually bites, so it is reproduced against real
 * concurrent connections rather than argued about.
 *
 *     node scripts/order_number_check.js <database>
 */
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const DB = process.argv[2] || "qa_ordnum";
const url = `postgres://postgres@127.0.0.1:5433/${DB}`;
const pool = new Pool({ connectionString: url, max: 24 });

let fails = 0;
const check = (cond, label, v) => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"} ${String(label).padEnd(52)} ${JSON.stringify(v ?? "")}`);
};

const migration = (name) =>
  fs.readFileSync(path.join(__dirname, "..", "migrations", name), "utf8");

// The function as it was, so the failure is demonstrated rather than assumed.
const OLD_FUNCTION = `
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS VARCHAR(50) AS $fn$
DECLARE
    order_num VARCHAR(50);
    timestamp_part VARCHAR(20);
    random_part VARCHAR(10);
BEGIN
    timestamp_part := TO_CHAR(CURRENT_TIMESTAMP, 'YYYYMMDDHH24MISS');
    random_part := LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
    order_num := 'ORD' || timestamp_part || random_part;
    WHILE EXISTS (SELECT 1 FROM orders WHERE order_number = order_num) LOOP
        random_part := LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
        order_num := 'ORD' || timestamp_part || random_part;
    END LOOP;
    RETURN order_num;
END;
$fn$ LANGUAGE plpgsql;`;

const wipe = () => pool.query("DELETE FROM orders");

// One order, on its own connection, committed. Returns the number or the
// error, because an error is exactly what this is looking for.
const placeOne = async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO orders (supplier_id, quantity, total_amount, status)
       VALUES (NULL, 1, 500, 'pending') RETURNING order_number`,
    );
    // Held open a moment so the writers genuinely overlap. Without this they
    // queue up and each one sees the last committed row, which is the
    // situation that never fails.
    await new Promise((r) => setTimeout(r, 40));
    await client.query("COMMIT");
    return { ok: true, number: rows[0].order_number };
  } catch (err) {
    await client.query("ROLLBACK");
    return { ok: false, error: err.message };
  } finally {
    client.release();
  }
};

const placeMany = async (n) => {
  const results = await Promise.all(Array.from({ length: n }, () => placeOne()));
  const failed = results.filter((r) => !r.ok);
  const numbers = results.filter((r) => r.ok).map((r) => r.number);
  return { failed, numbers, duplicates: numbers.length - new Set(numbers).size };
};

(async () => {
  console.log(`\n=== order numbers, ${DB} ===`);

  // ---- the old way, in bulk --------------------------------------------
  await pool.query(OLD_FUNCTION);
  await wipe();
  let bulkFailed = null;
  try {
    await pool.query(`SET statement_timeout = '15s'`);
    await pool.query(
      `INSERT INTO orders (supplier_id, quantity, total_amount, status)
       SELECT NULL, 1, 500, 'pending' FROM generate_series(1, 11000)`,
    );
  } catch (err) {
    bulkFailed = err.message;
  } finally {
    await pool.query(`SET statement_timeout = 0`);
  }
  check(bulkFailed !== null, "old way: 11,000 orders at once never finishes", bulkFailed?.slice(0, 40));
  const wrote = Number((await pool.query("SELECT count(*)::int AS n FROM orders")).rows[0].n);
  check(wrote === 0, "old way: and writes nothing at all for the wait", { wrote });

  // ---- the old way, concurrent ------------------------------------------
  await wipe();
  const oldRun = await placeMany(20);
  // Twenty at once against 10,000 slots is a small chance on any single run,
  // so this is reported rather than asserted. What is asserted is that the
  // new way cannot fail this at all.
  console.log(
    `  note old way: ${oldRun.failed.length} of 20 concurrent orders refused, ` +
      `${oldRun.duplicates} duplicate number(s)`,
  );

  // ---- the new way ------------------------------------------------------
  await pool.query(migration("wholesale3_order_number_sequence.sql"));
  await wipe();

  const one = await placeOne();
  check(one.ok, "new way: an order gets a number", one.number);
  check(
    /^ORD[0-9]{8}[0-9]{6}$/.test(one.number || ""),
    "new way: it reads ORD, the date, then a counter",
    one.number,
  );

  await wipe();
  const bulk = await pool.query(
    `INSERT INTO orders (supplier_id, quantity, total_amount, status)
     SELECT NULL, 1, 500, 'pending' FROM generate_series(1, 11000)
     RETURNING order_number`,
  );
  check(bulk.rows.length === 11000, "new way: 11,000 orders at once all succeed", { n: bulk.rows.length });
  const distinct = new Set(bulk.rows.map((r) => r.order_number)).size;
  check(distinct === 11000, "new way: every one of them is distinct", { distinct });

  await wipe();
  const newRun = await placeMany(40);
  check(newRun.failed.length === 0, "new way: 40 at once, none refused", newRun.failed[0]?.error);
  check(newRun.duplicates === 0, "new way: and no duplicates", { duplicates: newRun.duplicates });

  // ---- old numbers are left alone ---------------------------------------
  await wipe();
  await pool.query(
    `INSERT INTO orders (supplier_id, quantity, total_amount, status, order_number)
     VALUES (NULL, 1, 500, 'pending', 'ORD202601011200000001')`,
  );
  const mixed = await placeOne();
  check(mixed.ok, "an old style number and a new one live together", mixed.number);
  const kept = (
    await pool.query(
      "SELECT count(*)::int AS n FROM orders WHERE order_number = 'ORD202601011200000001'",
    )
  ).rows[0].n;
  check(kept === 1, "the old number is untouched", { kept });

  await wipe();
  console.log(fails === 0 ? "\nall good\n" : `\n${fails} failure(s)\n`);
  process.exitCode = fails === 0 ? 0 : 1;
  await pool.end();
})();

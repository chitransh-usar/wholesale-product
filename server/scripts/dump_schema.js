/**
 * Write a schema baseline from the live database, using nothing but node.
 *
 * pg_dump does this better, but it is a Postgres client tool and a Windows
 * machine with only node installed does not have it. This asks the database
 * to describe itself instead, which every Postgres already knows how to do.
 *
 *     node scripts/dump_schema.js
 *
 * Writes migrations/000_baseline.sql from DATABASE_URL in your .env.
 *
 * What comes out: tables, columns, types, defaults, constraints, indexes,
 * sequences and views. Structure only. No rows, so no customers, no orders
 * and no invoices leave the database, and nothing about your Neon account
 * goes into the file either.
 *
 * What it is for: building a real copy of the schema locally so that
 * checkout, invoicing and migrations can be tested against the shape the
 * live database actually has, rather than against one assembled from memory.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

const OUT = path.join(__dirname, "..", "migrations", "000_baseline.sql");

const q = async (sql, args = []) => (await pool.query(sql, args)).rows;

(async () => {
  const out = [];
  const say = (line = "") => out.push(line);

  try {
    const [{ version }] = await q("SELECT version()");
    say("-- Schema baseline. Generated, do not edit by hand.");
    say("--     node scripts/dump_schema.js");
    say("--");
    say("-- Structure only: no rows were read. This exists so the schema can");
    say("-- be rebuilt locally and migrations tested before they touch the");
    say("-- live database.");
    say(`--`);
    say(`-- Source: ${version.split(" on ")[0]}`);
    say(`-- Taken:  ${new Date().toISOString().slice(0, 10)}`);
    say();

    const extensions = await q(
      `SELECT extname FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY extname`,
    );
    for (const e of extensions) {
      say(`CREATE EXTENSION IF NOT EXISTS "${e.extname}";`);
    }
    if (extensions.length) say();

    // Every sequence, including the ones behind a serial column. Those look
    // owned and skippable, but the column's default calls nextval on them, so
    // leaving them out makes the table fail to create.
    const sequences = await q(
      `SELECT c.relname
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind = 'S' AND n.nspname = 'public'
       ORDER BY c.relname`,
    );
    for (const s of sequences) {
      say(`CREATE SEQUENCE IF NOT EXISTS ${s.relname};`);
    }
    if (sequences.length) say();

    const tables = await q(
      `SELECT c.relname AS name
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind = 'r' AND n.nspname = 'public'
       ORDER BY c.relname`,
    );

    say(`-- ${tables.length} table(s)`);
    say();

    for (const t of tables) {
      const cols = await q(
        `SELECT a.attname AS name,
                format_type(a.atttypid, a.atttypmod) AS type,
                a.attnotnull AS not_null,
                pg_get_expr(d.adbin, d.adrelid) AS default_expr
         FROM pg_attribute a
         LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
         WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
         ORDER BY a.attnum`,
        [`public.${t.name}`],
      );

      const body = cols.map((c) => {
        let line = `    ${c.name} ${c.type}`;
        if (c.default_expr) line += ` DEFAULT ${c.default_expr}`;
        if (c.not_null) line += " NOT NULL";
        return line;
      });

      say(`CREATE TABLE IF NOT EXISTS ${t.name} (`);
      say(body.join(",\n"));
      say(");");
      say();
    }

    // Hand each serial sequence back to its column, so dropping the table
    // takes the sequence with it instead of leaving it behind.
    const owned = await q(
      `SELECT s.relname AS sequence_name, t.relname AS table_name, a.attname AS column_name
       FROM pg_class s
       JOIN pg_depend d ON d.objid = s.oid AND d.deptype = 'a'
       JOIN pg_class t ON t.oid = d.refobjid
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
       JOIN pg_namespace n ON n.oid = s.relnamespace
       WHERE s.relkind = 'S' AND n.nspname = 'public'
       ORDER BY s.relname`,
    );
    for (const o of owned) {
      say(`ALTER SEQUENCE ${o.sequence_name} OWNED BY ${o.table_name}.${o.column_name};`);
    }
    if (owned.length) say();

    // Constraints come after every table exists, so a foreign key never
    // points at something not yet created. Primary keys first: a foreign key
    // cannot reference a table without one.
    say("-- Constraints");
    say();
    for (const kind of ["p", "u", "f", "c"]) {
      const constraints = await q(
        `SELECT rel.relname AS table_name,
                con.conname AS name,
                pg_get_constraintdef(con.oid) AS definition
         FROM pg_constraint con
         JOIN pg_class rel ON rel.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = rel.relnamespace
         WHERE n.nspname = 'public' AND con.contype = $1
         ORDER BY rel.relname, con.conname`,
        [kind],
      );
      for (const c of constraints) {
        // ALTER TABLE ADD CONSTRAINT has no IF NOT EXISTS, and running it
        // twice is an error rather than a no-op. Asking first is better than
        // catching: the errors differ by constraint type, and a second
        // primary key raises something an exception list would miss.
        say(`DO $$ BEGIN`);
        say(`    IF NOT EXISTS (SELECT 1 FROM pg_constraint`);
        say(`                   WHERE conname = '${c.name}'`);
        say(`                     AND connamespace = 'public'::regnamespace) THEN`);
        say(`        ALTER TABLE ${c.table_name} ADD CONSTRAINT ${c.name} ${c.definition};`);
        say(`    END IF;`);
        say(`END $$;`);
      }
      if (constraints.length) say();
    }

    // Indexes that a constraint already created are skipped: the constraint
    // above brought them with it.
    const indexes = await q(
      `SELECT indexdef
       FROM pg_indexes i
       WHERE schemaname = 'public'
         AND NOT EXISTS (
           SELECT 1 FROM pg_constraint con
           WHERE con.conname = i.indexname
             AND con.connamespace = 'public'::regnamespace
         )
       ORDER BY tablename, indexname`,
    );
    if (indexes.length) {
      say("-- Indexes");
      say();
      for (const i of indexes) {
        say(`${i.indexdef.replace(/^CREATE (UNIQUE )?INDEX /, "CREATE $1INDEX IF NOT EXISTS ")};`);
      }
      say();
    }

    const views = await q(
      `SELECT viewname, definition FROM pg_views
       WHERE schemaname = 'public' ORDER BY viewname`,
    );
    if (views.length) {
      say("-- Views");
      say();
      for (const v of views) {
        say(`CREATE OR REPLACE VIEW ${v.viewname} AS`);
        say(v.definition.trim());
        say();
      }
    }

    fs.writeFileSync(OUT, out.join("\n") + "\n", "utf8");
    console.log(
      `Wrote ${path.relative(process.cwd(), OUT)}: ` +
        `${tables.length} table(s), ${indexes.length} index(es), ${views.length} view(s).`,
    );
    console.log("Structure only. No rows were read, so nothing private is in the file.");
    console.log("Commit it, and local testing can build a real copy of the schema.");
  } catch (err) {
    console.error("Could not read the schema:", err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();

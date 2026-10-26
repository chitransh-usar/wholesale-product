-- =====================================================
-- READ-ONLY FULL SCHEMA INVENTORY
-- Run each section in the target PostgreSQL SQL console and review its output.
-- The queries inspect schema metadata and approximate table row counts only.
-- =====================================================
-- 1) Every table with its columns, types, nullability and defaults

SELECT
  c.table_name,
  c.ordinal_position AS pos,
  c.column_name,
  c.data_type,
  c.udt_schema AS type_schema,
  c.udt_name AS type_name,
  c.character_maximum_length,
  c.numeric_precision,
  c.numeric_scale,
  c.datetime_precision,
  c.is_nullable AS nullable,
  c.column_default AS default_value,
  c.is_identity,
  c.identity_generation,
  c.is_generated,
  c.generation_expression,
  c.collation_schema,
  c.collation_name
FROM information_schema.columns c
JOIN information_schema.tables t
  ON t.table_name = c.table_name AND t.table_schema = c.table_schema
WHERE c.table_schema = 'public'
  AND t.table_type = 'BASE TABLE'
ORDER BY c.table_name, c.ordinal_position;


-- 2) Foreign keys: which column points at which table/column
SELECT
  tc.table_name        AS from_table,
  kcu.column_name      AS from_column,
  ccu.table_name       AS to_table,
  ccu.column_name      AS to_column,
  rc.delete_rule       AS on_delete
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON kcu.constraint_name = tc.constraint_name
 AND kcu.table_schema    = tc.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
 AND ccu.table_schema    = tc.table_schema
JOIN information_schema.referential_constraints rc
  ON rc.constraint_name  = tc.constraint_name
 AND rc.constraint_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
ORDER BY tc.table_name, kcu.column_name;


-- 3) All CHECK / UNIQUE / PRIMARY KEY constraints with their definitions.
--    This is what reveals things like chk_order_status.
SELECT
  rel.relname       AS table_name,
  con.conname       AS constraint_name,
  CASE con.contype
    WHEN 'c' THEN 'CHECK'
    WHEN 'p' THEN 'PRIMARY KEY'
    WHEN 'u' THEN 'UNIQUE'
    WHEN 'f' THEN 'FOREIGN KEY'
    ELSE con.contype::text
  END               AS kind,
  pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace ns ON ns.oid = rel.relnamespace
WHERE ns.nspname = 'public'
ORDER BY rel.relname, con.contype, con.conname;


-- 4) Row counts, to know which tables actually hold data
SELECT relname AS table_name, n_live_tup AS approx_rows
FROM pg_stat_user_tables
ORDER BY relname;


-- 5) Index definitions and validity
SELECT
  schemaname AS schema_name,
  tablename AS table_name,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

SELECT
  ns.nspname AS schema_name,
  tbl.relname AS table_name,
  idx.relname AS index_name,
  i.indisvalid AS is_valid,
  i.indisready AS is_ready,
  pg_get_indexdef(i.indexrelid) AS definition
FROM pg_index i
JOIN pg_class idx ON idx.oid = i.indexrelid
JOIN pg_class tbl ON tbl.oid = i.indrelid
JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
WHERE ns.nspname = 'public'
ORDER BY tbl.relname, idx.relname;


-- 6) Sequences and ownership
SELECT
  ns.nspname AS schema_name,
  seq.relname AS sequence_name,
  tbl.relname AS owned_by_table,
  attr.attname AS owned_by_column
FROM pg_class seq
JOIN pg_namespace ns ON ns.oid = seq.relnamespace
LEFT JOIN pg_depend dep
  ON dep.classid = 'pg_class'::regclass
 AND dep.objid = seq.oid
 AND dep.deptype IN ('a', 'i')
LEFT JOIN pg_class tbl ON tbl.oid = dep.refobjid
LEFT JOIN pg_attribute attr
  ON attr.attrelid = tbl.oid AND attr.attnum = dep.refobjsubid
WHERE seq.relkind = 'S'
  AND ns.nspname = 'public'
ORDER BY seq.relname;


-- 7) Views and materialized views
SELECT
  ns.nspname AS schema_name,
  obj.relname AS view_name,
  obj.relkind = 'm' AS is_materialized,
  pg_get_viewdef(obj.oid, true) AS definition
FROM pg_class obj
JOIN pg_namespace ns ON ns.oid = obj.relnamespace
WHERE ns.nspname = 'public'
  AND obj.relkind IN ('v', 'm')
ORDER BY obj.relname;


-- 8) User-defined functions and procedures
SELECT
  ns.nspname AS schema_name,
  proc.proname AS routine_name,
  proc.prokind AS routine_kind,
  pg_get_function_identity_arguments(proc.oid) AS arguments,
  pg_get_function_result(proc.oid) AS result_type,
  pg_get_functiondef(proc.oid) AS definition
FROM pg_proc proc
JOIN pg_namespace ns ON ns.oid = proc.pronamespace
WHERE ns.nspname = 'public'
  AND proc.prokind IN ('f', 'p')
ORDER BY proc.proname, arguments;


-- 9) User-defined types and installed extensions
SELECT
  ns.nspname AS schema_name,
  typ.typname AS type_name,
  typ.typtype AS type_kind,
  pg_get_userbyid(typ.typowner) AS owner
FROM pg_type typ
JOIN pg_namespace ns ON ns.oid = typ.typnamespace
WHERE ns.nspname = 'public'
  AND typ.typtype IN ('d', 'e', 'r', 'm')
ORDER BY typ.typname;

SELECT extname AS extension_name, extversion AS version
FROM pg_extension
ORDER BY extname;

SELECT
  ns.nspname AS schema_name,
  coll.collname AS collation_name,
  coll.collprovider AS provider,
  coll.collisdeterministic AS is_deterministic,
  coll.collcollate AS locale,
  coll.collctype AS character_type_locale
FROM pg_collation coll
JOIN pg_namespace ns ON ns.oid = coll.collnamespace
WHERE ns.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY ns.nspname, coll.collname;


-- 10) User-defined triggers and row-level security policies
SELECT
  ns.nspname AS schema_name,
  tbl.relname AS table_name,
  trig.tgname AS trigger_name,
  pg_get_triggerdef(trig.oid, true) AS definition,
  trig.tgenabled AS enabled
FROM pg_trigger trig
JOIN pg_class tbl ON tbl.oid = trig.tgrelid
JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
WHERE ns.nspname = 'public'
  AND NOT trig.tgisinternal
ORDER BY tbl.relname, trig.tgname;

SELECT
  schemaname AS schema_name,
  tablename AS table_name,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;


-- 11) User schemas and database-level event triggers
SELECT schema_name
FROM information_schema.schemata
WHERE schema_name NOT IN ('pg_catalog', 'information_schema')
ORDER BY schema_name;

SELECT
  evtname AS event_trigger_name,
  evtevent AS event_name,
  evtenabled AS enabled,
  pg_get_userbyid(evtowner) AS owner,
  pg_get_event_triggerdef(oid, true) AS definition
FROM pg_event_trigger
ORDER BY evtname;

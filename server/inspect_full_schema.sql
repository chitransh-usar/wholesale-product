-- =====================================================
-- FULL SCHEMA DUMP
-- Run each section in the Neon SQL Editor and share the output.
-- Section 1 alone answers most questions; 2-4 cover relations and rules.
-- =====================================================
-- 1) Every table with its columns, types, nullability and defaults

SELECT
  c.table_name,
  c.ordinal_position AS pos,
  c.column_name,
  c.data_type
    || COALESCE('(' || c.character_maximum_length || ')', '')
    AS type,
  c.is_nullable AS nullable,
  COALESCE(c.column_default, '') AS default_value
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

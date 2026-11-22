SET search_path TO "sto_info_app";

\pset tuples_only on
\pset format unaligned

CREATE OR REPLACE FUNCTION pg_temp.expect_true(label text, query text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  result boolean;
BEGIN
  EXECUTE query INTO result;

  IF result IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL % : expected true, got %', label, result;
  END IF;

  RAISE NOTICE 'PASS %', label;
END;
$fn$;

------------------------------------------------------------------------------
-- What the rollback took with it.
--
-- The placements go, and the migration's own comment says so: without them
-- nothing can say which slot an upload was for, and reverting this reverts
-- the feature that produced them. What matters here is that it is a clean
-- removal rather than a half one — a leftover enum type or index would make
-- the re-apply that follows fail with a name clash.
------------------------------------------------------------------------------
SELECT pg_temp.expect_true(
  'the placement table is gone',
  $$SELECT count(*) = 0 FROM information_schema.tables
     WHERE table_schema = 'sto_info_app' AND table_name = 'file_asset_placement'$$);

SELECT pg_temp.expect_true(
  'the delivery reference is gone from the registry',
  $$SELECT count(*) = 0 FROM information_schema.columns
     WHERE table_schema = 'sto_info_app' AND table_name = 'file_asset'
       AND column_name = 'deliveryReference'$$);

SELECT pg_temp.expect_true(
  'the three enum types are gone',
  $$SELECT count(*) = 0 FROM pg_type
     WHERE typname IN ('file_asset_placement_state_enum',
                       'file_asset_subject_enum',
                       'file_asset_slot_enum')$$);

SELECT pg_temp.expect_true(
  'the unique index on the delivery reference is gone',
  $$SELECT count(*) = 0 FROM pg_indexes
     WHERE schemaname = 'sto_info_app'
       AND indexname = 'UX_file_asset_delivery_reference'$$);

-- A rollback removes the column, and with it the only record of which
-- published object each asset was. The rows themselves are untouched, which
-- is what makes the re-apply that follows able to backfill them again.
SELECT pg_temp.expect_true(
  'the registry rows themselves are untouched',
  $$SELECT count(*) = 5 FROM "file_asset"$$);

------------------------------------------------------------------------------
-- The stub stays.
--
-- `file_asset` was created by this suite's pre-up rather than by a migration,
-- so a rollback is right to leave it alone — and the harness counts it as a
-- stub for exactly that reason.
------------------------------------------------------------------------------
SELECT pg_temp.expect_true(
  'the table the suite brought is still there for the re-apply',
  $$SELECT count(*) = 1 FROM information_schema.tables
     WHERE table_schema = 'sto_info_app' AND table_name = 'file_asset'$$);

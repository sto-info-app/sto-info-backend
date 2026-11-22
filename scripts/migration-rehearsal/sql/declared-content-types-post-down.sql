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
-- What the rollback put back: nothing, on purpose.
--
-- The migration's `down` is a no-op and says so. Which rows said `image/jpg`
-- and which said `image/jpeg` is not recorded anywhere, so there is nothing
-- to restore — and a `down` that guessed would be worse than one that
-- admits it. This asserts the documented behaviour rather than trusting the
-- comment: the canonical values are still canonical after a rollback.
------------------------------------------------------------------------------
SELECT pg_temp.expect_true(
  'a rollback leaves the canonical spellings in place',
  $$SELECT count(*) = 4 FROM "file_asset" WHERE "declaredContentType" = 'image/jpeg'$$);

SELECT pg_temp.expect_true(
  'a rollback does not resurrect the unreadable claims',
  $$SELECT count(*) = 4 FROM "file_asset" WHERE "declaredContentType" IS NULL$$);

------------------------------------------------------------------------------
-- The stub stays.
--
-- `file_asset` was created by this suite's pre-up, not by a migration, so a
-- rollback is right to leave it alone — and the harness counts it as a stub
-- for exactly that reason. Dropping it here would also break the re-apply
-- that follows, which runs the same migration against the same database a
-- second time.
------------------------------------------------------------------------------
SELECT pg_temp.expect_true(
  'the table the suite brought is still there for the re-apply',
  $$SELECT count(*) = 1 FROM information_schema.tables
     WHERE table_schema = 'sto_info_app' AND table_name = 'file_asset'$$);

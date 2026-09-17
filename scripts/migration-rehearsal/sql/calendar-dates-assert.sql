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

CREATE OR REPLACE FUNCTION pg_temp.expect_rejected(label text, stmt text, want text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  got text;
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS got = RETURNED_SQLSTATE;
    IF got <> want THEN
      RAISE EXCEPTION 'FAIL % : rejected with %, expected %', label, got, want;
    END IF;
    RAISE NOTICE 'PASS % (%)', label, got;

    RETURN;
  END;
  RAISE EXCEPTION 'FAIL % : the database ACCEPTED it', label;
END;
$fn$;

------------------------------------------------------------------------------
-- The columns are days now, not moments.
------------------------------------------------------------------------------
SELECT pg_temp.expect_true(
  'TYPE accountCreatedDate is a date',
  $$SELECT data_type = 'date' FROM information_schema.columns
    WHERE table_schema = 'sto_info_app' AND table_name = 'account'
      AND column_name = 'accountCreatedDate'$$);

SELECT pg_temp.expect_true(
  'TYPE createdDate is a date',
  $$SELECT data_type = 'date' FROM information_schema.columns
    WHERE table_schema = 'sto_info_app' AND table_name = 'character'
      AND column_name = 'createdDate'$$);

------------------------------------------------------------------------------
-- Every day survived, whatever time of day it was stored with.
------------------------------------------------------------------------------
SELECT pg_temp.expect_true(
  'CAST a midnight value keeps its day',
  $$SELECT "accountCreatedDate" = DATE '2015-03-04' FROM "account"
    WHERE "id" = '00000000-0000-0000-0000-0000000000b1'$$);

-- The time the demo seed chose meant nothing; discarding it must not move the
-- day it was attached to.
SELECT pg_temp.expect_true(
  'CAST a mid-morning value keeps its day',
  $$SELECT "accountCreatedDate" = DATE '2024-01-15' FROM "account"
    WHERE "id" = '00000000-0000-0000-0000-0000000000b2'$$);

-- A minute before midnight is where a cast that went through a zoned type
-- would roll the day forward. `timestamp` has no zone, so it cannot.
SELECT pg_temp.expect_true(
  'CAST a value late in the evening keeps its own day',
  $$SELECT "accountCreatedDate" = DATE '2019-12-31' FROM "account"
    WHERE "id" = '00000000-0000-0000-0000-0000000000b3'$$);

SELECT pg_temp.expect_true(
  'CAST no recorded date stays absent',
  $$SELECT "accountCreatedDate" IS NULL FROM "account"
    WHERE "id" = '00000000-0000-0000-0000-0000000000b4'$$);

SELECT pg_temp.expect_true(
  'CAST a captain keeps its day, including a leap day',
  $$SELECT (SELECT "createdDate" FROM "character"
            WHERE "id" = '00000000-0000-0000-0000-0000000000c1') = DATE '2020-06-01'
       AND (SELECT "createdDate" FROM "character"
            WHERE "id" = '00000000-0000-0000-0000-0000000000c2') = DATE '2024-02-29'$$);

SELECT pg_temp.expect_true(
  'CAST every row was converted, none lost',
  $$SELECT count(*) = 5 FROM "account"$$);

------------------------------------------------------------------------------
-- What the column will and will not accept from now on.
------------------------------------------------------------------------------
SELECT pg_temp.expect_true(
  'WRITE a bare day is stored as that day',
  $$SELECT "accountCreatedDate" = DATE '2026-09-17' FROM "account"
    WHERE "id" = '00000000-0000-0000-0000-0000000000b5'$$);

-- A day that does not exist is refused by the column itself, not only by the
-- DTO. 22008 is datetime_field_overflow.
SELECT pg_temp.expect_rejected(
  'WRITE the thirtieth of February is refused',
  $$UPDATE "account" SET "accountCreatedDate" = '2026-02-30'
    WHERE "id" = '00000000-0000-0000-0000-0000000000b5'$$, '22008');

-- A time of day sent to a `date` column is silently dropped rather than
-- refused. That is PostgreSQL's behaviour and not something this migration can
-- change; it is asserted so the next person knows the DTO is what stops an
-- instant being accepted, and that removing that validator would lose data
-- quietly rather than loudly.
SELECT pg_temp.expect_true(
  'WRITE a time of day is dropped, not refused',
  $$WITH written AS (
      UPDATE "account" SET "accountCreatedDate" = '2026-09-17 23:45:00'
      WHERE "id" = '00000000-0000-0000-0000-0000000000b5'
      RETURNING "accountCreatedDate")
    SELECT "accountCreatedDate" = DATE '2026-09-17' FROM written$$);

------------------------------------------------------------------------------
-- The expression the application actually sends.
--
-- `PublicMemberService` formats the aggregate in SQL rather than reading it as
-- a date, because the driver parses a `date` column into a JavaScript `Date` at
-- local midnight and anything that then serialises it is back to shifting the
-- day. This is that expression, run against the rehearsed data.
------------------------------------------------------------------------------
SELECT pg_temp.expect_true(
  'QUERY the playing-since expression returns the oldest day as text',
  $$SELECT to_char(MIN("accountCreatedDate"), 'YYYY-MM-DD') = '2015-03-04'
    FROM "account"$$);

-- Whatever the session timezone is. A `date` has no zone to be read in, which
-- is the property that makes the column type the fix rather than a workaround.
SELECT pg_temp.expect_true(
  'QUERY the same expression in a session five hours behind',
  $$SET TIME ZONE 'America/New_York';
    SELECT to_char(MIN("accountCreatedDate"), 'YYYY-MM-DD') = '2015-03-04'
    FROM "account"$$);

RESET TIME ZONE;

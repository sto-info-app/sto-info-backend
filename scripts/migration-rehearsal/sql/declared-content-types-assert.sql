SET search_path TO "sto_info_app";

-- Quiet: every helper returns void, so the result tables carry no information.
\pset tuples_only on
\pset format unaligned

CREATE OR REPLACE FUNCTION pg_temp.expect_type(label text, row_id uuid, want text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  got text;
BEGIN
  SELECT "declaredContentType" INTO got FROM "file_asset" WHERE "id" = row_id;

  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FAIL % : got %, expected %',
      label, coalesce(quote_literal(got), 'NULL'), coalesce(quote_literal(want), 'NULL');
  END IF;

  RAISE NOTICE 'PASS %', label;
END;
$fn$;

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
-- The aliases the two upload paths produce.
--
-- The one that matters is the first. The existing image upload accepts
-- `image/jpg` and `image/jpeg` as the same thing and stores whichever was
-- sent; the worker compares the stored value with what the bytes look like,
-- and a scanner that has never heard of `image/jpg` refuses every JPEG
-- uploaded through that path. FC-011.
------------------------------------------------------------------------------
SELECT pg_temp.expect_type(
  'image/jpg becomes image/jpeg',
  '00000000-0000-0000-0000-00000000a001', 'image/jpeg');

SELECT pg_temp.expect_type(
  'an alias in capitals becomes image/jpeg',
  '00000000-0000-0000-0000-00000000a002', 'image/jpeg');

SELECT pg_temp.expect_type(
  'image/pjpeg becomes image/jpeg',
  '00000000-0000-0000-0000-00000000a003', 'image/jpeg');

SELECT pg_temp.expect_type(
  'surrounding whitespace is dropped',
  '00000000-0000-0000-0000-00000000a004', 'image/jpeg');

SELECT pg_temp.expect_type(
  'image/x-png becomes image/png',
  '00000000-0000-0000-0000-00000000b001', 'image/png');

SELECT pg_temp.expect_type(
  'a type already canonical is left alone',
  '00000000-0000-0000-0000-00000000b002', 'image/png');

------------------------------------------------------------------------------
-- What a browser calls a CSV.
--
-- `application/vnd.ms-excel` is what a Windows machine with Excel installed
-- sends for a .csv. Without this reduction the worker sees a container type
-- it has no signature for, and refuses a roster export that is exactly what
-- it claims to be.
------------------------------------------------------------------------------
SELECT pg_temp.expect_type(
  'application/vnd.ms-excel becomes text/csv',
  '00000000-0000-0000-0000-00000000c001', 'text/csv');

SELECT pg_temp.expect_type(
  'a charset parameter is dropped',
  '00000000-0000-0000-0000-00000000c002', 'text/csv');

SELECT pg_temp.expect_type(
  'a parameter and capitals together are both dropped',
  '00000000-0000-0000-0000-00000000c003', 'text/csv');

SELECT pg_temp.expect_type(
  'application/csv becomes text/csv',
  '00000000-0000-0000-0000-00000000c004', 'text/csv');

SELECT pg_temp.expect_type(
  'text/comma-separated-values becomes text/csv',
  '00000000-0000-0000-0000-00000000c005', 'text/csv');

------------------------------------------------------------------------------
-- What cannot be rescued.
--
-- Null already means "nobody said", and it is the honest place for a claim
-- that cannot be read as a media type. The alternative — leaving `rubbish`
-- in the column — is a value that looks like a claim and is not one.
------------------------------------------------------------------------------
SELECT pg_temp.expect_type(
  'nothing declared stays nothing declared',
  '00000000-0000-0000-0000-00000000d001', NULL);

SELECT pg_temp.expect_type(
  'a value that is not a media type becomes null',
  '00000000-0000-0000-0000-00000000e001', NULL);

SELECT pg_temp.expect_type(
  'a wildcard becomes null',
  '00000000-0000-0000-0000-00000000e002', NULL);

SELECT pg_temp.expect_type(
  'a parameter with no type becomes null',
  '00000000-0000-0000-0000-00000000e003', NULL);

------------------------------------------------------------------------------
-- What the table has never heard of.
------------------------------------------------------------------------------
SELECT pg_temp.expect_type(
  'an unknown type keeps its meaning and loses only its capitals',
  '00000000-0000-0000-0000-00000000f001', 'application/vnd.made-up');

------------------------------------------------------------------------------
-- The whole column, afterwards.
--
-- The property the worker depends on, stated once over every row rather
-- than case by case: whatever is left is either nothing or a bare, lowercase
-- media type that the contract will carry and the comparison can use.
------------------------------------------------------------------------------
SELECT pg_temp.expect_true(
  'every surviving value is a bare lowercase media type',
  $$SELECT bool_and("declaredContentType" ~ '^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$')
     FROM "file_asset" WHERE "declaredContentType" IS NOT NULL$$);

SELECT pg_temp.expect_true(
  'no value carries a parameter, a space or a capital',
  $$SELECT bool_and("declaredContentType" !~ '[;[:space:][:upper:]]')
     FROM "file_asset" WHERE "declaredContentType" IS NOT NULL$$);

SELECT pg_temp.expect_true(
  'no row was invented or lost',
  $$SELECT count(*) = 16 FROM "file_asset"$$);

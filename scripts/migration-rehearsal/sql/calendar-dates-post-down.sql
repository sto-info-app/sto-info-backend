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

-- Runs after the rollback. The type comes back and so does every day; the time
-- of day does not, because a day cannot be turned back into a moment without
-- inventing one. What matters is that the day — which is the whole of the
-- value — survives a round trip in both directions.

SELECT pg_temp.expect_true(
  'ROLLBACK accountCreatedDate is a timestamp again',
  $$SELECT data_type = 'timestamp without time zone'
    FROM information_schema.columns
    WHERE table_schema = 'sto_info_app' AND table_name = 'account'
      AND column_name = 'accountCreatedDate'$$);

SELECT pg_temp.expect_true(
  'ROLLBACK createdDate is a timestamp again',
  $$SELECT data_type = 'timestamp without time zone'
    FROM information_schema.columns
    WHERE table_schema = 'sto_info_app' AND table_name = 'character'
      AND column_name = 'createdDate'$$);

SELECT pg_temp.expect_true(
  'ROLLBACK a midnight value is unchanged, having never had a time',
  $$SELECT "accountCreatedDate" = TIMESTAMP '2015-03-04 00:00:00' FROM "account"
    WHERE "id" = '00000000-0000-0000-0000-0000000000b1'$$);

SELECT pg_temp.expect_true(
  'ROLLBACK the day survives, at midnight rather than its old time',
  $$SELECT "accountCreatedDate" = TIMESTAMP '2024-01-15 00:00:00' FROM "account"
    WHERE "id" = '00000000-0000-0000-0000-0000000000b2'$$);

SELECT pg_temp.expect_true(
  'ROLLBACK a late-evening value keeps its day, not its evening',
  $$SELECT "accountCreatedDate" = TIMESTAMP '2019-12-31 00:00:00' FROM "account"
    WHERE "id" = '00000000-0000-0000-0000-0000000000b3'$$);

SELECT pg_temp.expect_true(
  'ROLLBACK no recorded date stays absent',
  $$SELECT "accountCreatedDate" IS NULL FROM "account"
    WHERE "id" = '00000000-0000-0000-0000-0000000000b4'$$);

SELECT pg_temp.expect_true(
  'ROLLBACK a captain keeps its day, including the leap day',
  $$SELECT (SELECT "createdDate" FROM "character"
            WHERE "id" = '00000000-0000-0000-0000-0000000000c2')
           = TIMESTAMP '2024-02-29 00:00:00'$$);

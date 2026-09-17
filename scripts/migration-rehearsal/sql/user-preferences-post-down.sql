SET search_path TO "sto_info_app";

\pset tuples_only on
\pset format unaligned

-- Runs after the rollback. This is the only place the claim that matters can
-- be tested: a migration that moves live data has to be able to put it back,
-- and a rollback that returned the schema but not the values would be
-- indistinguishable from a successful one until somebody signed in.
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

SELECT pg_temp.expect_true(
  'ROLLBACK both settings came back together',
  $$SELECT "privacyMode" = true AND "sessionTimeoutMinutes" = 480
    FROM "user_profile" WHERE "userId" = '00000000-0000-0000-0000-0000000000a1'$$);

SELECT pg_temp.expect_true(
  'ROLLBACK privacy mode alone came back, with a null timeout',
  $$SELECT "privacyMode" = true AND "sessionTimeoutMinutes" IS NULL
    FROM "user_profile" WHERE "userId" = '00000000-0000-0000-0000-0000000000a2'$$);

SELECT pg_temp.expect_true(
  'ROLLBACK a timeout alone came back',
  $$SELECT "privacyMode" = false AND "sessionTimeoutMinutes" = 60
    FROM "user_profile" WHERE "userId" = '00000000-0000-0000-0000-0000000000a3'$$);

SELECT pg_temp.expect_true(
  'ROLLBACK privacy mode off with a timeout came back',
  $$SELECT "privacyMode" = false AND "sessionTimeoutMinutes" = 240
    FROM "user_profile" WHERE "userId" = '00000000-0000-0000-0000-0000000000a5'$$);

-- A profile that had chosen nothing had no row to come back from, so it takes
-- the restored column defaults. That is the same answer it gave before the
-- migration ran, which is the point.
SELECT pg_temp.expect_true(
  'ROLLBACK a profile that had chosen nothing is back at the defaults',
  $$SELECT "privacyMode" = false AND "sessionTimeoutMinutes" IS NULL
    FROM "user_profile" WHERE "userId" = '00000000-0000-0000-0000-0000000000a4'$$);

-- The constraint comes back with the column it guards, or a rolled-back
-- deployment would accept session windows the site does not offer.
SELECT pg_temp.expect_rejected(
  'ROLLBACK the session window constraint is back',
  $$UPDATE "user_profile" SET "sessionTimeoutMinutes" = 120
    WHERE "userId" = '00000000-0000-0000-0000-0000000000a1'$$, '23514');

SELECT pg_temp.expect_true(
  'ROLLBACK the Fleet switch row is gone',
  $$SELECT NOT EXISTS (SELECT 1 FROM "app_setting"
    WHERE "key" = 'FLEET_COMMUNITIES_ENABLED')$$);

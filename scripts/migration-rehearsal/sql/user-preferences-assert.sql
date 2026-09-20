SET search_path TO "sto_info_app";

-- Quiet: every helper returns void, so the result tables carry no information.
\pset tuples_only on
\pset format unaligned


-- `expect_rejected` fails the run if the database lets a statement through that
-- is meant to be refused; `expect_true` fails it if a claim about the data is
-- not so.
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

CREATE OR REPLACE FUNCTION pg_temp.expect_accepted(label text, stmt text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE stmt;
  RAISE NOTICE 'PASS % (accepted)', label;
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

-- 23505 unique_violation, 23514 check_violation, 23503 foreign_key_violation,
-- 23001 restrict_violation (PostgreSQL 18 reports a blocked ON DELETE RESTRICT
-- this way; an orphan insert and a NO ACTION block still raise 23503),
-- 22P02 invalid_text_representation, 42703 undefined_column.

------------------------------------------------------------------------------
-- The move. Everything a user had chosen is where it should be, and nothing
-- that was only a default was copied.
------------------------------------------------------------------------------
SELECT pg_temp.expect_true(
  'MOVE both settings arrived together',
  $$SELECT "privacyMode" = true AND "sessionTimeoutMinutes" = 480
    FROM "user_preference" WHERE "userId" = '00000000-0000-0000-0000-0000000000a1'$$);

SELECT pg_temp.expect_true(
  'MOVE privacy mode alone arrived, with a null timeout',
  $$SELECT "privacyMode" = true AND "sessionTimeoutMinutes" IS NULL
    FROM "user_preference" WHERE "userId" = '00000000-0000-0000-0000-0000000000a2'$$);

SELECT pg_temp.expect_true(
  'MOVE a timeout alone arrived, with privacy mode off',
  $$SELECT "privacyMode" = false AND "sessionTimeoutMinutes" = 60
    FROM "user_preference" WHERE "userId" = '00000000-0000-0000-0000-0000000000a3'$$);

-- The case a naive filter gets wrong: privacy mode explicitly off is still a
-- choice when a timeout sits beside it.
SELECT pg_temp.expect_true(
  'MOVE privacy mode off with a timeout is still carried',
  $$SELECT "privacyMode" = false AND "sessionTimeoutMinutes" = 240
    FROM "user_preference" WHERE "userId" = '00000000-0000-0000-0000-0000000000a5'$$);

SELECT pg_temp.expect_true(
  'MOVE a profile that had chosen nothing got no row',
  $$SELECT NOT EXISTS (SELECT 1 FROM "user_preference"
    WHERE "userId" = '00000000-0000-0000-0000-0000000000a4')$$);

SELECT pg_temp.expect_true(
  'MOVE exactly four of the five profiles were carried',
  $$SELECT count(*) = 4 FROM "user_preference"
    WHERE "userId" < '00000000-0000-0000-0000-0000000000b0'$$);

------------------------------------------------------------------------------
-- The old columns are gone. A migration that copied without dropping would
-- leave two places to write privacy mode and no rule about which wins.
------------------------------------------------------------------------------
SELECT pg_temp.expect_rejected(
  'MOVE user_profile no longer has privacyMode',
  $$SELECT "privacyMode" FROM "user_profile" LIMIT 1$$, '42703');

SELECT pg_temp.expect_rejected(
  'MOVE user_profile no longer has sessionTimeoutMinutes',
  $$SELECT "sessionTimeoutMinutes" FROM "user_profile" LIMIT 1$$, '42703');

------------------------------------------------------------------------------
-- Defaults. A row written with nothing but a key is what an account that has
-- never opened the settings page gets the moment it changes one thing.
------------------------------------------------------------------------------
SELECT pg_temp.expect_true(
  'DEFAULT presence is friends and typing is off',
  $$SELECT "presenceVisibility" = 'FRIENDS' AND "typingIndicatorsEnabled" = false
      AND "appearOffline" = false
    FROM "user_preference" WHERE "userId" = '00000000-0000-0000-0000-0000000000b1'$$);

SELECT pg_temp.expect_true(
  'DEFAULT every notification category is on',
  $$SELECT "notifyMention" AND "notifyReply" AND "notifyDirectMessage"
      AND "notifyRosterAssociation" AND "notifyEventReminder"
    FROM "user_preference" WHERE "userId" = '00000000-0000-0000-0000-0000000000b1'$$);

SELECT pg_temp.expect_true(
  'DEFAULT neither timezone is guessed',
  $$SELECT "displayTimezone" IS NULL AND "stoExportTimezone" IS NULL
    FROM "user_preference" WHERE "userId" = '00000000-0000-0000-0000-0000000000b1'$$);

------------------------------------------------------------------------------
-- Constraints.
------------------------------------------------------------------------------
SELECT pg_temp.expect_rejected(
  'CHK a session window outside the three offered is refused',
  $$INSERT INTO "user_preference" ("userId", "sessionTimeoutMinutes")
    VALUES ('00000000-0000-0000-0000-0000000000b2', 120)$$, '23514');

SELECT pg_temp.expect_accepted(
  'CHK each offered session window is accepted',
  $$UPDATE "user_preference" SET "sessionTimeoutMinutes" = 60
    WHERE "userId" = '00000000-0000-0000-0000-0000000000b1'$$);

SELECT pg_temp.expect_rejected(
  'PK one row per user',
  $$INSERT INTO "user_preference" ("userId")
    VALUES ('00000000-0000-0000-0000-0000000000b1')$$, '23505');

SELECT pg_temp.expect_rejected(
  'FK preferences cannot belong to an account that does not exist',
  $$INSERT INTO "user_preference" ("userId")
    VALUES ('00000000-0000-0000-0000-00000000dead')$$, '23503');

-- Hiding is a separate switch, not a fourth audience, so that going invisible
-- for an afternoon does not overwrite the audience the user chose.
SELECT pg_temp.expect_rejected(
  'ENUM HIDDEN is not a presence audience',
  $$UPDATE "user_preference" SET "presenceVisibility" = 'HIDDEN'
    WHERE "userId" = '00000000-0000-0000-0000-0000000000b1'$$, '22P02');

SELECT pg_temp.expect_accepted(
  'ENUM the three real audiences are accepted',
  $$UPDATE "user_preference" SET "presenceVisibility" = 'FLEETS_AND_ARMADAS'
    WHERE "userId" = '00000000-0000-0000-0000-0000000000b1'$$);

-- Preferences follow the account. A row left behind would belong to nobody.
SELECT pg_temp.expect_accepted(
  'CASCADE deleting the account takes the preferences with it',
  $$DELETE FROM "user" WHERE "id" = '00000000-0000-0000-0000-0000000000b1'$$);

SELECT pg_temp.expect_true(
  'CASCADE no preference row survived its user',
  $$SELECT NOT EXISTS (SELECT 1 FROM "user_preference"
    WHERE "userId" = '00000000-0000-0000-0000-0000000000b1')$$);

------------------------------------------------------------------------------
-- The Fleet master switch.
------------------------------------------------------------------------------
SELECT pg_temp.expect_true(
  'SWITCH Fleet Community is seeded disabled',
  $$SELECT "value" = 'false' FROM "app_setting"
    WHERE "key" = 'FLEET_COMMUNITIES_ENABLED'$$);

-- An environment somebody has already switched on must not be switched back
-- off by deploying. This runs the migration's own statement verbatim against a
-- row that says true.
SELECT pg_temp.expect_accepted(
  'SWITCH an administrator turns it on',
  $$UPDATE "app_setting" SET "value" = 'true'
    WHERE "key" = 'FLEET_COMMUNITIES_ENABLED'$$);

SELECT pg_temp.expect_accepted(
  'SWITCH re-running the seed is accepted',
  $$INSERT INTO "sto_info_app"."app_setting" ("key", "value", "description")
    VALUES ('FLEET_COMMUNITIES_ENABLED', 'false', 'Master switch for the Fleet Community feature. File scanning and retention jobs are site-wide and are not affected by this setting.')
    ON CONFLICT ("key") DO NOTHING$$);

SELECT pg_temp.expect_true(
  'SWITCH re-running the seed left it switched on',
  $$SELECT "value" = 'true' FROM "app_setting"
    WHERE "key" = 'FLEET_COMMUNITIES_ENABLED'$$);

-- Put it back, so the state the rollback runs over is the seeded one.
SELECT pg_temp.expect_accepted(
  'SWITCH restored to its seeded value',
  $$UPDATE "app_setting" SET "value" = 'false'
    WHERE "key" = 'FLEET_COMMUNITIES_ENABLED'$$);

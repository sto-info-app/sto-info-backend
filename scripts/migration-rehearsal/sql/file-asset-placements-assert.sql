SET search_path TO "sto_info_app";

-- Quiet: every helper returns void, so the result tables carry no information.
\pset tuples_only on
\pset format unaligned

-- Every assertion below is a deliberate attempt to break a rule FC-012's
-- migration claims to enforce. `expect_rejected` fails the run if the
-- database lets it through.
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
-- 23001 restrict_violation. From PostgreSQL 18 a delete blocked by ON DELETE
-- RESTRICT raises 23001.

------------------------------------------------------------------------------
-- The backfill: one column answers "what has to be deleted to withdraw this"
-- for the estate as well as for everything uploaded since.
------------------------------------------------------------------------------
SELECT pg_temp.expect_true(
  'a published image is addressed by the identifier it already had',
  $$SELECT "deliveryReference" = 'env-user-1-user-1-1758000000000'
    FROM "file_asset" WHERE "id" = '00000000-0000-0000-0000-0000000aa001'$$);

SELECT pg_temp.expect_true(
  'a legacy public object is addressed by its key',
  $$SELECT "deliveryReference" = 'test/user-1/char-1/portrait.png'
    FROM "file_asset" WHERE "id" = '00000000-0000-0000-0000-0000000aa002'$$);

-- Nothing delivers a quarantined object except the authenticated endpoint,
-- which addresses it by the key it was hashed under.
SELECT pg_temp.expect_true(
  'a quarantined object gains no delivery reference',
  $$SELECT "deliveryReference" IS NULL
    FROM "file_asset" WHERE "id" = '00000000-0000-0000-0000-0000000aa003'$$);

SELECT pg_temp.expect_true(
  'an asset that stored nothing gains no delivery reference',
  $$SELECT "deliveryReference" IS NULL
    FROM "file_asset" WHERE "id" = '00000000-0000-0000-0000-0000000aa004'$$);

-- The invariant the withdrawal lookup rests on. Two rows claiming the same
-- delivered object would be two answers to whether a purge is owed for it.
SELECT pg_temp.expect_rejected(
  'one delivered object belongs to one asset',
  $$UPDATE "file_asset" SET "deliveryReference" = 'env-user-1-user-1-1758000000000'
    WHERE "id" = '00000000-0000-0000-0000-0000000aa005'$$,
  '23505');

SELECT pg_temp.expect_accepted(
  'two assets may both be waiting for one',
  $$UPDATE "file_asset" SET "deliveryReference" = NULL
    WHERE "id" IN ('00000000-0000-0000-0000-0000000aa003',
                   '00000000-0000-0000-0000-0000000aa004')$$);

------------------------------------------------------------------------------
-- One pending and one active placement per slot.
------------------------------------------------------------------------------
SELECT pg_temp.expect_rejected(
  'a slot shows one picture at a time',
  $$INSERT INTO "file_asset_placement"
      ("assetId", "state", "subject", "subjectId", "slot", "settledAt")
    VALUES ('00000000-0000-0000-0000-0000000aa005', 'ACTIVE',
            'STORYTIME_STORY', 'story-1', 'BANNER', now())$$,
  '23505');

SELECT pg_temp.expect_rejected(
  'one upload at a time is on its way to a slot',
  $$INSERT INTO "file_asset_placement"
      ("assetId", "state", "subject", "subjectId", "slot")
    VALUES ('00000000-0000-0000-0000-0000000aa005', 'PENDING',
            'STORYTIME_STORY', 'story-1', 'PROFILE')$$,
  '23505');

-- A refusal somebody has not replaced sits beside the picture the slot
-- still shows, which is the whole point of keeping it.
SELECT pg_temp.expect_accepted(
  'a refusal may sit beside the picture a slot shows',
  $$INSERT INTO "file_asset_placement"
      ("assetId", "state", "subject", "subjectId", "slot", "settledAt")
    VALUES ('00000000-0000-0000-0000-0000000aa004', 'REJECTED',
            'USER_PROFILE', 'user-1', 'PICTURE', now())$$);

SELECT pg_temp.expect_accepted(
  'the same record may have a picture in each of its slots',
  $$INSERT INTO "file_asset_placement"
      ("assetId", "state", "subject", "subjectId", "slot")
    VALUES ('00000000-0000-0000-0000-0000000aa004', 'PENDING',
            'STORYTIME_STORY', 'story-1', 'COVER')$$);

------------------------------------------------------------------------------
-- A pending placement has not settled, and a settled one has. This is what
-- the nightly sweep measures abandonment against.
------------------------------------------------------------------------------
SELECT pg_temp.expect_rejected(
  'a pending placement cannot claim to have settled',
  $$INSERT INTO "file_asset_placement"
      ("assetId", "state", "subject", "subjectId", "slot", "settledAt")
    VALUES ('00000000-0000-0000-0000-0000000aa004', 'PENDING',
            'STORYTIME_ARC', 'arc-1', 'BANNER', now())$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'a settled placement cannot claim it never did',
  $$INSERT INTO "file_asset_placement"
      ("assetId", "state", "subject", "subjectId", "slot")
    VALUES ('00000000-0000-0000-0000-0000000aa004', 'ABANDONED',
            'STORYTIME_ARC', 'arc-1', 'BANNER')$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'a placement must say which record it is for',
  $$INSERT INTO "file_asset_placement"
      ("assetId", "state", "subject", "subjectId", "slot")
    VALUES ('00000000-0000-0000-0000-0000000aa004', 'PENDING',
            'STORYTIME_ARC', '   ', 'PROFILE')$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'a placement must be for an asset that exists',
  $$INSERT INTO "file_asset_placement"
      ("assetId", "state", "subject", "subjectId", "slot")
    VALUES ('00000000-0000-0000-0000-0000000ffff9', 'PENDING',
            'STORYTIME_ARC', 'arc-1', 'PROFILE')$$,
  '23503');

------------------------------------------------------------------------------
-- Identity is write-once, and nothing returns to pending.
------------------------------------------------------------------------------
SELECT pg_temp.expect_rejected(
  'a placement cannot be re-pointed at another asset',
  $$UPDATE "file_asset_placement" SET "assetId" = '00000000-0000-0000-0000-0000000aa004'
    WHERE "id" = '00000000-0000-0000-0000-0000000fb002'$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'a placement cannot be moved to another record',
  $$UPDATE "file_asset_placement" SET "subjectId" = 'story-2'
    WHERE "id" = '00000000-0000-0000-0000-0000000fb002'$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'a placement cannot be moved to another kind of record',
  $$UPDATE "file_asset_placement" SET "subject" = 'STORYTIME_ARC'
    WHERE "id" = '00000000-0000-0000-0000-0000000fb002'$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'a placement cannot be moved to another slot',
  $$UPDATE "file_asset_placement" SET "slot" = 'COVER'
    WHERE "id" = '00000000-0000-0000-0000-0000000fb002'$$,
  '23514');

-- Without this, a swept placement could be revived after its bytes had been
-- dropped.
SELECT pg_temp.expect_rejected(
  'a settled placement cannot go back to pending',
  $$UPDATE "file_asset_placement"
    SET "state" = 'PENDING', "settledAt" = NULL
    WHERE "id" = '00000000-0000-0000-0000-0000000fb001'$$,
  '23514');

-- The move publication actually makes: the slot that was showing something
-- is superseded, and the pending upload becomes what it shows.
SELECT pg_temp.expect_accepted(
  'publication supersedes the old picture and activates the new one',
  $$UPDATE "file_asset_placement" SET "state" = 'SUPERSEDED'
    WHERE "id" = '00000000-0000-0000-0000-0000000fb001'$$);

SELECT pg_temp.expect_accepted(
  'a pending placement may become the picture its slot shows',
  $$UPDATE "file_asset_placement"
    SET "state" = 'ACTIVE', "settledAt" = now()
    WHERE "id" = '00000000-0000-0000-0000-0000000fb002'$$);

------------------------------------------------------------------------------
-- An asset row is evidence that bytes existed, and a placement points at one.
------------------------------------------------------------------------------
SELECT pg_temp.expect_rejected(
  'an asset with a placement cannot simply be deleted',
  $$DELETE FROM "file_asset" WHERE "id" = '00000000-0000-0000-0000-0000000aa001'$$,
  '23001');

SET search_path TO "sto_info_app";

-- Quiet: every helper returns void, so the result tables carry no information.
\pset tuples_only on
\pset format unaligned


-- Every assertion below is a deliberate attempt to break an FC-008 acceptance
-- criterion. `expect_rejected` fails the run if the database lets it through.
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

-- 23505 unique_violation, 23514 check_violation, 23503 foreign_key_violation.

------------------------------------------------------------------------------
-- AC1: only AVAILABLE is served, and a clean verdict alone does not get there.
--
-- The delivery service refuses anything that is not AVAILABLE; what is asserted
-- here is the other half, that the row cannot arrive in AVAILABLE by a route
-- that skipped the verdict or reversed a refusal.
------------------------------------------------------------------------------
SELECT pg_temp.expect_accepted(
  'AC1 a clean asset may be published',
  $$UPDATE "file_asset" SET "state" = 'AVAILABLE', "availableAt" = now()
    WHERE "id" = '00000000-0000-0000-0000-0000000aa001'$$);

SELECT pg_temp.expect_rejected(
  'AC1 an asset still in quarantine cannot be published',
  $$UPDATE "file_asset" SET "state" = 'AVAILABLE'
    WHERE "id" = '00000000-0000-0000-0000-0000000aa004'$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'AC1 an asset that was refused cannot be published',
  $$UPDATE "file_asset" SET "state" = 'AVAILABLE'
    WHERE "id" = '00000000-0000-0000-0000-0000000aa002'$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'AC1 an asset that was withdrawn cannot be published again',
  $$UPDATE "file_asset" SET "state" = 'AVAILABLE'
    WHERE "id" = '00000000-0000-0000-0000-0000000aa003'$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'AC1 an available asset must have somewhere for its bytes to be',
  $$INSERT INTO "file_asset" ("kind", "state", "audience", "storage")
    VALUES ('PROFILE_IMAGE', 'AVAILABLE', 'PUBLIC', 'NONE')$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'AC1 an available asset cannot have a null object key',
  $$INSERT INTO "file_asset" ("kind", "state", "audience", "storage")
    VALUES ('PROFILE_IMAGE', 'AVAILABLE', 'PUBLIC', 'QUARANTINE')$$,
  '23514');

------------------------------------------------------------------------------
-- AC4: object identity is write-once, so replacing the source invalidates the
-- prior verdict rather than inheriting it.
------------------------------------------------------------------------------
SELECT pg_temp.expect_rejected(
  'AC4 the object key of a stored asset cannot be changed',
  $$UPDATE "file_asset" SET "objectKey" = 'local/assets/somewhere-else'
    WHERE "id" = '00000000-0000-0000-0000-0000000aa001'$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'AC4 the object version of a stored asset cannot be changed',
  $$UPDATE "file_asset" SET "objectVersion" = 'v-2'
    WHERE "id" = '00000000-0000-0000-0000-0000000aa001'$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'AC4 the hash a verdict was bound to cannot be changed',
  $$UPDATE "file_asset" SET "sha256" = repeat('c', 64)
    WHERE "id" = '00000000-0000-0000-0000-0000000aa001'$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'AC4 the object version cannot be cleared either',
  $$UPDATE "file_asset" SET "objectVersion" = NULL
    WHERE "id" = '00000000-0000-0000-0000-0000000aa001'$$,
  '23514');

SELECT pg_temp.expect_accepted(
  'AC4 identity may be filled in once, from nothing',
  $$UPDATE "file_asset" SET "objectVersion" = 'v-first', "sha256" = repeat('d', 64)
    WHERE "id" = '00000000-0000-0000-0000-0000000aa004'$$);

SELECT pg_temp.expect_rejected(
  'AC4 and not a second time',
  $$UPDATE "file_asset" SET "objectVersion" = 'v-second'
    WHERE "id" = '00000000-0000-0000-0000-0000000aa004'$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'AC4 a hash must be lowercase hexadecimal of the right length',
  $$INSERT INTO "file_asset" ("kind", "state", "audience", "storage", "objectKey", "sha256")
    VALUES ('PROFILE_IMAGE', 'QUARANTINED', 'PUBLIC', 'QUARANTINE', 'k-1', 'NOT-A-HASH')$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'AC4 an uppercase hash is refused rather than folded',
  $$INSERT INTO "file_asset" ("kind", "state", "audience", "storage", "objectKey", "sha256")
    VALUES ('PROFILE_IMAGE', 'QUARANTINED', 'PUBLIC', 'QUARANTINE', 'k-2', repeat('A', 64))$$,
  '23514');

------------------------------------------------------------------------------
-- One row per object. Two assets claiming the same bytes would mean two
-- verdicts and two audiences for one object, and delivery would serve whichever
-- it found first.
------------------------------------------------------------------------------
SELECT pg_temp.expect_rejected(
  'one asset per stored object',
  $$INSERT INTO "file_asset" ("kind", "state", "audience", "storage", "objectKey")
    VALUES ('PROFILE_IMAGE', 'QUARANTINED', 'PUBLIC', 'QUARANTINE', 'local/assets/aa001')$$,
  '23505');

SELECT pg_temp.expect_accepted(
  'the same key in a different store is a different object',
  $$INSERT INTO "file_asset" ("kind", "state", "audience", "storage", "objectKey")
    VALUES ('PROFILE_IMAGE', 'UNVERIFIED', 'PUBLIC', 'PUBLIC_IMAGES', 'local/assets/aa001')$$);

------------------------------------------------------------------------------
-- A scoped audience names exactly one scope, and an unscoped one names none.
------------------------------------------------------------------------------
SELECT pg_temp.expect_rejected(
  'a scoped asset naming no scope is refused',
  $$INSERT INTO "file_asset" ("kind", "state", "audience", "storage", "objectKey", "scopeAudience")
    VALUES ('FLEET_IMAGE', 'QUARANTINED', 'SCOPE', 'QUARANTINE', 'k-3', 'FLEET_MEMBERS')$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'a scoped asset naming no scope audience is refused',
  $$INSERT INTO "file_asset" ("kind", "state", "audience", "storage", "objectKey", "fleetId")
    VALUES ('FLEET_IMAGE', 'QUARANTINED', 'SCOPE', 'QUARANTINE', 'k-4',
            '00000000-0000-0000-0000-0000000ea001')$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'an asset naming two scopes at once is refused',
  $$INSERT INTO "file_asset" ("kind", "state", "audience", "storage", "objectKey", "fleetId", "communityId", "scopeAudience")
    VALUES ('FLEET_IMAGE', 'QUARANTINED', 'SCOPE', 'QUARANTINE', 'k-5',
            '00000000-0000-0000-0000-0000000ea001', '00000000-0000-0000-0000-0000000da001', 'FLEET_MEMBERS')$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'an unscoped asset carrying a scope audience is refused',
  $$INSERT INTO "file_asset" ("kind", "state", "audience", "storage", "objectKey", "scopeAudience")
    VALUES ('PROFILE_IMAGE', 'QUARANTINED', 'PUBLIC', 'QUARANTINE', 'k-6', 'PUBLIC')$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'an asset cannot be scoped to a Fleet that does not exist',
  $$INSERT INTO "file_asset" ("kind", "state", "audience", "storage", "objectKey", "fleetId", "scopeAudience")
    VALUES ('FLEET_IMAGE', 'QUARANTINED', 'SCOPE', 'QUARANTINE', 'k-7',
            '00000000-0000-0000-0000-00000000dead', 'FLEET_MEMBERS')$$,
  '23503');

------------------------------------------------------------------------------
-- Housekeeping invariants.
------------------------------------------------------------------------------
SELECT pg_temp.expect_rejected(
  'a negative byte count is refused',
  $$INSERT INTO "file_asset" ("kind", "state", "audience", "storage", "objectKey", "byteSize")
    VALUES ('PROFILE_IMAGE', 'QUARANTINED', 'PUBLIC', 'QUARANTINE', 'k-8', -1)$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'a policy version below one is refused',
  $$INSERT INTO "file_asset" ("kind", "state", "audience", "storage", "objectKey", "policyVersion")
    VALUES ('PROFILE_IMAGE', 'QUARANTINED', 'PUBLIC', 'QUARANTINE', 'k-9', 0)$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'a purge cannot be confirmed when none was owed',
  $$INSERT INTO "file_asset" ("kind", "state", "audience", "storage", "objectKey", "purgedAt")
    VALUES ('PROFILE_IMAGE', 'REVOKED', 'PUBLIC', 'PUBLIC_IMAGES', 'k-10', now())$$,
  '23514');

------------------------------------------------------------------------------
-- AC3's counting half: the estate is inventoried, and the inventory knows which
-- delivery route each object is on, because withdrawing them is not the same
-- operation.
------------------------------------------------------------------------------
-- Twelve distinct objects across thirteen references: the story banner reused
-- as an arc banner is one object. The owner filter excludes the probe row an
-- assertion above inserted, which deliberately carries no owner.
SELECT pg_temp.expect_true(
  'the backfill counted every legacy image once',
  $$SELECT count(*) = 12 FROM "file_asset"
    WHERE "state" = 'UNVERIFIED' AND "ownerUserId" IS NOT NULL$$);

SELECT pg_temp.expect_true(
  'the backfill counted a reused image once',
  $$SELECT count(*) = 1 FROM "file_asset"
    WHERE "state" = 'UNVERIFIED' AND "objectKey" = 'story-banner-1'$$);

SELECT pg_temp.expect_true(
  'the backfill recognised the pre-Images object as a legacy public one',
  $$SELECT "storage" = 'LEGACY_PUBLIC_R2' FROM "file_asset"
    WHERE "objectKey" = 'prod/user-1/char-2/portrait.png'$$);

SELECT pg_temp.expect_true(
  'the backfill recognised a Cloudflare identifier as an Images object',
  $$SELECT "storage" = 'PUBLIC_IMAGES' FROM "file_asset"
    WHERE "objectKey" = 'prod-user-1-character-1700000001'$$);

SELECT pg_temp.expect_true(
  'the backfill followed a Character two joins to its uploader',
  $$SELECT "ownerUserId" = '00000000-0000-0000-0000-0000000fa001' FROM "file_asset"
    WHERE "objectKey" = 'tracking-image-2'$$);

SELECT pg_temp.expect_true(
  'the backfill followed a chapter to the owner of its story',
  $$SELECT "ownerUserId" = '00000000-0000-0000-0000-0000000fa002' FROM "file_asset"
    WHERE "objectKey" = 'chapter-cover-1'$$);

-- The whole point of UNVERIFIED. Counting the estate neither publishes it nor
-- refuses it: these objects are still delivered by their existing routes and
-- nobody has looked at them yet, so the row says exactly that and no more.
SELECT pg_temp.expect_true(
  'no backfilled row carries a verdict it never had',
  $$SELECT count(*) = 0 FROM "file_asset"
    WHERE "state" = 'UNVERIFIED' AND "scanEngine" IS NOT NULL$$);

SELECT pg_temp.expect_true(
  'no backfilled row claims a hash nobody computed',
  $$SELECT count(*) = 0 FROM "file_asset"
    WHERE "state" = 'UNVERIFIED' AND "sha256" IS NOT NULL$$);

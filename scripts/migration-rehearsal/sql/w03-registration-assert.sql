SET search_path TO "sto_info_app";

-- Quiet: every helper returns void, so the result tables carry no information.
\pset tuples_only on
\pset format unaligned

-- Every assertion below is a deliberate attempt to break a rule one of W03's
-- three migrations claims to enforce. `expect_rejected` fails the run if the
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

-- 23505 unique_violation, 23514 check_violation, 23503 foreign_key_violation.

------------------------------------------------------------------------------
-- A slug is unique per Community *and* platform, not per Community.
------------------------------------------------------------------------------
SELECT pg_temp.expect_accepted(
  'the same Fleet slug is free again on a second platform',
  $$INSERT INTO "sto_fleet" ("id","communityId","platformId","exactGameName","exactGameNameNormalized","slug")
    VALUES ('00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000d1',
            '00000000-0000-0000-0000-0000000000b2','Omega Armada','omega armada','omega-armada')$$);

SELECT pg_temp.expect_rejected(
  'the same Fleet slug twice on one platform is still refused',
  $$INSERT INTO "sto_fleet" ("id","communityId","platformId","exactGameName","exactGameNameNormalized","slug")
    VALUES ('00000000-0000-0000-0000-0000000000e3','00000000-0000-0000-0000-0000000000d1',
            '00000000-0000-0000-0000-0000000000b1','Omega Armada Two','omega armada two','omega-armada')$$,
  '23505');

SELECT pg_temp.expect_accepted(
  'an Armada slug is scoped the same way',
  $$INSERT INTO "sto_armada" ("id","communityId","platformId","exactGameName","exactGameNameNormalized","slug")
    VALUES ('00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000d1',
            '00000000-0000-0000-0000-0000000000b2','Vanguard Armada','vanguard armada','vanguard-armada')$$);

SELECT pg_temp.expect_rejected(
  'the same Armada slug twice on one platform is still refused',
  $$INSERT INTO "sto_armada" ("id","communityId","platformId","exactGameName","exactGameNameNormalized","slug")
    VALUES ('00000000-0000-0000-0000-0000000000f3','00000000-0000-0000-0000-0000000000d1',
            '00000000-0000-0000-0000-0000000000b1','Vanguard Two','vanguard two','vanguard-armada')$$,
  '23505');

-- A soft-deleted Fleet frees its slug, which is what the partial clause is for
-- and is unaffected by the wider key.
SELECT pg_temp.expect_accepted(
  'soft-deleting frees the slug on that platform',
  $$UPDATE "sto_fleet" SET "deletedAt" = now() WHERE "id" = '00000000-0000-0000-0000-0000000000e1'$$);

SELECT pg_temp.expect_accepted(
  'and the freed slug can be taken again',
  $$INSERT INTO "sto_fleet" ("id","communityId","platformId","exactGameName","exactGameNameNormalized","slug")
    VALUES ('00000000-0000-0000-0000-0000000000e4','00000000-0000-0000-0000-0000000000d1',
            '00000000-0000-0000-0000-0000000000b1','Omega Reborn','omega reborn','omega-armada')$$);

------------------------------------------------------------------------------
-- Ten live Communities per owner, counted by the database rather than trusted
-- to a service.
------------------------------------------------------------------------------
SELECT pg_temp.expect_accepted(
  'an owner may reach ten',
  $$INSERT INTO "fleet_community" ("id","ownerUserId","name","slug")
    SELECT ('00000000-0000-0000-0000-00000000c0' || to_char(number, 'FM00'))::uuid,
           '00000000-0000-0000-0000-0000000000a1',
           'Filler ' || number,
           'filler-' || number
      FROM generate_series(1, 9) AS number$$);

SELECT pg_temp.expect_true(
  'ten is what the owner now holds',
  $$SELECT count(*) = 10 FROM "fleet_community"
     WHERE "ownerUserId" = '00000000-0000-0000-0000-0000000000a1' AND "deletedAt" IS NULL$$);

SELECT pg_temp.expect_rejected(
  'the eleventh is refused',
  $$INSERT INTO "fleet_community" ("id","ownerUserId","name","slug")
    VALUES ('00000000-0000-0000-0000-00000000c099','00000000-0000-0000-0000-0000000000a1','One Too Many','one-too-many')$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'and so is transferring another Community onto a full owner',
  $$UPDATE "fleet_community" SET "ownerUserId" = '00000000-0000-0000-0000-0000000000a1'
     WHERE "id" = '00000000-0000-0000-0000-0000000000d2'$$,
  '23514');

SELECT pg_temp.expect_accepted(
  'soft-deleting one frees a place',
  $$UPDATE "fleet_community" SET "deletedAt" = now() WHERE "id" = '00000000-0000-0000-0000-00000000c001'$$);

SELECT pg_temp.expect_accepted(
  'the eleventh then fits',
  $$INSERT INTO "fleet_community" ("id","ownerUserId","name","slug")
    VALUES ('00000000-0000-0000-0000-00000000c099','00000000-0000-0000-0000-0000000000a1','Now Room','now-room')$$);

SELECT pg_temp.expect_rejected(
  'restoring the soft-deleted one is refused while the owner is full again',
  $$UPDATE "fleet_community" SET "deletedAt" = NULL WHERE "id" = '00000000-0000-0000-0000-00000000c001'$$,
  '23514');

-- An edit that changes nothing about ownership still fires the trigger, and
-- must not fail merely because the owner is at the limit.
SELECT pg_temp.expect_accepted(
  'an ordinary edit by a full owner still succeeds',
  $$UPDATE "fleet_community" SET "description" = 'Renamed while full'
     WHERE "id" = '00000000-0000-0000-0000-0000000000d1'$$);

-- An empty owner is unaffected by another owner's count.
SELECT pg_temp.expect_accepted(
  'a different owner is not held to the first one''s count',
  $$INSERT INTO "fleet_community" ("id","ownerUserId","name","slug")
    VALUES ('00000000-0000-0000-0000-00000000c0a3','00000000-0000-0000-0000-0000000000a3','Third Owner','third-owner')$$);

------------------------------------------------------------------------------
-- Retired slugs: scoped the way live ones are, and never reissued.
------------------------------------------------------------------------------
SELECT pg_temp.expect_accepted(
  'a Community retires a slug',
  $$INSERT INTO "fleet_slug_history" ("targetType","targetId","slug")
    VALUES ('COMMUNITY','00000000-0000-0000-0000-0000000000d1','old-first-contact')$$);

SELECT pg_temp.expect_rejected(
  'and nothing else may retire the same one',
  $$INSERT INTO "fleet_slug_history" ("targetType","targetId","slug")
    VALUES ('COMMUNITY','00000000-0000-0000-0000-0000000000d2','old-first-contact')$$,
  '23505');

SELECT pg_temp.expect_rejected(
  'a Community slug may not carry a parent',
  $$INSERT INTO "fleet_slug_history" ("targetType","targetId","communityId","platformId","slug")
    VALUES ('COMMUNITY','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000d1',
            '00000000-0000-0000-0000-0000000000b1','parented-community')$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'a Fleet slug without a platform is not scoped at all',
  $$INSERT INTO "fleet_slug_history" ("targetType","targetId","communityId","slug")
    VALUES ('FLEET','00000000-0000-0000-0000-0000000000e4','00000000-0000-0000-0000-0000000000d1','half-scoped')$$,
  '23514');

SELECT pg_temp.expect_accepted(
  'a Fleet retires a slug',
  $$INSERT INTO "fleet_slug_history" ("targetType","targetId","communityId","platformId","slug")
    VALUES ('FLEET','00000000-0000-0000-0000-0000000000e4','00000000-0000-0000-0000-0000000000d1',
            '00000000-0000-0000-0000-0000000000b1','old-omega')$$);

SELECT pg_temp.expect_rejected(
  'twice in the same Community and platform is refused',
  $$INSERT INTO "fleet_slug_history" ("targetType","targetId","communityId","platformId","slug")
    VALUES ('FLEET','00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000d1',
            '00000000-0000-0000-0000-0000000000b1','old-omega')$$,
  '23505');

SELECT pg_temp.expect_accepted(
  'the same retired slug on another platform is a different name',
  $$INSERT INTO "fleet_slug_history" ("targetType","targetId","communityId","platformId","slug")
    VALUES ('FLEET','00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000d1',
            '00000000-0000-0000-0000-0000000000b2','old-omega')$$);

SELECT pg_temp.expect_accepted(
  'and so is the same one in another Community',
  $$INSERT INTO "fleet_slug_history" ("targetType","targetId","communityId","platformId","slug")
    VALUES ('FLEET','00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000d2',
            '00000000-0000-0000-0000-0000000000b1','old-omega')$$);

-- An Armada and a Fleet are different kinds, so one retiring a name does not
-- reserve it against the other. They are addressed by different URL roots.
SELECT pg_temp.expect_accepted(
  'an Armada may retire a name a Fleet retired',
  $$INSERT INTO "fleet_slug_history" ("targetType","targetId","communityId","platformId","slug")
    VALUES ('ARMADA','00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000d1',
            '00000000-0000-0000-0000-0000000000b1','old-omega')$$);

SELECT pg_temp.expect_rejected(
  'history cannot point at a Community that does not exist',
  $$INSERT INTO "fleet_slug_history" ("targetType","targetId","communityId","platformId","slug")
    VALUES ('FLEET','00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000dd',
            '00000000-0000-0000-0000-0000000000b1','orphan')$$,
  '23503');

-- Two statements rather than one. A `DELETE` in a CTE and a `SELECT` reading
-- the result sit in the same snapshot, so the count would report what was
-- there before the delete and the assertion would pass or fail for the wrong
-- reason.
SELECT pg_temp.expect_accepted(
  'a Community with nothing restricting it can be hard-deleted',
  $$DELETE FROM "fleet_community" WHERE "id" = '00000000-0000-0000-0000-0000000000d2'$$);

SELECT pg_temp.expect_true(
  'and it takes its scopes'' retired slugs with it',
  $$SELECT count(*) = 0 FROM "fleet_slug_history"
     WHERE "communityId" = '00000000-0000-0000-0000-0000000000d2'$$);

------------------------------------------------------------------------------
-- Clearing up after the first section, so the rollback has a fair test.
--
-- The `down` of 1792700000000 narrows the unique key back to (Community, slug)
-- and is meant to fail when two live rows would collide under it. The rows
-- proving the wider key works are exactly that case, so they are removed here:
-- leaving them would turn a correct refusal into a failed rehearsal.
------------------------------------------------------------------------------
DELETE FROM "sto_fleet" WHERE "id" = '00000000-0000-0000-0000-0000000000e2';
DELETE FROM "sto_armada" WHERE "id" = '00000000-0000-0000-0000-0000000000f2';

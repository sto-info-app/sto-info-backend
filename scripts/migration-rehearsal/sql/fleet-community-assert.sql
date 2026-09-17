SET search_path TO "sto_info_app";

-- Quiet: every helper returns void, so the result tables carry no information.
\pset tuples_only on
\pset format unaligned


-- Every assertion below is a deliberate attempt to break an FC-004 acceptance
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
-- AC1: duplicate game name/platform records coexist; scoped URLs are unique.
------------------------------------------------------------------------------
SELECT pg_temp.expect_accepted(
  'AC1 a second Community may record the same in-game Fleet',
  $$INSERT INTO "sto_fleet" ("communityId", "platformId", "exactGameName", "exactGameNameNormalized", "slug")
    VALUES ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b1',
            'Starfleet Vanguard', 'starfleet vanguard', 'vanguard-copy')$$);

SELECT pg_temp.expect_rejected(
  'AC1 a Fleet slug is unique within its Community',
  $$INSERT INTO "sto_fleet" ("communityId", "platformId", "exactGameName", "exactGameNameNormalized", "slug")
    VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1',
            'Different Name', 'different name', 'starfleet-vanguard')$$, '23505');

SELECT pg_temp.expect_accepted(
  'AC1 the same slug is free in another Community',
  $$INSERT INTO "sto_fleet" ("communityId", "platformId", "exactGameName", "exactGameNameNormalized", "slug")
    VALUES ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b1',
            'Third Name', 'third name', 'starfleet-vanguard')$$);

SELECT pg_temp.expect_rejected(
  'AC1 a slug must already be lowercase',
  $$INSERT INTO "fleet_community" ("ownerUserId", "name", "slug")
    VALUES ('00000000-0000-0000-0000-0000000000a1', 'Mixed Case', 'Mixed-Case')$$, '23514');

SELECT pg_temp.expect_accepted(
  'AC1 a Community slug is reusable once the Community is soft-deleted',
  $$UPDATE "fleet_community" SET "deletedAt" = now() WHERE "slug" = 'second-wave'$$);
SELECT pg_temp.expect_accepted(
  'AC1 ... and the freed slug can be taken',
  $$INSERT INTO "fleet_community" ("ownerUserId", "name", "slug")
    VALUES ('00000000-0000-0000-0000-0000000000a1', 'Second Wave Revived', 'second-wave')$$);
SELECT pg_temp.expect_accepted(
  'AC1 restore the soft-deleted Community for the remaining tests',
  $$DELETE FROM "fleet_community" WHERE "name" = 'Second Wave Revived';
    UPDATE "fleet_community" SET "deletedAt" = NULL WHERE "slug" = 'second-wave'$$);

------------------------------------------------------------------------------
-- AC2: one current personal membership per Character, one current Armada
-- membership per Fleet.
------------------------------------------------------------------------------
SELECT pg_temp.expect_accepted(
  'AC2 a Character may have one open Fleet membership',
  $$INSERT INTO "character_fleet_membership" ("characterId", "fleetId", "validFrom")
    VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1', '2026-01-01T00:00:00Z')$$);

SELECT pg_temp.expect_rejected(
  'AC2 a second open membership for the same Character is refused',
  $$INSERT INTO "character_fleet_membership" ("characterId", "fleetId", "validFrom")
    VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e2', '2026-02-01T00:00:00Z')$$, '23505');

SELECT pg_temp.expect_accepted(
  'AC2 closing the open interval frees the Character to move Fleet',
  $$UPDATE "character_fleet_membership" SET "validTo" = '2026-02-01T00:00:00Z'
      WHERE "characterId" = '00000000-0000-0000-0000-0000000000c1' AND "validTo" IS NULL;
    INSERT INTO "character_fleet_membership" ("characterId", "fleetId", "validFrom")
    VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e2', '2026-02-01T00:00:00Z')$$);

SELECT pg_temp.expect_rejected(
  'AC2 an interval that ends before it starts is refused',
  $$INSERT INTO "character_fleet_membership" ("characterId", "fleetId", "validFrom", "validTo")
    VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1',
            '2026-05-01T00:00:00Z', '2026-04-01T00:00:00Z')$$, '23514');

SELECT pg_temp.expect_accepted(
  'AC2 a Fleet may be the Alpha of an Armada',
  $$INSERT INTO "armada_fleet_membership" ("communityId", "armadaId", "fleetId", "position", "validFrom")
    VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1',
            '00000000-0000-0000-0000-0000000000e1', 'ALPHA', '2026-01-01T00:00:00Z')$$);

SELECT pg_temp.expect_rejected(
  'AC2 a second open Armada association for the same Fleet is refused',
  $$INSERT INTO "armada_fleet_membership" ("communityId", "armadaId", "fleetId", "position", "parentMembershipId", "validFrom")
    SELECT '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1',
           '00000000-0000-0000-0000-0000000000e1', 'BETA', "id", '2026-03-01T00:00:00Z'
      FROM "armada_fleet_membership" WHERE "position" = 'ALPHA' LIMIT 1$$, '23505');

SELECT pg_temp.expect_rejected(
  'AC2 a second open Alpha in the same Armada is refused',
  $$INSERT INTO "armada_fleet_membership" ("communityId", "armadaId", "fleetId", "position", "validFrom")
    VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1',
            '00000000-0000-0000-0000-0000000000e4', 'ALPHA', '2026-01-01T00:00:00Z')$$, '23505');

SELECT pg_temp.expect_rejected(
  'AC2 a Beta without a parent association is refused',
  $$INSERT INTO "armada_fleet_membership" ("communityId", "armadaId", "fleetId", "position", "validFrom")
    VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1',
            '00000000-0000-0000-0000-0000000000e4', 'BETA', '2026-01-01T00:00:00Z')$$, '23514');

SELECT pg_temp.expect_rejected(
  'AC2 an Alpha with a parent association is refused',
  $$INSERT INTO "armada_fleet_membership" ("communityId", "armadaId", "fleetId", "position", "parentMembershipId", "validFrom")
    SELECT '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1',
           '00000000-0000-0000-0000-0000000000e4', 'ALPHA', "id", '2026-01-01T00:00:00Z'
      FROM "armada_fleet_membership" WHERE "position" = 'ALPHA' LIMIT 1$$, '23514');

------------------------------------------------------------------------------
-- AC3: a Fleet can exist without an Armada; historical links survive closure.
------------------------------------------------------------------------------
SELECT pg_temp.expect_true(
  'AC3 a Fleet exists with no Armada association at all',
  $$SELECT EXISTS (SELECT 1 FROM "sto_fleet" f
      WHERE NOT EXISTS (SELECT 1 FROM "armada_fleet_membership" m WHERE m."fleetId" = f."id"))$$);

SELECT pg_temp.expect_accepted(
  'AC3 an Armada can be closed rather than deleted',
  $$UPDATE "sto_armada" SET "status" = 'CLOSED', "closedAt" = now()
      WHERE "id" = '00000000-0000-0000-0000-0000000000f1'$$);

SELECT pg_temp.expect_true(
  'AC3 the historical Armada link survives that closure',
  $$SELECT EXISTS (SELECT 1 FROM "armada_fleet_membership"
      WHERE "armadaId" = '00000000-0000-0000-0000-0000000000f1')$$);

SELECT pg_temp.expect_accepted(
  'AC3 ownership transfers by changing the owner, leaving history intact',
  $$UPDATE "fleet_community" SET "ownerUserId" = '00000000-0000-0000-0000-0000000000a2'
      WHERE "id" = '00000000-0000-0000-0000-0000000000d1'$$);
SELECT pg_temp.expect_true(
  'AC3 the Armada link still exists after the transfer',
  $$SELECT EXISTS (SELECT 1 FROM "armada_fleet_membership"
      WHERE "armadaId" = '00000000-0000-0000-0000-0000000000f1')$$);
SELECT pg_temp.expect_accepted(
  'AC3 transfer the Community back',
  $$UPDATE "fleet_community" SET "ownerUserId" = '00000000-0000-0000-0000-0000000000a1'
      WHERE "id" = '00000000-0000-0000-0000-0000000000d1'$$);

SELECT pg_temp.expect_rejected(
  'AC3 the account behind a live Community cannot simply be deleted',
  $$DELETE FROM "user" WHERE "id" = '00000000-0000-0000-0000-0000000000a1'$$, '23503');

SELECT pg_temp.expect_rejected(
  'AC3 a Fleet with personal history cannot be hard-deleted',
  $$DELETE FROM "sto_fleet" WHERE "id" = '00000000-0000-0000-0000-0000000000e2'$$, '23503');

------------------------------------------------------------------------------
-- AC4: cross-community references cannot be made.
------------------------------------------------------------------------------
SELECT pg_temp.expect_rejected(
  'AC4 another Community''s Fleet cannot be placed in this Armada',
  $$INSERT INTO "armada_fleet_membership" ("communityId", "armadaId", "fleetId", "position", "parentMembershipId", "validFrom")
    SELECT '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1',
           '00000000-0000-0000-0000-0000000000e2', 'BETA', "id", '2026-01-01T00:00:00Z'
      FROM "armada_fleet_membership" WHERE "position" = 'ALPHA' LIMIT 1$$, '23503');

SELECT pg_temp.expect_rejected(
  'AC4 an unregistered Fleet cannot be placed in an Armada',
  $$INSERT INTO "armada_fleet_membership" ("communityId", "armadaId", "fleetId", "position", "parentMembershipId", "validFrom")
    SELECT '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1',
           '00000000-0000-0000-0000-0000000000e3', 'BETA', "id", '2026-01-01T00:00:00Z'
      FROM "armada_fleet_membership" WHERE "position" = 'ALPHA' LIMIT 1$$, '23503');

SELECT pg_temp.expect_rejected(
  'AC4 a membership cannot name another Community''s Fleet',
  $$INSERT INTO "scope_membership" ("communityId", "fleetId", "userId")
    VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e2',
            '00000000-0000-0000-0000-0000000000a1')$$, '23503');

SELECT pg_temp.expect_rejected(
  'AC4 a role grant cannot name another Community''s Armada',
  $$INSERT INTO "scope_role_assignment" ("communityId", "armadaId", "userId", "role")
    VALUES ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000f1',
            '00000000-0000-0000-0000-0000000000a1', 'ADMIN')$$, '23503');

SELECT pg_temp.expect_rejected(
  'AC4 a membership cannot be at two scopes at once',
  $$INSERT INTO "scope_membership" ("communityId", "fleetId", "armadaId", "userId")
    VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1',
            '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1')$$, '23514');

SELECT pg_temp.expect_accepted(
  'AC4 a Community-scoped membership needs neither child ID',
  $$INSERT INTO "scope_membership" ("communityId", "userId", "status")
    VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'APPROVED')$$);

SELECT pg_temp.expect_rejected(
  'AC4 a second live membership at the same scope is refused',
  $$INSERT INTO "scope_membership" ("communityId", "userId")
    VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1')$$, '23505');

------------------------------------------------------------------------------
-- ADR-0002: following grants nothing, and is its own relationship.
------------------------------------------------------------------------------
SELECT pg_temp.expect_accepted(
  'ADR-0002 a user may follow a Community',
  $$INSERT INTO "community_subscription" ("communityId", "userId")
    VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a2')$$);

SELECT pg_temp.expect_rejected(
  'ADR-0002 following twice at once is refused',
  $$INSERT INTO "community_subscription" ("communityId", "userId")
    VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a2')$$, '23505');

SELECT pg_temp.expect_accepted(
  'ADR-0002 leaving and following again is allowed',
  $$UPDATE "community_subscription" SET "leftAt" = now()
      WHERE "userId" = '00000000-0000-0000-0000-0000000000a2' AND "leftAt" IS NULL;
    INSERT INTO "community_subscription" ("communityId", "userId")
    VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a2')$$);

SELECT pg_temp.expect_true(
  'ADR-0002 following carries no role and no approved membership',
  $$SELECT NOT EXISTS (
      SELECT 1 FROM "community_subscription" s
        JOIN "scope_role_assignment" r ON r."userId" = s."userId" AND r."communityId" = s."communityId"
      WHERE s."userId" = '00000000-0000-0000-0000-0000000000a2')$$);

------------------------------------------------------------------------------
-- ADR-0007: every instant really is timestamp with time zone.
------------------------------------------------------------------------------
SELECT pg_temp.expect_true(
  'ADR-0007 no Fleet table has a naive timestamp column',
  $$SELECT NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'sto_info_app'
         AND table_name IN ('fleet_community','sto_fleet','sto_armada','fleet_name_alias',
                            'armada_fleet_membership','community_subscription','scope_membership',
                            'scope_role_assignment','character_fleet_membership')
         AND data_type = 'timestamp without time zone')$$);

SELECT pg_temp.expect_true(
  'ADR-0007 every Fleet table has at least one timestamptz column',
  $$SELECT count(DISTINCT table_name) = 9 FROM information_schema.columns
     WHERE table_schema = 'sto_info_app'
       AND data_type = 'timestamp with time zone'
       AND table_name IN ('fleet_community','sto_fleet','sto_armada','fleet_name_alias',
                          'armada_fleet_membership','community_subscription','scope_membership',
                          'scope_role_assignment','character_fleet_membership')$$);

\echo 'ALL FC-004 DATABASE ASSERTIONS PASSED'

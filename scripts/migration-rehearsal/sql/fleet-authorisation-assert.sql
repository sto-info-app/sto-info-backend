SET search_path TO "sto_info_app";

-- Quiet: every helper returns void, so the result tables carry no information.
\pset tuples_only on
\pset format unaligned


-- Every assertion below is a deliberate attempt to break an FC-005 acceptance
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
-- AC3: a delegation names a role or a person, never both and never neither.
------------------------------------------------------------------------------
SELECT pg_temp.expect_accepted(
  'AC3 a capability may be delegated to a role at a Fleet',
  $$INSERT INTO "scope_capability_grant" ("communityId", "fleetId", "subjectRole", "capability", "effect")
    VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1',
            'OFFICER', 'roster.import', 'GRANT')$$);

SELECT pg_temp.expect_accepted(
  'AC3 a capability may be delegated to one person at a Fleet',
  $$INSERT INTO "scope_capability_grant" ("communityId", "fleetId", "subjectUserId", "capability", "effect")
    VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1',
            '00000000-0000-0000-0000-0000000000a3', 'chat.transcript.export', 'GRANT')$$);

SELECT pg_temp.expect_rejected(
  'AC3 a delegation naming both a role and a person is refused',
  $$INSERT INTO "scope_capability_grant" ("communityId", "fleetId", "subjectUserId", "subjectRole", "capability", "effect")
    VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1',
            '00000000-0000-0000-0000-0000000000a3', 'OFFICER', 'news.write', 'GRANT')$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'AC3 a delegation naming nobody is refused',
  $$INSERT INTO "scope_capability_grant" ("communityId", "fleetId", "capability", "effect")
    VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1',
            'news.write', 'GRANT')$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'AC3 a delegation naming both a Fleet and an Armada is refused',
  $$INSERT INTO "scope_capability_grant" ("communityId", "fleetId", "armadaId", "subjectRole", "capability", "effect")
    VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1',
            '00000000-0000-0000-0000-0000000000f1', 'ADMIN', 'news.write', 'GRANT')$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'AC3 a delegation that ends before it starts is refused',
  $$INSERT INTO "scope_capability_grant" ("communityId", "fleetId", "subjectRole", "capability", "effect", "validFrom", "validTo")
    VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1',
            'ADMIN', 'news.write', 'GRANT', now(), now() - interval '1 day')$$,
  '23514');

------------------------------------------------------------------------------
-- AC1: deny wins, and a contradiction cannot be stored in the first place.
------------------------------------------------------------------------------
SELECT pg_temp.expect_rejected(
  'AC1 a second open grant of the same capability to the same role is refused',
  $$INSERT INTO "scope_capability_grant" ("communityId", "fleetId", "subjectRole", "capability", "effect")
    VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1',
            'OFFICER', 'roster.import', 'GRANT')$$,
  '23505');

SELECT pg_temp.expect_rejected(
  'AC1 an open DENY contradicting an open GRANT is refused',
  $$INSERT INTO "scope_capability_grant" ("communityId", "fleetId", "subjectRole", "capability", "effect")
    VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1',
            'OFFICER', 'roster.import', 'DENY')$$,
  '23505');

SELECT pg_temp.expect_accepted(
  'AC1 closing the grant frees the slot for a DENY',
  $$UPDATE "scope_capability_grant" SET "validTo" = now()
     WHERE "fleetId" = '00000000-0000-0000-0000-0000000000e1'
       AND "subjectRole" = 'OFFICER' AND "capability" = 'roster.import'$$);

SELECT pg_temp.expect_accepted(
  'AC1 the withdrawal is recorded rather than the history deleted',
  $$INSERT INTO "scope_capability_grant" ("communityId", "fleetId", "subjectRole", "capability", "effect")
    VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1',
            'OFFICER', 'roster.import', 'DENY')$$);

SELECT pg_temp.expect_true(
  'AC1 both the old grant and the new denial survive',
  $$SELECT count(*) = 2 FROM "scope_capability_grant"
     WHERE "fleetId" = '00000000-0000-0000-0000-0000000000e1'
       AND "subjectRole" = 'OFFICER' AND "capability" = 'roster.import'$$);

SELECT pg_temp.expect_accepted(
  'AC1 a soft delete frees the open slot',
  $$UPDATE "scope_capability_grant" SET "deletedAt" = now()
     WHERE "fleetId" = '00000000-0000-0000-0000-0000000000e1'
       AND "subjectRole" = 'OFFICER' AND "capability" = 'roster.import'
       AND "effect" = 'DENY'$$);

SELECT pg_temp.expect_accepted(
  'AC1 the capability may then be granted again',
  $$INSERT INTO "scope_capability_grant" ("communityId", "fleetId", "subjectRole", "capability", "effect")
    VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1',
            'OFFICER', 'roster.import', 'GRANT')$$);

------------------------------------------------------------------------------
-- AC4: a delegation cannot reach into another Community, and a Fleet-scoped
-- one does not collide with a Community-scoped or sibling-scoped one.
------------------------------------------------------------------------------
SELECT pg_temp.expect_rejected(
  $$AC4 a delegation naming another Community's Fleet is refused$$,
  $$INSERT INTO "scope_capability_grant" ("communityId", "fleetId", "subjectRole", "capability", "effect")
    VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e2',
            'ADMIN', 'roster.view', 'GRANT')$$,
  '23503');

SELECT pg_temp.expect_rejected(
  $$AC4 a delegation naming another Community's Armada is refused$$,
  $$INSERT INTO "scope_capability_grant" ("communityId", "armadaId", "subjectRole", "capability", "effect")
    VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f2',
            'ADMIN', 'armada.manage', 'GRANT')$$,
  '23503');

SELECT pg_temp.expect_rejected(
  'AC4 a delegation on an unregistered Fleet has nothing to reference',
  $$INSERT INTO "scope_capability_grant" ("communityId", "fleetId", "subjectRole", "capability", "effect")
    VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e3',
            'ADMIN', 'roster.view', 'GRANT')$$,
  '23503');

SELECT pg_temp.expect_accepted(
  'AC4 the same capability may be delegated at the Community and at a Fleet',
  $$INSERT INTO "scope_capability_grant" ("communityId", "subjectUserId", "capability", "effect")
    VALUES ('00000000-0000-0000-0000-0000000000d1',
            '00000000-0000-0000-0000-0000000000a3', 'chat.transcript.export', 'GRANT')$$);

SELECT pg_temp.expect_accepted(
  'AC4 the same capability may be delegated at two sibling Fleets',
  $$INSERT INTO "scope_capability_grant" ("communityId", "fleetId", "subjectUserId", "capability", "effect")
    VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e4',
            '00000000-0000-0000-0000-0000000000a3', 'chat.transcript.export', 'GRANT')$$);

SELECT pg_temp.expect_rejected(
  'AC4 a second open Community-wide grant to the same person is refused',
  $$INSERT INTO "scope_capability_grant" ("communityId", "subjectUserId", "capability", "effect")
    VALUES ('00000000-0000-0000-0000-0000000000d1',
            '00000000-0000-0000-0000-0000000000a3', 'chat.transcript.export', 'DENY')$$,
  '23505');

SELECT pg_temp.expect_accepted(
  'AC4 an Armada-scoped delegation is accepted in its own Community',
  $$INSERT INTO "scope_capability_grant" ("communityId", "armadaId", "subjectRole", "capability", "effect")
    VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1',
            'ADMIN', 'armada.manage', 'GRANT')$$);

SELECT pg_temp.expect_rejected(
  'AC4 a second open Armada-scoped delegation to the same role is refused',
  $$INSERT INTO "scope_capability_grant" ("communityId", "armadaId", "subjectRole", "capability", "effect")
    VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1',
            'ADMIN', 'armada.manage', 'DENY')$$,
  '23505');

------------------------------------------------------------------------------
-- The audit trail: who delegated it survives their account, the delegation
-- itself does not survive the Community it was made in.
------------------------------------------------------------------------------
SELECT pg_temp.expect_accepted(
  'audit a delegation records who made it and why',
  $$INSERT INTO "scope_capability_grant" ("communityId", "fleetId", "subjectRole", "capability", "effect", "grantedByUserId", "reason")
    VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1',
            'ADMIN', 'holdings.write', 'GRANT', '00000000-0000-0000-0000-0000000000a4',
            'Trialling delegated holdings for the quarter')$$);

SELECT pg_temp.expect_accepted(
  'audit the account that made a delegation may still be deleted',
  $$DELETE FROM "user" WHERE "id" = '00000000-0000-0000-0000-0000000000a4'$$);

SELECT pg_temp.expect_true(
  'audit the delegation survives, with the actor forgotten',
  $$SELECT "grantedByUserId" IS NULL AND "reason" IS NOT NULL
      FROM "scope_capability_grant"
     WHERE "fleetId" = '00000000-0000-0000-0000-0000000000e1'
       AND "capability" = 'holdings.write'$$);

SELECT pg_temp.expect_accepted(
  'audit a capability code the application no longer knows is still storable',
  $$INSERT INTO "scope_capability_grant" ("communityId", "fleetId", "subjectRole", "capability", "effect")
    VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1',
            'MEMBER', 'roster.teleport', 'GRANT')$$);

SELECT pg_temp.expect_true(
  'AC4 the sibling Fleet has a delegation to lose',
  $$SELECT count(*) > 0 FROM "scope_capability_grant"
     WHERE "fleetId" = '00000000-0000-0000-0000-0000000000e4'$$);

SELECT pg_temp.expect_accepted(
  'AC4 a Fleet may be removed',
  $$DELETE FROM "sto_fleet" WHERE "id" = '00000000-0000-0000-0000-0000000000e4'$$);

SELECT pg_temp.expect_true(
  'AC4 removing the Fleet took its delegations with it',
  $$SELECT count(*) = 0 FROM "scope_capability_grant"
     WHERE "fleetId" = '00000000-0000-0000-0000-0000000000e4'$$);

-- FC-004 made sto_fleet.communityId RESTRICT on purpose: a Community is closed
-- by a status change, and hard-deleting one that still holds Fleets would take
-- their roster history with it. Asserted here because a later migration that
-- softened it to CASCADE would turn every delegation above into collateral.
SELECT pg_temp.expect_rejected(
  'AC4 a Community still holding Fleets cannot be deleted out from under them',
  $$DELETE FROM "fleet_community" WHERE "id" = '00000000-0000-0000-0000-0000000000d1'$$,
  '23503');

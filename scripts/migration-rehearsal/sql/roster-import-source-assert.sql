SET search_path TO "sto_info_app";

-- Quiet: every helper returns void, so the result tables carry no information.
\pset tuples_only on
\pset format unaligned


-- Every assertion below is a deliberate attempt to break a rule FC-009 claims
-- the database enforces. `expect_rejected` fails the run if it gets through.
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
-- RESTRICT raises 23001; an orphan insert, and a delete blocked by NO ACTION,
-- still raise 23503.

------------------------------------------------------------------------------
-- One provenance row per asset.
--
-- Two rows would mean two answers to "which file did these bytes come from",
-- and an investigator reading either one would have no way to tell.
------------------------------------------------------------------------------
SELECT pg_temp.expect_accepted(
  'a second asset may have its own provenance',
  $$INSERT INTO "fleet_roster_import_source"
      ("assetId","fleetId","uploadedByUserId","originalFilename","sourceSha256","sanitisedSha256",
       "sourceByteSize","sanitisedByteSize","sourceHeaderShape","rowCount","officerTailRowCount","parserVersion")
    VALUES ('00000000-0000-0000-0000-0000000aa002','00000000-0000-0000-0000-0000000ea001',
            '00000000-0000-0000-0000-0000000fa002','Import Fleet_20240202-120000.Csv',
            repeat('3',64), repeat('4',64), 4096, 1024, 'NORMAL', 40, 0, 1)$$);

SELECT pg_temp.expect_rejected(
  'one asset cannot have two provenance rows',
  $$INSERT INTO "fleet_roster_import_source"
      ("assetId","fleetId","originalFilename","sourceSha256","sanitisedSha256",
       "sourceByteSize","sanitisedByteSize","sourceHeaderShape","rowCount","officerTailRowCount","parserVersion")
    VALUES ('00000000-0000-0000-0000-0000000aa001','00000000-0000-0000-0000-0000000ea001',
            'Duplicate.Csv', repeat('5',64), repeat('6',64), 10, 10, 'NORMAL', 1, 0, 1)$$,
  '23505');

------------------------------------------------------------------------------
-- The hashes are hashes.
--
-- The source hash is the only evidence connecting an import to the file that
-- was uploaded, because the file itself is gone. A malformed one is worse than
-- none: it looks like evidence and answers nothing.
------------------------------------------------------------------------------
SELECT pg_temp.expect_rejected(
  'a source hash that is not hexadecimal is refused',
  $$UPDATE "fleet_roster_import_source" SET "sourceSha256" = repeat('z', 64)
    WHERE "id" = '00000000-0000-0000-0000-0000000ba001'$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'an upper-case source hash is refused',
  $$INSERT INTO "fleet_roster_import_source"
      ("assetId","fleetId","originalFilename","sourceSha256","sanitisedSha256",
       "sourceByteSize","sanitisedByteSize","sourceHeaderShape","rowCount","officerTailRowCount","parserVersion")
    VALUES ('00000000-0000-0000-0000-0000000aa003','00000000-0000-0000-0000-0000000ea001',
            'Upper.Csv', repeat('A',64), repeat('7',64), 10, 10, 'NORMAL', 1, 0, 1)$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'a sanitised hash that is not hexadecimal is refused',
  $$INSERT INTO "fleet_roster_import_source"
      ("assetId","fleetId","originalFilename","sourceSha256","sanitisedSha256",
       "sourceByteSize","sanitisedByteSize","sourceHeaderShape","rowCount","officerTailRowCount","parserVersion")
    VALUES ('00000000-0000-0000-0000-0000000aa003','00000000-0000-0000-0000-0000000ea001',
            'Bad.Csv', repeat('8',64), 'not a hash', 10, 10, 'NORMAL', 1, 0, 1)$$,
  '23514');

------------------------------------------------------------------------------
-- The counts are counts.
------------------------------------------------------------------------------
SELECT pg_temp.expect_rejected(
  'an empty source is refused',
  $$INSERT INTO "fleet_roster_import_source"
      ("assetId","fleetId","originalFilename","sourceSha256","sanitisedSha256",
       "sourceByteSize","sanitisedByteSize","sourceHeaderShape","rowCount","officerTailRowCount","parserVersion")
    VALUES ('00000000-0000-0000-0000-0000000aa003','00000000-0000-0000-0000-0000000ea001',
            'Empty.Csv', repeat('8',64), repeat('9',64), 0, 10, 'NORMAL', 1, 0, 1)$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'an empty sanitised file is refused',
  $$INSERT INTO "fleet_roster_import_source"
      ("assetId","fleetId","originalFilename","sourceSha256","sanitisedSha256",
       "sourceByteSize","sanitisedByteSize","sourceHeaderShape","rowCount","officerTailRowCount","parserVersion")
    VALUES ('00000000-0000-0000-0000-0000000aa003','00000000-0000-0000-0000-0000000ea001',
            'Empty.Csv', repeat('8',64), repeat('9',64), 10, 0, 'NORMAL', 1, 0, 1)$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'a negative row count is refused',
  $$UPDATE "fleet_roster_import_source" SET "rowCount" = -1
    WHERE "id" = '00000000-0000-0000-0000-0000000ba001'$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'more officer notes than rows is refused',
  $$UPDATE "fleet_roster_import_source" SET "officerTailRowCount" = 94
    WHERE "id" = '00000000-0000-0000-0000-0000000ba001'$$,
  '23514');

-- The one that would otherwise pass unnoticed. A twelve-column export has no
-- officer columns to discard, so a non-zero count against a NORMAL header
-- means the parser and the record disagree about what arrived.
SELECT pg_temp.expect_rejected(
  'officer notes discarded from a twelve-column export is refused',
  $$INSERT INTO "fleet_roster_import_source"
      ("assetId","fleetId","originalFilename","sourceSha256","sanitisedSha256",
       "sourceByteSize","sanitisedByteSize","sourceHeaderShape","rowCount","officerTailRowCount","parserVersion")
    VALUES ('00000000-0000-0000-0000-0000000aa003','00000000-0000-0000-0000-0000000ea001',
            'Normal.Csv', repeat('8',64), repeat('9',64), 10, 10, 'NORMAL', 5, 1, 1)$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'a parser version below one is refused',
  $$INSERT INTO "fleet_roster_import_source"
      ("assetId","fleetId","originalFilename","sourceSha256","sanitisedSha256",
       "sourceByteSize","sanitisedByteSize","sourceHeaderShape","rowCount","officerTailRowCount","parserVersion")
    VALUES ('00000000-0000-0000-0000-0000000aa003','00000000-0000-0000-0000-0000000ea001',
            'Unversioned.Csv', repeat('8',64), repeat('9',64), 10, 10, 'NORMAL', 5, 0, 0)$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'a blank filename is refused',
  $$INSERT INTO "fleet_roster_import_source"
      ("assetId","fleetId","originalFilename","sourceSha256","sanitisedSha256",
       "sourceByteSize","sanitisedByteSize","sourceHeaderShape","rowCount","officerTailRowCount","parserVersion")
    VALUES ('00000000-0000-0000-0000-0000000aa003','00000000-0000-0000-0000-0000000ea001',
            '   ', repeat('8',64), repeat('9',64), 10, 10, 'NORMAL', 5, 0, 1)$$,
  '23514');

------------------------------------------------------------------------------
-- Provenance is write-once.
--
-- The row is the answer to "what was actually uploaded". An answer that can be
-- edited afterwards is not evidence, and there is no legitimate reason for any
-- of these to change: a correction means a new import, not a rewritten record.
------------------------------------------------------------------------------
SELECT pg_temp.expect_rejected(
  'the source hash cannot be changed',
  $$UPDATE "fleet_roster_import_source" SET "sourceSha256" = repeat('f', 64)
    WHERE "id" = '00000000-0000-0000-0000-0000000ba001'$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'the sanitised hash cannot be changed',
  $$UPDATE "fleet_roster_import_source" SET "sanitisedSha256" = repeat('f', 64)
    WHERE "id" = '00000000-0000-0000-0000-0000000ba001'$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'the asset cannot be pointed somewhere else',
  $$UPDATE "fleet_roster_import_source" SET "assetId" = '00000000-0000-0000-0000-0000000aa003'
    WHERE "id" = '00000000-0000-0000-0000-0000000ba001'$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'the import cannot be moved to another Fleet',
  $$UPDATE "fleet_roster_import_source" SET "fleetId" = '00000000-0000-0000-0000-0000000ea002'
    WHERE "id" = '00000000-0000-0000-0000-0000000ba001'$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'the filename cannot be rewritten',
  $$UPDATE "fleet_roster_import_source" SET "originalFilename" = 'Something Else.Csv'
    WHERE "id" = '00000000-0000-0000-0000-0000000ba001'$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'the recorded header shape cannot be changed',
  $$UPDATE "fleet_roster_import_source" SET "sourceHeaderShape" = 'NORMAL'
    WHERE "id" = '00000000-0000-0000-0000-0000000ba001'$$,
  '23514');

-- Added by FC-011, and the reason it is asserted rather than assumed is that
-- the guard names its columns one by one: a column added to the table and
-- forgotten in the trigger is silently editable, and this is the one column
-- here that records what somebody else claimed rather than what this
-- application measured.
SELECT pg_temp.expect_true(
  'what the browser called it survives beside what the bytes were',
  $$SELECT "declaredContentType" = 'application/vnd.ms-excel'
     FROM "fleet_roster_import_source"
     WHERE "id" = '00000000-0000-0000-0000-0000000ba001'$$);

SELECT pg_temp.expect_rejected(
  'the claimed content type cannot be rewritten',
  $$UPDATE "fleet_roster_import_source" SET "declaredContentType" = 'text/csv'
    WHERE "id" = '00000000-0000-0000-0000-0000000ba001'$$,
  '23514');

-- Aimed at the row that has one. The guard compares with IS DISTINCT FROM,
-- so writing null over a row that was already null changes nothing and is
-- rightly allowed — an assertion against one of those would pass whatever
-- the trigger said.
SELECT pg_temp.expect_rejected(
  'the claimed content type cannot be quietly removed',
  $$UPDATE "fleet_roster_import_source" SET "declaredContentType" = NULL
    WHERE "id" = '00000000-0000-0000-0000-0000000ba001'$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'the parser version cannot be rewritten',
  $$UPDATE "fleet_roster_import_source" SET "parserVersion" = 2
    WHERE "id" = '00000000-0000-0000-0000-0000000ba001'$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'the upload time cannot be backdated',
  $$UPDATE "fleet_roster_import_source" SET "uploadedAt" = now() - interval '1 year'
    WHERE "id" = '00000000-0000-0000-0000-0000000ba001'$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'the received size cannot be changed',
  $$UPDATE "fleet_roster_import_source" SET "sourceByteSize" = 1
    WHERE "id" = '00000000-0000-0000-0000-0000000ba001'$$,
  '23514');

SELECT pg_temp.expect_rejected(
  'the retained size cannot be changed',
  $$UPDATE "fleet_roster_import_source" SET "sanitisedByteSize" = 1
    WHERE "id" = '00000000-0000-0000-0000-0000000ba001'$$,
  '23514');

-- The counts stay mutable. A recount is a correction to a derived figure, not
-- to the record of what was uploaded, and FC-017 may need to make one.
SELECT pg_temp.expect_accepted(
  'a row count may be corrected',
  $$UPDATE "fleet_roster_import_source" SET "rowCount" = 94
    WHERE "id" = '00000000-0000-0000-0000-0000000ba001'$$);

------------------------------------------------------------------------------
-- What the row points at has to exist, and cannot be quietly removed.
------------------------------------------------------------------------------
SELECT pg_temp.expect_rejected(
  'provenance for an asset that does not exist is refused',
  $$INSERT INTO "fleet_roster_import_source"
      ("assetId","fleetId","originalFilename","sourceSha256","sanitisedSha256",
       "sourceByteSize","sanitisedByteSize","sourceHeaderShape","rowCount","officerTailRowCount","parserVersion")
    VALUES ('00000000-0000-0000-0000-00000000dead','00000000-0000-0000-0000-0000000ea001',
            'Ghost.Csv', repeat('8',64), repeat('9',64), 10, 10, 'NORMAL', 1, 0, 1)$$,
  '23503');

SELECT pg_temp.expect_rejected(
  'provenance for a Fleet that does not exist is refused',
  $$INSERT INTO "fleet_roster_import_source"
      ("assetId","fleetId","originalFilename","sourceSha256","sanitisedSha256",
       "sourceByteSize","sanitisedByteSize","sourceHeaderShape","rowCount","officerTailRowCount","parserVersion")
    VALUES ('00000000-0000-0000-0000-0000000aa003','00000000-0000-0000-0000-00000000dead',
            'Ghost.Csv', repeat('8',64), repeat('9',64), 10, 10, 'NORMAL', 1, 0, 1)$$,
  '23503');

SELECT pg_temp.expect_rejected(
  'the asset cannot be deleted while its provenance stands',
  $$DELETE FROM "file_asset" WHERE "id" = '00000000-0000-0000-0000-0000000aa001'$$,
  '23001'); -- ON DELETE RESTRICT: 23001 on PostgreSQL 18

SELECT pg_temp.expect_rejected(
  'the Fleet cannot be deleted while an import references it',
  $$DELETE FROM "sto_fleet" WHERE "id" = '00000000-0000-0000-0000-0000000ea001'$$,
  '23001'); -- ON DELETE RESTRICT: 23001 on PostgreSQL 18

-- Deleting the uploader severs the personal link and keeps the evidence, the
-- same way file_asset does. Losing the record of an import because somebody
-- closed their account would leave objects in the bucket that no inventory
-- could explain.
SELECT pg_temp.expect_accepted(
  'deleting the uploader leaves the import behind',
  $$DELETE FROM "user" WHERE "id" = '00000000-0000-0000-0000-0000000fa002'$$);

SELECT pg_temp.expect_true(
  'the second import survived its uploader',
  $$SELECT "uploadedByUserId" IS NULL FROM "fleet_roster_import_source"
     WHERE "assetId" = '00000000-0000-0000-0000-0000000aa002'$$);

------------------------------------------------------------------------------
-- The asset a roster import produces stays where FC-009 leaves it.
--
-- Inherited from FC-008's trigger, asserted here because this is the chain in
-- which a roster source actually exists: nothing about an import is allowed to
-- make an unscanned CSV serveable.
------------------------------------------------------------------------------
SELECT pg_temp.expect_rejected(
  'a quarantined roster source cannot be published',
  $$UPDATE "file_asset" SET "state" = 'AVAILABLE', "availableAt" = now()
    WHERE "id" = '00000000-0000-0000-0000-0000000aa001'$$,
  '23514');

SELECT pg_temp.expect_true(
  'every roster source is still in quarantine',
  $$SELECT count(*) = 3 FROM "file_asset"
     WHERE "kind" = 'ROSTER_IMPORT_SOURCE' AND "state" = 'QUARANTINED'$$);

SELECT pg_temp.expect_true(
  'no roster source is readable by an audience',
  $$SELECT bool_and("audience" = 'RESTRICTED') FROM "file_asset"
     WHERE "kind" = 'ROSTER_IMPORT_SOURCE'$$);

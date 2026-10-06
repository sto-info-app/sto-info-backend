-- Fleet Community v1 release preflight (FC-045).
--
-- Read-only. Run against the database a release is about to migrate, before
-- the release is deployed:
--
--   psql "<connection>" -v schema=sto_info_app -f scripts/release-preflight/preflight.sql
--
-- It looks for every row the release's migrations are known to fail on, so a
-- failure is found here rather than half-way through a deploy. Every check
-- runs inside a READ ONLY transaction that is rolled back: it cannot change
-- anything, whoever runs it. It prints one NOTICE line a check, then fails
-- (psql exits with status 3) if any FAIL check found anything. INFO lines are
-- counts of what the release will change on purpose; they never fail it.
--
-- The checks, and the migration each protects:
--
--   AUDIT_NOT_OBJECT           1796500000000 reads the audit snapshots of news
--                              posts, contact requests and member reports with
--                              json_each, which raises on anything but an
--                              object or SQL NULL.
--   PROFILE_PICTURE_TOO_LONG   1792600000000 copies picture keys into a
--                              varchar(255) column (1792200000000 into 1024).
--   PICTURE_IN_BOTH_STORES     1792600000000's unique index refuses one key
--                              registered as both an old R2 Character picture
--                              (a key with a slash) and an Images picture.
--   NOTICE_ID_TAKEN            1796500000000 adds a notification with a fixed ID.
--   POSTGRES_TOO_OLD           the new tables use gen_random_uuid(), PostgreSQL 13+.
--   UNEXPECTED_MIGRATIONS      the release expects to start from production's
--                              last migration, 1791500000000.

\set ON_ERROR_STOP on
\if :{?schema}
\else
  \set schema sto_info_app
\endif

BEGIN TRANSACTION READ ONLY;
SET LOCAL search_path TO :"schema", public;

DO $$
DECLARE
  picture_shape constant text :=
    '^([a-z0-9]+-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-|$)';
  failing integer := 0;
  found bigint;
  checks text[][] := ARRAY[
    ['FAIL', 'AUDIT_NOT_OBJECT',
     $q$SELECT count(*) FROM "_audit"
         WHERE "entity" IN ('NewsPostEntity', 'ContactRequestEntity', 'UserReportEntity')
           AND (("oldValue" IS NOT NULL AND json_typeof("oldValue") <> 'object')
             OR ("newValue" IS NOT NULL AND json_typeof("newValue") <> 'object'))$q$],
    ['FAIL', 'PROFILE_PICTURE_TOO_LONG',
     $q$SELECT count(*) FROM "user_profile" WHERE length("profilePictureId") > 255$q$],
    ['FAIL', 'PICTURE_IN_BOTH_STORES',
     $q$SELECT count(DISTINCT c."profilePictureId") FROM "character" c
         WHERE POSITION('/' IN c."profilePictureId") > 0
           AND c."profilePictureId" IN (
             SELECT "profilePictureId" FROM "user_profile"
             UNION SELECT "bannerImageId" FROM "storytime_arc"
             UNION SELECT "profileImageId" FROM "storytime_arc"
             UNION SELECT "bannerImageId" FROM "storytime_story"
             UNION SELECT "profileImageId" FROM "storytime_story"
             UNION SELECT "coverImageId" FROM "storytime_chapter"
             UNION SELECT "portraitImageId" FROM "storytime_character"
             UNION SELECT "overrideImageId" FROM "storytime_spotlight"
             UNION SELECT "cloudflareImageId" FROM "custom_tracking_image_value")$q$],
    ['FAIL', 'NOTICE_ID_TAKEN',
     $q$SELECT count(*) FROM "notification" WHERE "id" = '38000000-0000-4000-8000-000000000038'$q$],
    ['FAIL', 'POSTGRES_TOO_OLD',
     $q$SELECT CASE WHEN current_setting('server_version_num')::int >= 130000 THEN 0 ELSE 1 END$q$],
    ['FAIL', 'UNEXPECTED_MIGRATIONS',
     $q$SELECT (SELECT count(*) FROM "_migrations" WHERE "timestamp" > 1791500000000)
             + CASE WHEN EXISTS (SELECT 1 FROM "_migrations" WHERE "timestamp" = 1791500000000) THEN 0 ELSE 1 END$q$],
    ['INFO', 'CHARACTER_NAMES_AS_PICTURES',
     $q$SELECT count(*) FROM "character"
         WHERE "profilePictureId" IS NOT NULL AND POSITION('/' IN "profilePictureId") = 0
           AND "profilePictureId" !~* '$q$ || picture_shape || $q$'$q$],
    ['INFO', 'LEGACY_PICTURES_TO_REGISTER',
     $q$SELECT count(*) FROM (
           SELECT "profilePictureId" AS "key" FROM "user_profile"
           UNION SELECT "profilePictureId" FROM "character"
           UNION SELECT "bannerImageId" FROM "storytime_arc"
           UNION SELECT "profileImageId" FROM "storytime_arc"
           UNION SELECT "bannerImageId" FROM "storytime_story"
           UNION SELECT "profileImageId" FROM "storytime_story"
           UNION SELECT "coverImageId" FROM "storytime_chapter"
           UNION SELECT "portraitImageId" FROM "storytime_character"
           UNION SELECT "overrideImageId" FROM "storytime_spotlight"
           UNION SELECT "cloudflareImageId" FROM "custom_tracking_image_value") AS pictures
         WHERE "key" IS NOT NULL$q$],
    ['INFO', 'AUDIT_SNAPSHOTS_TO_STRIP',
     $q$SELECT count(*) FROM "_audit" WHERE "entity" IN ('NewsPostEntity', 'ContactRequestEntity', 'UserReportEntity')$q$],
    ['INFO', 'PREFERENCES_TO_MOVE',
     $q$SELECT count(*) FROM "user_profile" WHERE "privacyMode" = true OR "sessionTimeoutMinutes" IS NOT NULL$q$],
    ['INFO', 'ENTERED_DAYS_TO_TRUNCATE',
     $q$SELECT (SELECT count(*) FROM "account" WHERE "accountCreatedDate" <> date_trunc('day', "accountCreatedDate"))
             + (SELECT count(*) FROM "character" WHERE "createdDate" <> date_trunc('day', "createdDate"))$q$]
  ];
BEGIN
  FOR i IN 1 .. array_length(checks, 1) LOOP
    EXECUTE checks[i][3] INTO found;

    IF checks[i][1] = 'FAIL' AND found > 0 THEN
      failing := failing + 1;
    END IF;

    RAISE NOTICE '% % %',
      rpad(CASE WHEN checks[i][1] = 'INFO' THEN 'INFO' WHEN found = 0 THEN 'PASS' ELSE 'FAIL' END, 5),
      rpad(checks[i][2], 28), found;
  END LOOP;

  IF failing > 0 THEN
    RAISE EXCEPTION 'PREFLIGHT FAILED: % check(s) found rows the release would fail on', failing;
  END IF;

  RAISE NOTICE 'PREFLIGHT PASSED';
END $$;

ROLLBACK;

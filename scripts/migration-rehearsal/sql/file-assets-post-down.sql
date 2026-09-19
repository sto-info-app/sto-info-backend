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

-- Reverting the counting of the estate must not un-count anything else. The
-- backfill only ever read these tables, and the rollback drops the registry
-- rather than touching them, so every image reference that was here before the
-- migration is still here after it has been reversed.
SELECT pg_temp.expect_true(
  'the rollback left every profile picture reference alone',
  $$SELECT count(*) = 1 FROM "user_profile" WHERE "profilePictureId" IS NOT NULL$$);

SELECT pg_temp.expect_true(
  'the rollback left both Character portraits alone',
  $$SELECT count(*) = 2 FROM "character" WHERE "profilePictureId" IS NOT NULL$$);

-- Eight references, not eight objects: one banner is referenced twice, which
-- the backfill counted once and the rollback leaves as the two references it
-- always was.
SELECT pg_temp.expect_true(
  'the rollback left every Storytime image reference alone',
  $$SELECT (SELECT count(*) FROM "storytime_story" WHERE "bannerImageId" IS NOT NULL)
          + (SELECT count(*) FROM "storytime_story" WHERE "profileImageId" IS NOT NULL)
          + (SELECT count(*) FROM "storytime_arc" WHERE "bannerImageId" IS NOT NULL)
          + (SELECT count(*) FROM "storytime_arc" WHERE "profileImageId" IS NOT NULL)
          + (SELECT count(*) FROM "storytime_chapter" WHERE "coverImageId" IS NOT NULL)
          + (SELECT count(*) FROM "storytime_character" WHERE "portraitImageId" IS NOT NULL)
          + (SELECT count(*) FROM "storytime_spotlight" WHERE "overrideImageId" IS NOT NULL) = 8$$);

SELECT pg_temp.expect_true(
  'the rollback left every Custom Tracking picture alone',
  $$SELECT count(*) = 2 FROM "custom_tracking_image_value"$$);

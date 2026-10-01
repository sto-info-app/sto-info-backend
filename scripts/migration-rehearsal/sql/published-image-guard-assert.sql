SET search_path TO "sto_info_app";

-- Quiet: every helper returns void, so the result tables carry no information.
\pset tuples_only on
\pset format unaligned


-- Every assertion below is a deliberate attempt to put a picture the registry
-- has not published into a feature column, the way a build from before FC-012
-- would. `expect_rejected` fails the run if the database lets it through.
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

-- The refusal names the table and column, and never the value: an error
-- message is logged, and a picture reference does not belong in a log.
CREATE OR REPLACE FUNCTION pg_temp.expect_message(label text, stmt text, want text, secret text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  got text;
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS got = MESSAGE_TEXT;
    IF got <> want OR position(secret IN got) > 0 THEN
      RAISE EXCEPTION 'FAIL % : message was %', label, got;
    END IF;
    RAISE NOTICE 'PASS %', label;

    RETURN;
  END;
  RAISE EXCEPTION 'FAIL % : the database ACCEPTED it', label;
END;
$fn$;

-- IRG01 is the guard's own SQLSTATE, outside every class PostgreSQL defines.

------------------------------------------------------------------------------
-- The estate from before the guard stays editable. The guard checks what is
-- written, not what is there, and an update that leaves a picture as it was
-- is not a publication.
------------------------------------------------------------------------------
SELECT pg_temp.expect_accepted(
  'a row holding an unregistered picture can still change its other columns',
  $$UPDATE "storytime_arc" SET "ownerUserId" = '00000000-0000-0000-0000-00000000f001'
    WHERE "id" = '00000000-0000-0000-0000-00000000f001'$$);

SELECT pg_temp.expect_accepted(
  'setting the one picture column in an UPDATE to what it already holds is allowed',
  $$UPDATE "storytime_arc" SET "bannerImageId" = 'pre-guard-picture'
    WHERE "id" = '00000000-0000-0000-0000-00000000f001'$$);

------------------------------------------------------------------------------
-- Every one of the 17 picture columns, the same way.
------------------------------------------------------------------------------
DO $do$
DECLARE
  target record;
  key text;
  row_filter text;
  refused_reference text;
  new_user text;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('user_profile', 'profilePictureId'),
      ('character', 'profilePictureId'),
      ('storytime_arc', 'bannerImageId'),
      ('storytime_arc', 'profileImageId'),
      ('storytime_story', 'bannerImageId'),
      ('storytime_story', 'profileImageId'),
      ('storytime_chapter', 'coverImageId'),
      ('storytime_character', 'portraitImageId'),
      ('storytime_spotlight', 'overrideImageId'),
      ('custom_tracking_image_value', 'cloudflareImageId'),
      ('fleet_community', 'bannerImageId'),
      ('fleet_community', 'emblemImageId'),
      ('sto_fleet', 'bannerImageId'),
      ('sto_fleet', 'emblemImageId'),
      ('sto_armada', 'bannerImageId'),
      ('sto_armada', 'emblemImageId'),
      ('news_post', 'coverImageId')
    ) AS columns ("tbl", "col")
  LOOP
    key := CASE WHEN target.tbl = 'user_profile' THEN 'userId' ELSE 'id' END;
    row_filter := format('%I = %L', key, '00000000-0000-0000-0000-00000000f001');

    PERFORM pg_temp.expect_accepted(
      format('%s.%s: an unchanged unregistered picture', target.tbl, target.col),
      format('UPDATE %I SET %I = %I WHERE %s', target.tbl, target.col, target.col, row_filter));

    -- What an old build writes: an ID Cloudflare has just handed it, which
    -- no registry row has ever held.
    PERFORM pg_temp.expect_rejected(
      format('%s.%s: an UPDATE to a random ID', target.tbl, target.col),
      format('UPDATE %I SET %I = %L WHERE %s', target.tbl, target.col,
        'old-build-' || md5(random()::text), row_filter),
      'IRG01');

    PERFORM pg_temp.expect_message(
      format('%s.%s: the refusal names the column, not the value', target.tbl, target.col),
      format('UPDATE %I SET %I = %L WHERE %s', target.tbl, target.col, 'old-build-secret', row_filter),
      format('%s.%s may only hold a picture the asset registry has published', target.tbl, target.col),
      'old-build-secret');

    IF target.tbl = 'user_profile' THEN
      INSERT INTO "user" ("id") VALUES (gen_random_uuid()) RETURNING format('%L', "id") INTO new_user;
      PERFORM pg_temp.expect_rejected(
        'user_profile.profilePictureId: an INSERT with a random ID',
        format('INSERT INTO "user_profile" ("userId", "profilePictureId") VALUES (%s, %L)', new_user,
          'old-build-' || md5(random()::text)),
        'IRG01');
      PERFORM pg_temp.expect_accepted(
        'user_profile.profilePictureId: an INSERT with a published picture',
        format('INSERT INTO "user_profile" ("userId", "profilePictureId") VALUES (%s, %L)', new_user,
          'published-picture'));
    ELSE
      PERFORM pg_temp.expect_rejected(
        format('%s.%s: an INSERT with a random ID', target.tbl, target.col),
        format('INSERT INTO %I (%I) VALUES (%L)', target.tbl, target.col,
          'old-build-' || md5(random()::text)),
        'IRG01');
      PERFORM pg_temp.expect_accepted(
        format('%s.%s: an INSERT with a published picture', target.tbl, target.col),
        format('INSERT INTO %I (%I) VALUES (%L)', target.tbl, target.col, 'published-picture'));
    END IF;

    -- A registry row is not enough: it has to be one the site may show.
    FOREACH refused_reference IN ARRAY ARRAY[
      'clean-picture', 'revoked-picture', 'rejected-picture',
      'quarantined-picture', 'deleted-picture']
    LOOP
      PERFORM pg_temp.expect_rejected(
        format('%s.%s: %s', target.tbl, target.col, refused_reference),
        format('UPDATE %I SET %I = %L WHERE %s', target.tbl, target.col, refused_reference, row_filter),
        'IRG01');
    END LOOP;

    PERFORM pg_temp.expect_accepted(
      format('%s.%s: a published picture', target.tbl, target.col),
      format('UPDATE %I SET %I = %L WHERE %s', target.tbl, target.col, 'published-picture', row_filter));

    PERFORM pg_temp.expect_accepted(
      format('%s.%s: a legacy UNVERIFIED picture', target.tbl, target.col),
      format('UPDATE %I SET %I = %L WHERE %s', target.tbl, target.col, 'legacy-picture', row_filter));

    -- Custom Tracking deletes the row rather than clearing the column, which
    -- is NOT NULL.
    IF target.tbl <> 'custom_tracking_image_value' THEN
      PERFORM pg_temp.expect_accepted(
        format('%s.%s: NULL', target.tbl, target.col),
        format('UPDATE %I SET %I = NULL WHERE %s', target.tbl, target.col, row_filter));
      PERFORM pg_temp.expect_accepted(
        format('%s.%s: back to a legacy picture', target.tbl, target.col),
        format('UPDATE %I SET %I = %L WHERE %s', target.tbl, target.col, 'legacy-picture', row_filter));
    END IF;
  END LOOP;
END;
$do$;

------------------------------------------------------------------------------
-- FC-040's copy to private delivery, and its undo: the asset's reference moves
-- first and the columns follow, in one transaction. Every column above now
-- holds 'legacy-picture'.
------------------------------------------------------------------------------
BEGIN;
SELECT pg_temp.expect_accepted(
  'the copy moves the asset to its private copy',
  $$UPDATE "file_asset" SET "deliveryReference" = 'private-copy'
    WHERE "deliveryReference" = 'legacy-picture'$$);
SELECT pg_temp.expect_accepted(
  'the copy repoints a column after the asset',
  $$UPDATE "character" SET "profilePictureId" = 'private-copy'
    WHERE "profilePictureId" = 'legacy-picture'$$);
SELECT pg_temp.expect_accepted(
  'the copy repoints every row holding the picture',
  $$UPDATE "sto_armada" SET "emblemImageId" = 'private-copy'
    WHERE "emblemImageId" = 'legacy-picture'$$);
COMMIT;

BEGIN;
SELECT pg_temp.expect_accepted(
  'the undo moves the asset back',
  $$UPDATE "file_asset" SET "deliveryReference" = 'legacy-picture'
    WHERE "deliveryReference" = 'private-copy'$$);
SELECT pg_temp.expect_accepted(
  'the undo puts the column back after the asset',
  $$UPDATE "character" SET "profilePictureId" = 'legacy-picture'
    WHERE "profilePictureId" = 'private-copy'$$);
SELECT pg_temp.expect_accepted(
  'the undo puts every row back',
  $$UPDATE "sto_armada" SET "emblemImageId" = 'legacy-picture'
    WHERE "emblemImageId" = 'private-copy'$$);
COMMIT;

SELECT pg_temp.expect_rejected(
  'a column cannot run ahead of the asset it is moving to',
  $$UPDATE "character" SET "profilePictureId" = 'private-copy'
    WHERE "profilePictureId" = 'legacy-picture'$$,
  'IRG01');

SELECT pg_temp.expect_true(
  'one guard trigger on each of the 17 picture columns',
  $$SELECT count(*) = 17 FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'sto_info_app' AND t.tgname LIKE 'TR\_%\_published' AND NOT t.tgisinternal$$);

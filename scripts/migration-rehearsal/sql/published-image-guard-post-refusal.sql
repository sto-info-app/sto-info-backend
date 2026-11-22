SET search_path TO "sto_info_app";

\pset tuples_only on
\pset format unaligned

-- The guard's down refused. What it protects has to still be in force, with
-- the rows the assertions left behind.
DO $do$
DECLARE
  guards integer;
BEGIN
  SELECT count(*) INTO guards FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'sto_info_app' AND t.tgname LIKE 'TR\_%\_published' AND NOT t.tgisinternal;

  IF guards <> 17 THEN
    RAISE EXCEPTION 'FAIL the refused rollback left % guard triggers, expected 17', guards;
  END IF;
  RAISE NOTICE 'PASS all 17 guard triggers survive the refused rollback';

  BEGIN
    UPDATE "user_profile" SET "profilePictureId" = 'old-build-after-rollback'
      WHERE "userId" = '00000000-0000-0000-0000-00000000f001';
  EXCEPTION WHEN SQLSTATE 'IRG01' THEN
    RAISE NOTICE 'PASS an unregistered picture is still refused after the refused rollback';

    RETURN;
  END;
  RAISE EXCEPTION 'FAIL an unregistered picture was ACCEPTED after the refused rollback';
END;
$do$;

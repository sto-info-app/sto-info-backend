SET search_path TO "sto_info_app";

-- Runs after the migration. The rows that had to survive the cast were loaded
-- in the pre-up file; this is a row written the way the application will write
-- them from now on, as a bare day with no time at all.

INSERT INTO "account" ("id", "handle", "accountCreatedDate") VALUES
  ('00000000-0000-0000-0000-0000000000b5', 'after', DATE '2026-09-17');

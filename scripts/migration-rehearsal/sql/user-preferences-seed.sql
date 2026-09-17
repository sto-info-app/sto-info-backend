SET search_path TO "sto_info_app";

-- Runs after the migration. The rows that had to survive the move were loaded
-- in the pre-up file; these are the ones the constraint assertions need.

-- A user with no preference row of their own yet, so an insert of pure
-- defaults has somewhere to land.
INSERT INTO "user" ("id") VALUES
  ('00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000b2');

INSERT INTO "user_profile" ("userId") VALUES
  ('00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000b2');

-- Written with nothing but the key, so every column default is exercised.
INSERT INTO "user_preference" ("userId") VALUES
  ('00000000-0000-0000-0000-0000000000b1');

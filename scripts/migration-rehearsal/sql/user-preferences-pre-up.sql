SET search_path TO "sto_info_app";

-- Loaded before the migration runs, so there is real data for it to carry
-- across. Every case the copy has to distinguish appears here exactly once.

INSERT INTO "user" ("id") VALUES
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000a3'),
  ('00000000-0000-0000-0000-0000000000a4'),
  ('00000000-0000-0000-0000-0000000000a5');

-- a1 chose both settings. a2 chose privacy mode only. a3 chose a timeout only.
-- a4 chose neither and must get no row at all — a row of pure defaults would
-- say nothing the defaults do not already say, and would freeze this account
-- against any later change of default.
-- a5 has privacy mode explicitly off and a timeout, which is the case a naive
-- "copy the rows that look interesting" filter gets wrong.
INSERT INTO "user_profile" ("userId", "privacyMode", "sessionTimeoutMinutes") VALUES
  ('00000000-0000-0000-0000-0000000000a1', true, 480),
  ('00000000-0000-0000-0000-0000000000a2', true, NULL),
  ('00000000-0000-0000-0000-0000000000a3', false, 60),
  ('00000000-0000-0000-0000-0000000000a4', false, NULL),
  ('00000000-0000-0000-0000-0000000000a5', false, 240);

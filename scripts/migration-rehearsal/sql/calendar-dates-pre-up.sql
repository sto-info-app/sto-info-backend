SET search_path TO "sto_info_app";

-- Loaded before the migration runs, so there is real data for the cast to
-- carry across. The two shapes the columns actually hold both appear here.

INSERT INTO "user" ("id") VALUES
  ('00000000-0000-0000-0000-0000000000a1');

-- a1 was entered through the API from an <input type="date">, so it sits at
-- midnight. This is the row that rendered a day early west of Greenwich.
-- a2 was written by the demo seed, which chose 10:30 to make seeded rows look
-- distinct. The time means nothing and must not change which day survives.
-- a3 is late in the evening, the case where a careless cast through a zoned
-- type would move the day forward.
-- a4 records no date at all.
INSERT INTO "account" ("id", "handle", "accountCreatedDate") VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'midnight',  TIMESTAMP '2015-03-04 00:00:00'),
  ('00000000-0000-0000-0000-0000000000b2', 'seeded',    TIMESTAMP '2024-01-15 10:30:00'),
  ('00000000-0000-0000-0000-0000000000b3', 'late',      TIMESTAMP '2019-12-31 23:59:59'),
  ('00000000-0000-0000-0000-0000000000b4', 'undated',   NULL);

INSERT INTO "character" ("id", "createdDate") VALUES
  ('00000000-0000-0000-0000-0000000000c1', TIMESTAMP '2020-06-01 00:00:00'),
  ('00000000-0000-0000-0000-0000000000c2', TIMESTAMP '2024-02-29 14:15:00'),
  ('00000000-0000-0000-0000-0000000000c3', NULL);

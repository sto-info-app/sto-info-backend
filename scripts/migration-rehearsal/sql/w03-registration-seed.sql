SET search_path TO "sto_info_app";

-- Three owners: one to fill up, one to stay empty, one to receive a transfer.
INSERT INTO "user" ("id") VALUES
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000a3');

-- Two platforms, because the whole point of the index change is that a slug is
-- only unique within one of them.
INSERT INTO "platform" ("id") VALUES
  ('00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000b2');

INSERT INTO "fleet_community" ("id", "ownerUserId", "name", "slug") VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'First Contact', 'first-contact'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a2', 'Second Wave', 'second-wave');

-- One Fleet and one Armada on the first platform, for the second platform's
-- namesake to collide with — or not.
INSERT INTO "sto_fleet" ("id", "communityId", "platformId", "exactGameName", "exactGameNameNormalized", "slug") VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'Omega Armada', 'omega armada', 'omega-armada');

INSERT INTO "sto_armada" ("id", "communityId", "platformId", "exactGameName", "exactGameNameNormalized", "slug") VALUES
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'Vanguard Armada', 'vanguard armada', 'vanguard-armada');

SET search_path TO "sto_info_app";

INSERT INTO "user" ("id") VALUES
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000a2');

INSERT INTO "platform" ("id") VALUES
  ('00000000-0000-0000-0000-0000000000b1');

INSERT INTO "character" ("id") VALUES
  ('00000000-0000-0000-0000-0000000000c1');

-- Two Communities, so every cross-community test has somewhere to point.
INSERT INTO "fleet_community" ("id", "ownerUserId", "name", "slug") VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'First Contact', 'first-contact'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a2', 'Second Wave', 'second-wave');

INSERT INTO "sto_fleet" ("id", "communityId", "platformId", "exactGameName", "exactGameNameNormalized", "slug") VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'Starfleet Vanguard', 'starfleet vanguard', 'starfleet-vanguard'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b1', 'Other Fleet', 'other fleet', 'other-fleet'),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'Second Fleet Here', 'second fleet here', 'second-fleet-here');

-- An explicitly confirmed unregistered observation target: no Community.
INSERT INTO "sto_fleet" ("id", "communityId", "platformId", "exactGameName", "exactGameNameNormalized", "slug") VALUES
  ('00000000-0000-0000-0000-0000000000e3', NULL, '00000000-0000-0000-0000-0000000000b1', 'Unregistered Fleet', 'unregistered fleet', 'unregistered-fleet');

INSERT INTO "sto_armada" ("id", "communityId", "platformId", "exactGameName", "exactGameNameNormalized", "slug") VALUES
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'Vanguard Armada', 'vanguard armada', 'vanguard-armada');

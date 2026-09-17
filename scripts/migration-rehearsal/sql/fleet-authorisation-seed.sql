SET search_path TO "sto_info_app";

-- Self-contained rather than building on the fleet-community seed: a suite
-- that needed another suite's rows to have been loaded first would only work
-- when the two are run in one order, which nothing enforces.

-- a4 owns nothing, so their account can be deleted later without the owner
-- RESTRICT on fleet_community standing in the way.
INSERT INTO "user" ("id") VALUES
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000a3'),
  ('00000000-0000-0000-0000-0000000000a4');

INSERT INTO "platform" ("id") VALUES
  ('00000000-0000-0000-0000-0000000000b1');

-- Two Communities, so every cross-community delegation has somewhere to point.
INSERT INTO "fleet_community" ("id", "ownerUserId", "name", "slug") VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'First Contact', 'first-contact'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a2', 'Second Wave', 'second-wave');

INSERT INTO "sto_fleet" ("id", "communityId", "platformId", "exactGameName", "exactGameNameNormalized", "slug") VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'Starfleet Vanguard', 'starfleet vanguard', 'starfleet-vanguard'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b1', 'Other Fleet', 'other fleet', 'other-fleet'),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'Second Fleet Here', 'second fleet here', 'second-fleet-here');

-- An explicitly confirmed unregistered observation target: no Community, so no
-- composite key for a delegation to reference.
INSERT INTO "sto_fleet" ("id", "communityId", "platformId", "exactGameName", "exactGameNameNormalized", "slug") VALUES
  ('00000000-0000-0000-0000-0000000000e3', NULL, '00000000-0000-0000-0000-0000000000b1', 'Unregistered Fleet', 'unregistered fleet', 'unregistered-fleet');

INSERT INTO "sto_armada" ("id", "communityId", "platformId", "exactGameName", "exactGameNameNormalized", "slug") VALUES
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'Vanguard Armada', 'vanguard armada', 'vanguard-armada'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b1', 'Rival Armada', 'rival armada', 'rival-armada');

-- One Officer, so a delegation to the label has somebody it would reach.
INSERT INTO "scope_role_assignment" ("communityId", "fleetId", "userId", "role") VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a3', 'OFFICER');

SET search_path TO "sto_info_app";

-- A Community, a Fleet, two users, and the assets a roster import produces.
--
-- Everything here is the state the ingress service leaves behind: an asset of
-- kind ROSTER_IMPORT_SOURCE, sitting in QUARANTINED with a RESTRICTED
-- audience, and a provenance row beside it. Nothing is AVAILABLE, because
-- nothing has scanned anything.

INSERT INTO "user" ("id") VALUES
  ('00000000-0000-0000-0000-0000000fa001'),
  ('00000000-0000-0000-0000-0000000fa002');

INSERT INTO "platform" ("id") VALUES ('00000000-0000-0000-0000-0000000000b1');

INSERT INTO "fleet_community" ("id", "ownerUserId", "name", "slug") VALUES
  ('00000000-0000-0000-0000-0000000da001', '00000000-0000-0000-0000-0000000fa001', 'Import Community', 'import-community');

INSERT INTO "sto_fleet" ("id", "communityId", "platformId", "exactGameName", "exactGameNameNormalized", "slug") VALUES
  ('00000000-0000-0000-0000-0000000ea001', '00000000-0000-0000-0000-0000000da001', '00000000-0000-0000-0000-0000000000b1', 'Import Fleet', 'import fleet', 'import-fleet'),
  ('00000000-0000-0000-0000-0000000ea002', '00000000-0000-0000-0000-0000000da001', '00000000-0000-0000-0000-0000000000b1', 'Spare Fleet', 'spare fleet', 'spare-fleet');

-- The sanitised CSV from an officer-shaped export, in quarantine.
INSERT INTO "file_asset"
  ("id", "kind", "state", "audience", "storage", "ownerUserId", "fleetId", "objectKey", "sha256", "byteSize", "originalFilename")
VALUES
  ('00000000-0000-0000-0000-0000000aa001', 'ROSTER_IMPORT_SOURCE', 'QUARANTINED', 'RESTRICTED', 'QUARANTINE',
   '00000000-0000-0000-0000-0000000fa001', '00000000-0000-0000-0000-0000000ea001',
   'local/assets/aa001', repeat('a', 64), 2048, 'Import Fleet_20240101-120000.Csv');

-- A second, for the assertions that need an asset with no provenance yet.
INSERT INTO "file_asset"
  ("id", "kind", "state", "audience", "storage", "ownerUserId", "fleetId", "objectKey", "sha256", "byteSize")
VALUES
  ('00000000-0000-0000-0000-0000000aa002', 'ROSTER_IMPORT_SOURCE', 'QUARANTINED', 'RESTRICTED', 'QUARANTINE',
   '00000000-0000-0000-0000-0000000fa002', '00000000-0000-0000-0000-0000000ea001',
   'local/assets/aa002', repeat('b', 64), 4096);

-- A third, for the race, which contests it from ten sessions at once.
INSERT INTO "file_asset"
  ("id", "kind", "state", "audience", "storage", "ownerUserId", "fleetId", "objectKey", "sha256", "byteSize")
VALUES
  ('00000000-0000-0000-0000-0000000aa003', 'ROSTER_IMPORT_SOURCE', 'QUARANTINED', 'RESTRICTED', 'QUARANTINE',
   '00000000-0000-0000-0000-0000000fa001', '00000000-0000-0000-0000-0000000ea001',
   'local/assets/aa003', repeat('c', 64), 512);

-- The provenance of the first: 93 rows, seven of which carried an officer note
-- that no longer exists anywhere.
INSERT INTO "fleet_roster_import_source"
  ("id", "assetId", "fleetId", "uploadedByUserId", "originalFilename", "sourceSha256", "sanitisedSha256",
   "sourceByteSize", "sanitisedByteSize", "sourceHeaderShape", "rowCount", "officerTailRowCount", "parserVersion")
VALUES
  ('00000000-0000-0000-0000-0000000ba001', '00000000-0000-0000-0000-0000000aa001',
   '00000000-0000-0000-0000-0000000ea001', '00000000-0000-0000-0000-0000000fa001',
   'Import Fleet_20240101-120000.Csv', repeat('1', 64), repeat('2', 64),
   8192, 2048, 'OFFICER', 93, 7, 1);

SET search_path TO "sto_info_app";

-- A Community and a Fleet for the scoped assets to belong to, and one asset in
-- each state the assertions need to push against.

INSERT INTO "platform" ("id") VALUES ('00000000-0000-0000-0000-0000000000b1');

INSERT INTO "fleet_community" ("id", "ownerUserId", "name", "slug") VALUES
  ('00000000-0000-0000-0000-0000000da001', '00000000-0000-0000-0000-0000000fa001', 'Asset Community', 'asset-community');

INSERT INTO "sto_fleet" ("id", "communityId", "platformId", "exactGameName", "exactGameNameNormalized", "slug") VALUES
  ('00000000-0000-0000-0000-0000000ea001', '00000000-0000-0000-0000-0000000da001', '00000000-0000-0000-0000-0000000000b1', 'Asset Fleet', 'asset fleet', 'asset-fleet');

-- A clean asset waiting to be published, with its identity already bound.
INSERT INTO "file_asset"
  ("id", "kind", "state", "audience", "storage", "ownerUserId", "objectKey", "objectVersion", "sha256", "byteSize", "policyVersion")
VALUES
  ('00000000-0000-0000-0000-0000000aa001', 'ROSTER_IMPORT_SOURCE', 'CLEAN', 'RESTRICTED', 'QUARANTINE',
   '00000000-0000-0000-0000-0000000fa001', 'local/assets/aa001', 'v-1', repeat('a', 64), 1024, 1);

-- One that a scanner refused.
INSERT INTO "file_asset"
  ("id", "kind", "state", "audience", "storage", "ownerUserId", "objectKey", "sha256", "rejectionCode")
VALUES
  ('00000000-0000-0000-0000-0000000aa002', 'PROFILE_IMAGE', 'REJECTED', 'PUBLIC', 'QUARANTINE',
   '00000000-0000-0000-0000-0000000fa001', 'local/assets/aa002', repeat('b', 64), 'SIGNATURE_MATCH');

-- One that was published and has since been withdrawn.
INSERT INTO "file_asset"
  ("id", "kind", "state", "audience", "storage", "ownerUserId", "objectKey", "revocationReason")
VALUES
  ('00000000-0000-0000-0000-0000000aa003', 'STORYTIME_IMAGE', 'REVOKED', 'PUBLIC', 'PUBLIC_IMAGES',
   '00000000-0000-0000-0000-0000000fa002', 'revoked-image-1', 'Later detection');

-- One sitting in quarantine with no verdict yet.
INSERT INTO "file_asset"
  ("id", "kind", "state", "audience", "storage", "ownerUserId", "objectKey")
VALUES
  ('00000000-0000-0000-0000-0000000aa004', 'FLEET_IMAGE', 'QUARANTINED', 'PUBLIC', 'QUARANTINE',
   '00000000-0000-0000-0000-0000000fa001', 'local/assets/aa004');

-- One published to a Fleet's members.
INSERT INTO "file_asset"
  ("id", "kind", "state", "audience", "storage", "ownerUserId", "fleetId", "scopeAudience", "objectKey", "availableAt")
VALUES
  ('00000000-0000-0000-0000-0000000aa005', 'FLEET_IMAGE', 'AVAILABLE', 'SCOPE', 'QUARANTINE',
   '00000000-0000-0000-0000-0000000fa001', '00000000-0000-0000-0000-0000000ea001', 'FLEET_MEMBERS',
   'local/assets/aa005', now());

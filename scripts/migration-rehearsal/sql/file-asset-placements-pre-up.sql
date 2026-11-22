SET search_path TO "sto_info_app";

-- The registry as it stands before FC-012, loaded before the migration runs.
--
-- A stand-in for `file_asset` rather than the real table, for the same
-- reason `declared-content-types` uses one: this suite rehearses what
-- FC-012 adds, and dragging in the migrations that build the real table
-- would rehearse those instead. What matters is that the columns the
-- migration reads and writes have the types the real ones have, so the
-- statements under test behave as they will.
CREATE TABLE "sto_info_app"."file_asset" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "objectKey" varchar(1024),
  "storage" varchar(32) NOT NULL,
  "deletedAt" timestamptz,
  CONSTRAINT "PK_file_asset_stub" PRIMARY KEY ("id")
);

-- One row per storage, because the backfill is a rule about storage and
-- the assertions have to be able to tell "copied" from "left alone".
INSERT INTO "file_asset" ("id", "objectKey", "storage") VALUES
  -- Published to Cloudflare Images: the key is the image identifier, which
  -- is exactly what a withdrawal has to delete.
  ('00000000-0000-0000-0000-0000000aa001', 'env-user-1-user-1-1758000000000', 'PUBLIC_IMAGES'),
  -- A Character portrait from before the move to Cloudflare Images.
  ('00000000-0000-0000-0000-0000000aa002', 'test/user-1/char-1/portrait.png', 'LEGACY_PUBLIC_R2'),
  -- Still in quarantine, addressed by the key it was hashed under. Nothing
  -- delivers it, so it has no delivery reference to gain.
  ('00000000-0000-0000-0000-0000000aa003', 'test/assets/aa003', 'QUARANTINE'),
  -- Registered and interrupted before anything was stored.
  ('00000000-0000-0000-0000-0000000aa004', NULL, 'NONE'),
  -- A second published image, for the placement assertions to move about.
  ('00000000-0000-0000-0000-0000000aa005', 'env-user-1-story-1-1758000000001', 'PUBLIC_IMAGES');

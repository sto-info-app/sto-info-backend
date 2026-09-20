SET search_path TO "sto_info_app";

-- One slot with a picture in it and one upload on its way to another, which
-- is the state every assertion below pushes against.

-- What a Story's banner is showing.
INSERT INTO "file_asset_placement"
  ("id", "assetId", "state", "subject", "subjectId", "slot", "settledAt")
VALUES
  ('00000000-0000-0000-0000-0000000fb001', '00000000-0000-0000-0000-0000000aa001',
   'ACTIVE', 'STORYTIME_STORY', 'story-1', 'BANNER', now());

-- An upload on its way to the same Story's profile image.
INSERT INTO "file_asset_placement"
  ("id", "assetId", "state", "subject", "subjectId", "slot", "detail")
VALUES
  ('00000000-0000-0000-0000-0000000fb002', '00000000-0000-0000-0000-0000000aa003',
   'PENDING', 'STORYTIME_STORY', 'story-1', 'PROFILE',
   '{"entityTag": "storytime-story-profile", "entityId": "story-1"}'::jsonb);

-- A refusal the reader has not replaced yet, on a slot that also shows a
-- picture. Neither index covers REJECTED, so both rows stand.
INSERT INTO "file_asset_placement"
  ("id", "assetId", "state", "subject", "subjectId", "slot", "settledAt")
VALUES
  ('00000000-0000-0000-0000-0000000fb003', '00000000-0000-0000-0000-0000000aa002',
   'REJECTED', 'USER_PROFILE', 'user-1', 'PICTURE', now()),
  ('00000000-0000-0000-0000-0000000fb004', '00000000-0000-0000-0000-0000000aa005',
   'ACTIVE', 'USER_PROFILE', 'user-1', 'PICTURE', now());

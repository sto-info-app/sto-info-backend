SET search_path TO "sto_info_app";

-- The estate as it stands before the registry exists: a picture of every kind
-- the backfill knows how to count, including the two that are easy to get
-- wrong.
--
-- The first is a Character portrait stored the pre-Images way, as an R2 key
-- with slashes in it. Withdrawing one of those is deleting an object and
-- purging a custom domain; withdrawing a Cloudflare Images identifier is
-- deleting an image so that every variant of it dies at once. The backfill has
-- to tell them apart, and this is the row that proves it does.
--
-- The second is a Custom Tracking picture whose owner is two joins away,
-- through its value's Character rather than its value's account.

INSERT INTO "user" ("id") VALUES
  ('00000000-0000-0000-0000-0000000fa001'),
  ('00000000-0000-0000-0000-0000000fa002');

INSERT INTO "account" ("id", "handle", "userId") VALUES
  ('00000000-0000-0000-0000-0000000fb001', 'legacy@handle', '00000000-0000-0000-0000-0000000fa001');

INSERT INTO "user_profile" ("userId", "profilePictureId") VALUES
  ('00000000-0000-0000-0000-0000000fa001', 'prod-user-1-profile-1700000000');

INSERT INTO "character" ("id", "accountId", "profilePictureId") VALUES
  ('00000000-0000-0000-0000-0000000fc001', '00000000-0000-0000-0000-0000000fb001', 'prod-user-1-character-1700000001'),
  ('00000000-0000-0000-0000-0000000fc002', '00000000-0000-0000-0000-0000000fb001', 'prod/user-1/char-2/portrait.png');

INSERT INTO "storytime_story" ("id", "ownerUserId", "bannerImageId", "profileImageId") VALUES
  ('00000000-0000-0000-0000-0000000fd001', '00000000-0000-0000-0000-0000000fa002', 'story-banner-1', 'story-profile-1');

INSERT INTO "storytime_arc" ("id", "ownerUserId", "bannerImageId", "profileImageId") VALUES
  ('00000000-0000-0000-0000-0000000fd002', '00000000-0000-0000-0000-0000000fa002', 'arc-banner-1', 'arc-profile-1');

INSERT INTO "storytime_chapter" ("id", "storyId", "coverImageId") VALUES
  ('00000000-0000-0000-0000-0000000fd003', '00000000-0000-0000-0000-0000000fd001', 'chapter-cover-1');

INSERT INTO "storytime_character" ("id", "storyId", "portraitImageId") VALUES
  ('00000000-0000-0000-0000-0000000fd004', '00000000-0000-0000-0000-0000000fd001', 'cast-portrait-1');

INSERT INTO "storytime_spotlight" ("id", "createdByUserId", "overrideImageId") VALUES
  ('00000000-0000-0000-0000-0000000fd005', '00000000-0000-0000-0000-0000000fa002', 'spotlight-override-1');

INSERT INTO "custom_tracking_value" ("id", "accountId", "characterId") VALUES
  ('00000000-0000-0000-0000-0000000fe001', '00000000-0000-0000-0000-0000000fb001', NULL),
  ('00000000-0000-0000-0000-0000000fe002', NULL, '00000000-0000-0000-0000-0000000fc001');

INSERT INTO "custom_tracking_image_value" ("id", "valueId", "cloudflareImageId") VALUES
  ('00000000-0000-0000-0000-0000000ff001', '00000000-0000-0000-0000-0000000fe001', 'tracking-image-1'),
  ('00000000-0000-0000-0000-0000000ff002', '00000000-0000-0000-0000-0000000fe002', 'tracking-image-2');

-- Two references to one image. A story banner reused as an arc banner is the
-- same object in Cloudflare, and the registry holds one row per object, so the
-- backfill must count it once.
INSERT INTO "storytime_arc" ("id", "ownerUserId", "bannerImageId") VALUES
  ('00000000-0000-0000-0000-0000000fd006', '00000000-0000-0000-0000-0000000fa002', 'story-banner-1');

-- Production-shaped rows for the release rehearsal (FC-045).
--
-- Applied to a database built by production's own migrations, after
-- production's demo seed has made its 118 members with their accounts and
-- Characters. Everything here is synthetic. It adds what the release's
-- migrations read or change, so the rehearsal can prove each survives: the
-- runtime records the account seeder makes at boot, preferences to move,
-- pictures in every column the backfill reads (a Character whose picture is
-- still its name among them), site news and notifications, Storytime, Custom
-- Tracking, audit snapshots, reports and the feature switches as production
-- has them.
--
-- The fixed IDs below are this file's own; the members are the demo seed's,
-- chosen by email so a rerun picks the same ones.

SET search_path TO sto_info_app;

-- What the backend's account seeder makes at its first boot.
INSERT INTO "platform" ("name") VALUES ('Windows'), ('PlayStation'), ('Xbox') ON CONFLICT DO NOTHING;
INSERT INTO "launcher" ("name") VALUES ('Arc'), ('Epic'), ('Steam'), ('N/A') ON CONFLICT DO NOTHING;
INSERT INTO "platform_launcher" ("id", "platformId", "launcherId")
SELECT gen_random_uuid(), p."id", l."id" FROM "platform" p JOIN "launcher" l ON (p."name", l."name") IN
  (('Windows', 'Arc'), ('Windows', 'Epic'), ('Windows', 'Steam'), ('Windows', 'N/A'), ('PlayStation', 'N/A'), ('Xbox', 'N/A'))
ON CONFLICT DO NOTHING;
UPDATE "account" SET "platformId" = (SELECT "id" FROM "platform" WHERE "name" = 'Windows'),
                     "launcherId" = (SELECT "id" FROM "launcher" WHERE "name" = 'Arc')
 WHERE "platformId" IS NULL;

-- Three members to hang things on: the first, second and third demo members.
CREATE TEMPORARY TABLE members AS
SELECT row_number() OVER (ORDER BY u."email") AS n, u."id"
  FROM "user" u WHERE u."email" LIKE 'demo-user-%' ORDER BY u."email" LIMIT 3;

-- Preferences FC-006 moves to user_preference, and profile pictures.
UPDATE "user_profile" SET "privacyMode" = true, "sessionTimeoutMinutes" = 240,
       "profilePictureId" = 'production-' || "userId" || '-user-' || "userId" || '-1767000000000'
 WHERE "userId" = (SELECT "id" FROM members WHERE n = 1);
UPDATE "user_profile" SET "sessionTimeoutMinutes" = 60,
       "profilePictureId" = 'production-' || "userId" || '-user-' || repeat('a', 150)
 WHERE "userId" = (SELECT "id" FROM members WHERE n = 2);
UPDATE "user_profile" SET "privacyMode" = true
 WHERE "userId" = (SELECT "id" FROM members WHERE n = 3);

-- Entered days with a time of day, which ADR-0013's migration truncates.
UPDATE "account" SET "accountCreatedDate" = "accountCreatedDate" + interval '22 hours 30 minutes'
 WHERE "userId" IN (SELECT "id" FROM members);

-- Character pictures: a name left there by January 2026's rename, an old R2
-- key, a Cloudflare Images custom ID and a bare Cloudflare ID.
CREATE TEMPORARY TABLE pictured AS
SELECT row_number() OVER (ORDER BY c."fullHandleSlug") AS n, c."id", a."userId"
  FROM "character" c JOIN "account" a ON a."id" = c."accountId"
 WHERE a."userId" = (SELECT "id" FROM members WHERE n = 3)
 ORDER BY c."fullHandleSlug" LIMIT 4;
UPDATE "character" c SET "profilePictureId" = CASE p.n
    WHEN 1 THEN 'Aria Venn'
    WHEN 2 THEN 'production/' || p."userId" || '/' || c."id" || '/portrait.png'
    WHEN 3 THEN 'production-' || p."userId" || '-character-' || c."id" || '-1767000000000'
    ELSE '6a1f0c2e-1b2c-4d3e-8f90-123456789abc' END,
  "createdDate" = c."createdDate" + interval '10 hours 15 minutes'
  FROM pictured p WHERE p."id" = c."id";
-- A second Character called the same, so one name stands for two.
UPDATE "character" SET "profilePictureId" = 'Aria Venn'
 WHERE "id" = (SELECT c."id" FROM "character" c JOIN "account" a ON a."id" = c."accountId"
                WHERE a."userId" = (SELECT "id" FROM members WHERE n = 2) ORDER BY c."fullHandleSlug" LIMIT 1);

-- Site news: a published post and a draft, beside the posts production's own
-- migrations publish.
INSERT INTO "news_post" ("id", "slug", "title", "summary", "body", "category", "status", "publishedAt", "authorId")
VALUES ('0a0a0a0a-0000-4000-8000-00000000ae01', 'release-rehearsal-published', 'Release rehearsal: published', 'Published before the release.', 'A published post.', 'ANNOUNCEMENT', 'PUBLISHED', now() - interval '3 days', (SELECT "id" FROM members WHERE n = 1)),
       ('0a0a0a0a-0000-4000-8000-00000000ae02', 'release-rehearsal-draft', 'Release rehearsal: draft', NULL, 'A draft post.', 'GENERAL', 'DRAFT', NULL, (SELECT "id" FROM members WHERE n = 1));

-- Notifications, one read, and a banner.
INSERT INTO "notification" ("id", "target", "severity", "title", "body", "userId")
VALUES ('0a0a0a0a-0000-4000-8000-00000000af01', 'BROADCAST', 'INFO', 'Rehearsal broadcast', 'To everybody.', NULL),
       ('0a0a0a0a-0000-4000-8000-00000000af02', 'USER', 'WARNING', 'Rehearsal notice', 'To one member.', (SELECT "id" FROM members WHERE n = 2));
INSERT INTO "notification_read" ("notificationId", "userId")
VALUES ('0a0a0a0a-0000-4000-8000-00000000af01', (SELECT "id" FROM members WHERE n = 1));
INSERT INTO "banner" ("message") VALUES ('Release rehearsal banner');

-- Storytime, with a picture in each column the backfill reads.
INSERT INTO "storytime_arc" ("id", "ownerUserId", "title", "slug", "bannerImageId", "profileImageId", "createdByUserId", "updatedByUserId")
SELECT '0a0a0a0a-0000-4000-8000-00000000b001', m."id", 'Rehearsal Arc', 'rehearsal-arc',
       'production-' || m."id" || '-arc-banner-1767000000001', 'production-' || m."id" || '-arc-profile-1767000000002', m."id", m."id"
  FROM members m WHERE m.n = 1;
INSERT INTO "storytime_story" ("id", "ownerUserId", "title", "slug", "ownerOrderIndex", "bannerImageId", "profileImageId", "createdByUserId", "updatedByUserId")
SELECT '0a0a0a0a-0000-4000-8000-00000000b002', m."id", 'Rehearsal Story', 'rehearsal-story', 0,
       'production-' || m."id" || '-story-banner-1767000000003', 'production-' || m."id" || '-story-profile-1767000000004', m."id", m."id"
  FROM members m WHERE m.n = 1;
INSERT INTO "storytime_chapter" ("id", "storyId", "title", "slug", "orderIndex", "coverImageId", "createdByUserId", "updatedByUserId")
SELECT '0a0a0a0a-0000-4000-8000-00000000b003', '0a0a0a0a-0000-4000-8000-00000000b002', 'Chapter One', 'chapter-one', 0,
       'production-' || m."id" || '-chapter-cover-1767000000005', m."id", m."id"
  FROM members m WHERE m.n = 1;
INSERT INTO "storytime_character" ("id", "storyId", "name", "slug", "portraitImageId", "createdByUserId", "updatedByUserId")
SELECT '0a0a0a0a-0000-4000-8000-00000000b004', '0a0a0a0a-0000-4000-8000-00000000b002', 'Captain Rehearsal', 'captain-rehearsal',
       'production-' || m."id" || '-cast-portrait-1767000000006', m."id", m."id"
  FROM members m WHERE m.n = 1;
INSERT INTO "storytime_spotlight" ("id", "slug", "entityType", "storyId", "headline", "summary", "startsAt", "overrideImageId", "createdByUserId", "updatedByUserId")
SELECT '0a0a0a0a-0000-4000-8000-00000000b005', 'rehearsal-spotlight', 'STORY', '0a0a0a0a-0000-4000-8000-00000000b002', 'Rehearsal spotlight', 'In the spotlight.', now(),
       'production-' || m."id" || '-spotlight-1767000000007', m."id", m."id"
  FROM members m WHERE m.n = 1;

-- Custom Tracking: a picture on an account and one on a Character.
INSERT INTO "custom_tracking_section" ("id", "userId", "targetScope", "name", "nameNormalized", "orderIndex")
SELECT ('0a0a0a0a-0000-4000-8000-00000000c00' || s.k)::uuid, m."id", s.scope::custom_tracking_target_scope_enum, s.scope || ' section', lower(s.scope) || ' section', 0
  FROM members m, (VALUES (1, 'ACCOUNT'), (2, 'CHARACTER')) AS s(k, scope) WHERE m.n = 3;
INSERT INTO "custom_tracking_tab" ("id", "sectionId", "name", "nameNormalized", "orderIndex")
SELECT ('0a0a0a0a-0000-4000-8000-00000000c01' || k)::uuid, ('0a0a0a0a-0000-4000-8000-00000000c00' || k)::uuid, 'Pictures', 'pictures', 0
  FROM (VALUES (1), (2)) AS t(k);
INSERT INTO "custom_tracking_field" ("id", "tabId", "userId", "targetScope", "fieldType", "name", "nameNormalized", "orderIndex", "configuration")
SELECT ('0a0a0a0a-0000-4000-8000-00000000c02' || s.k)::uuid, ('0a0a0a0a-0000-4000-8000-00000000c01' || s.k)::uuid, m."id",
       s.scope::custom_tracking_target_scope_enum, 'IMAGE', 'Screenshot', 'screenshot', 0, '{}'::jsonb
  FROM members m, (VALUES (1, 'ACCOUNT'), (2, 'CHARACTER')) AS s(k, scope) WHERE m.n = 3;
INSERT INTO "custom_tracking_value" ("id", "fieldId", "targetScope", "accountId", "characterId")
SELECT '0a0a0a0a-0000-4000-8000-00000000c031'::uuid, '0a0a0a0a-0000-4000-8000-00000000c021'::uuid, 'ACCOUNT'::custom_tracking_target_scope_enum,
       (SELECT a."id" FROM "account" a WHERE a."userId" = m."id" ORDER BY a."handleSlug" LIMIT 1), NULL::uuid
  FROM members m WHERE m.n = 3
UNION ALL
SELECT '0a0a0a0a-0000-4000-8000-00000000c032'::uuid, '0a0a0a0a-0000-4000-8000-00000000c022'::uuid, 'CHARACTER'::custom_tracking_target_scope_enum,
       NULL, (SELECT "id" FROM pictured WHERE n = 3);
INSERT INTO "custom_tracking_image_value" ("id", "valueId", "cloudflareImageId", "altText", "shape")
SELECT ('0a0a0a0a-0000-4000-8000-00000000c04' || k)::uuid, ('0a0a0a0a-0000-4000-8000-00000000c03' || k)::uuid,
       'production-' || m."id" || '-tracking-' || k || '-1767000000008', 'Screenshot ' || k, 'LANDSCAPE'
  FROM members m, (VALUES (1), (2)) AS t(k) WHERE m.n = 3;

-- Audit snapshots: the three entities FC-038 keeps identifiers of, and one it
-- does not touch.
INSERT INTO "_audit" ("entity", "action", "entityId", "oldValue", "newValue", "userId")
VALUES ('NewsPostEntity', 'UPDATE', '0a0a0a0a-0000-4000-8000-00000000ae01',
        '{"id": "0a0a0a0a-0000-4000-8000-00000000ae01", "title": "Before", "authorId": "x"}',
        '{"id": "0a0a0a0a-0000-4000-8000-00000000ae01", "title": "After", "authorId": "x"}', NULL),
       ('ContactRequestEntity', 'INSERT', '0a0a0a0a-0000-4000-8000-00000000ad02', NULL,
        '{"id": "0a0a0a0a-0000-4000-8000-00000000ad02", "email": "someone@rehearsal.example", "message": "Hello"}', NULL),
       ('UserReportEntity', 'INSERT', '0a0a0a0a-0000-4000-8000-00000000ad03', NULL,
        '{"id": "0a0a0a0a-0000-4000-8000-00000000ad03", "details": "Words", "reporterId": "y"}', NULL),
       ('CharacterEntity', 'UPDATE', '0a0a0a0a-0000-4000-8000-00000000ad04',
        '{"id": "0a0a0a0a-0000-4000-8000-00000000ad04", "handle": "Before"}',
        '{"id": "0a0a0a0a-0000-4000-8000-00000000ad04", "handle": "After"}', NULL);

-- A contact request, a member report, a friendship and a block.
INSERT INTO "contact_request" ("name", "emailMasked", "topic", "message")
VALUES ('Rehearsal', 's*****@rehearsal.example', 'question', 'A question before the release.');
INSERT INTO "user_report" ("reporterId", "reportedId", "reason", "details")
VALUES ((SELECT "id" FROM members WHERE n = 1), (SELECT "id" FROM members WHERE n = 2), 'SPAM', 'Reported before the release.');
INSERT INTO "friendship" ("requesterId", "addresseeId", "status")
VALUES ((SELECT "id" FROM members WHERE n = 1), (SELECT "id" FROM members WHERE n = 3), 'ACCEPTED');
INSERT INTO "user_block" ("blockerId", "blockedId")
VALUES ((SELECT "id" FROM members WHERE n = 2), (SELECT "id" FROM members WHERE n = 3));

-- The feature switches, both on, as a site with them in use has them.
UPDATE "app_setting" SET "value" = 'true' WHERE "key" IN ('STORYTIME_ENABLED', 'CUSTOM_TRACKING_ENABLED');

DROP TABLE members, pictured;

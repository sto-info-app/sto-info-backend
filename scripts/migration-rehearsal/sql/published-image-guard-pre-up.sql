SET search_path TO "sto_info_app";

-- FC-042's published-picture guard, loaded before the migration runs.
--
-- The registry and the four picture tables stubs.sql lacks are stand-ins
-- rather than the real tables, for the reason the other registry suites give:
-- this suite rehearses the guard, and the migrations that build the real
-- tables would rehearse themselves instead. The state column keeps the real
-- enum type, so a misspelt state in the guard fails here rather than on a
-- deploy.
CREATE TYPE "sto_info_app"."file_asset_state_enum" AS ENUM ('UNVERIFIED', 'RECEIVING', 'QUARANTINED', 'SCANNING', 'CLEAN', 'AVAILABLE', 'RETRY_PENDING', 'REJECTED', 'REVOKED', 'DELETED');

CREATE TABLE "sto_info_app"."file_asset" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "state" "sto_info_app"."file_asset_state_enum" NOT NULL,
  "deliveryReference" varchar(255),
  CONSTRAINT "PK_file_asset_stub" PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "UX_file_asset_delivery_reference" ON "sto_info_app"."file_asset" ("deliveryReference") WHERE "deliveryReference" IS NOT NULL;

CREATE TABLE "sto_info_app"."fleet_community" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "bannerImageId" character varying(160) NULL DEFAULT NULL,
  "emblemImageId" character varying(160) NULL DEFAULT NULL,
  CONSTRAINT "PK_fleet_community" PRIMARY KEY ("id"));

CREATE TABLE "sto_info_app"."sto_fleet" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "bannerImageId" character varying(160) NULL DEFAULT NULL,
  "emblemImageId" character varying(160) NULL DEFAULT NULL,
  CONSTRAINT "PK_sto_fleet" PRIMARY KEY ("id"));

CREATE TABLE "sto_info_app"."sto_armada" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "bannerImageId" character varying(160) NULL DEFAULT NULL,
  "emblemImageId" character varying(160) NULL DEFAULT NULL,
  CONSTRAINT "PK_sto_armada" PRIMARY KEY ("id"));

CREATE TABLE "sto_info_app"."news_post" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "coverImageId" character varying(255) NULL DEFAULT NULL,
  CONSTRAINT "PK_news_post" PRIMARY KEY ("id"));

-- One row in every picture table, each holding a reference the registry has
-- never heard of: the estate as it stood before the guard. The guard checks
-- writes, not rows, so these must survive it and stay editable.
INSERT INTO "user" ("id") VALUES ('00000000-0000-0000-0000-00000000f001');
INSERT INTO "user_profile" ("userId", "profilePictureId") VALUES ('00000000-0000-0000-0000-00000000f001', 'pre-guard-picture');
INSERT INTO "character" ("id", "profilePictureId") VALUES ('00000000-0000-0000-0000-00000000f001', 'pre-guard-picture');
INSERT INTO "storytime_arc" ("id", "bannerImageId", "profileImageId") VALUES ('00000000-0000-0000-0000-00000000f001', 'pre-guard-picture', 'pre-guard-picture');
INSERT INTO "storytime_story" ("id", "bannerImageId", "profileImageId") VALUES ('00000000-0000-0000-0000-00000000f001', 'pre-guard-picture', 'pre-guard-picture');
INSERT INTO "storytime_chapter" ("id", "coverImageId") VALUES ('00000000-0000-0000-0000-00000000f001', 'pre-guard-picture');
INSERT INTO "storytime_character" ("id", "portraitImageId") VALUES ('00000000-0000-0000-0000-00000000f001', 'pre-guard-picture');
INSERT INTO "storytime_spotlight" ("id", "overrideImageId") VALUES ('00000000-0000-0000-0000-00000000f001', 'pre-guard-picture');
INSERT INTO "custom_tracking_image_value" ("id", "cloudflareImageId") VALUES ('00000000-0000-0000-0000-00000000f001', 'pre-guard-picture');
INSERT INTO "fleet_community" ("id", "bannerImageId", "emblemImageId") VALUES ('00000000-0000-0000-0000-00000000f001', 'pre-guard-picture', 'pre-guard-picture');
INSERT INTO "sto_fleet" ("id", "bannerImageId", "emblemImageId") VALUES ('00000000-0000-0000-0000-00000000f001', 'pre-guard-picture', 'pre-guard-picture');
INSERT INTO "sto_armada" ("id", "bannerImageId", "emblemImageId") VALUES ('00000000-0000-0000-0000-00000000f001', 'pre-guard-picture', 'pre-guard-picture');
INSERT INTO "news_post" ("id", "coverImageId") VALUES ('00000000-0000-0000-0000-00000000f001', 'pre-guard-picture');

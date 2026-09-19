-- Minimal stand-ins for the existing tables the FC-004 migration references.
-- Only the columns the foreign keys need.
CREATE SCHEMA "sto_info_app";

CREATE TABLE "sto_info_app"."user" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  CONSTRAINT "PK_user" PRIMARY KEY ("id"));

CREATE TABLE "sto_info_app"."platform" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  CONSTRAINT "PK_platform" PRIMARY KEY ("id"));

CREATE TABLE "sto_info_app"."character_general_faction" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  CONSTRAINT "PK_character_general_faction" PRIMARY KEY ("id"));

CREATE TABLE "sto_info_app"."character" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  CONSTRAINT "PK_character" PRIMARY KEY ("id"));

-- Stand-ins for the tables the FC-006 migrations reference. `user_profile`
-- carries the two columns that migration moves out of it, including the check
-- constraint it drops by name; `app_setting` carries the unique key the feature
-- switch seed conflicts against.
CREATE TABLE "sto_info_app"."user_profile" (
  "userId" uuid NOT NULL,
  "privacyMode" boolean NOT NULL DEFAULT false,
  "sessionTimeoutMinutes" integer NULL DEFAULT NULL,
  CONSTRAINT "PK_user_profile" PRIMARY KEY ("userId"),
  CONSTRAINT "CHK_user_profile_session_timeout" CHECK ("sessionTimeoutMinutes" IN (60, 240, 480)),
  CONSTRAINT "FK_user_profile_user" FOREIGN KEY ("userId") REFERENCES "sto_info_app"."user"("id") ON DELETE CASCADE);

CREATE TABLE "sto_info_app"."app_setting" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "key" character varying(80) NOT NULL,
  "value" character varying(500) NOT NULL,
  "description" character varying(500) NULL DEFAULT NULL,
  CONSTRAINT "PK_app_setting" PRIMARY KEY ("id"),
  CONSTRAINT "UQ_app_setting_key" UNIQUE ("key"));

-- The columns FC-006's follow-up converts from `timestamp` to `date`. The
-- stubs carry them as timestamps, which is the state the migration expects to
-- find, and `character` gains the column it is altered on.
CREATE TABLE "sto_info_app"."account" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "handle" character varying(255) NOT NULL,
  "accountCreatedDate" TIMESTAMP NULL DEFAULT NULL,
  CONSTRAINT "PK_account" PRIMARY KEY ("id"));

ALTER TABLE "sto_info_app"."character" ADD COLUMN "createdDate" TIMESTAMP NULL DEFAULT NULL;

-- Stand-ins for the tables FC-008's backfill reads. Only the columns it
-- selects: the image reference, and whatever leads from it to a user. Every
-- Storytime table keeps the owner path the backfill follows, which is why
-- `storytime_chapter` and `storytime_character` carry a `storyId` and nothing
-- else about a chapter or a character.
ALTER TABLE "sto_info_app"."user_profile" ADD COLUMN "profilePictureId" character varying(255) NULL DEFAULT NULL;
ALTER TABLE "sto_info_app"."character" ADD COLUMN "profilePictureId" character varying(255) NULL DEFAULT NULL;
ALTER TABLE "sto_info_app"."character" ADD COLUMN "accountId" uuid NULL DEFAULT NULL;
ALTER TABLE "sto_info_app"."account" ADD COLUMN "userId" uuid NULL DEFAULT NULL;

CREATE TABLE "sto_info_app"."storytime_arc" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "ownerUserId" uuid NULL DEFAULT NULL,
  "bannerImageId" character varying(255) NULL DEFAULT NULL,
  "profileImageId" character varying(255) NULL DEFAULT NULL,
  CONSTRAINT "PK_storytime_arc" PRIMARY KEY ("id"));

CREATE TABLE "sto_info_app"."storytime_story" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "ownerUserId" uuid NULL DEFAULT NULL,
  "bannerImageId" character varying(255) NULL DEFAULT NULL,
  "profileImageId" character varying(255) NULL DEFAULT NULL,
  CONSTRAINT "PK_storytime_story" PRIMARY KEY ("id"));

CREATE TABLE "sto_info_app"."storytime_chapter" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "storyId" uuid NULL DEFAULT NULL,
  "coverImageId" character varying(255) NULL DEFAULT NULL,
  CONSTRAINT "PK_storytime_chapter" PRIMARY KEY ("id"));

CREATE TABLE "sto_info_app"."storytime_character" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "storyId" uuid NULL DEFAULT NULL,
  "portraitImageId" character varying(255) NULL DEFAULT NULL,
  CONSTRAINT "PK_storytime_character" PRIMARY KEY ("id"));

CREATE TABLE "sto_info_app"."storytime_spotlight" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "createdByUserId" uuid NULL DEFAULT NULL,
  "overrideImageId" character varying(255) NULL DEFAULT NULL,
  CONSTRAINT "PK_storytime_spotlight" PRIMARY KEY ("id"));

CREATE TABLE "sto_info_app"."custom_tracking_value" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "accountId" uuid NULL DEFAULT NULL,
  "characterId" uuid NULL DEFAULT NULL,
  CONSTRAINT "PK_custom_tracking_value" PRIMARY KEY ("id"));

CREATE TABLE "sto_info_app"."custom_tracking_image_value" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "valueId" uuid NULL DEFAULT NULL,
  "cloudflareImageId" character varying(255) NOT NULL,
  CONSTRAINT "PK_custom_tracking_image_value" PRIMARY KEY ("id"));

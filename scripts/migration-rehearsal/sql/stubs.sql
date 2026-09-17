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

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Chat for Communities, Fleets and Armadas, and between friends (FC-031).
 *
 * With Steve's decisions of 28 September 2026:
 *
 * - `chat_channel`: one standard channel per scope, and up to three custom
 *   ones, each with the least role that may read it and the least that may
 *   post (never lower than reading). A trigger holds the scope's lock while
 *   it counts, so two creations at once cannot make a fourth.
 * - `chat_direct_conversation`: one per pair of people, lower ID first.
 *   Whether they may use it — friends, neither blocking — is asked at every
 *   read and post, never stored.
 * - `chat_message`: plain text, 2,000 characters at most, in a channel or a
 *   conversation. `clientMessageId` is unique per author, so a resend is one
 *   message. A reply names a message; the service keeps it in the same
 *   place.
 * - `chat_action`: what moderators and managers did, write-once.
 */
export class CreateChat1796000000000 implements MigrationInterface {
  name = 'CreateChat1796000000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."chat_channel_kind_enum" AS ENUM ('STANDARD', 'CUSTOM')`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."chat_action_kind_enum" AS ENUM ('CHANNEL_CREATED', 'CHANNEL_CHANGED', 'CHANNEL_ARCHIVED', 'MESSAGE_REMOVED')`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."chat_channel" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "communityId" uuid NOT NULL,
      "fleetId" uuid,
      "armadaId" uuid,
      "kind" "sto_info_app"."chat_channel_kind_enum" NOT NULL,
      "name" varchar(50) NOT NULL,
      "readRole" "sto_info_app"."fleet_scope_role_enum" NOT NULL DEFAULT 'MEMBER',
      "postRole" "sto_info_app"."fleet_scope_role_enum" NOT NULL DEFAULT 'MEMBER',
      "createdByUserId" uuid,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "archivedAt" timestamptz,
      CONSTRAINT "PK_chat_channel" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_chat_channel_scope" CHECK ("fleetId" IS NULL OR "armadaId" IS NULL),
      CONSTRAINT "CHK_chat_channel_standard" CHECK ("kind" = 'CUSTOM' OR ("readRole" = 'MEMBER' AND "postRole" = 'MEMBER' AND "archivedAt" IS NULL)),
      CONSTRAINT "CHK_chat_channel_post_role" CHECK ("postRole" <= "readRole"),
      CONSTRAINT "CHK_chat_channel_name" CHECK (length(btrim("name")) BETWEEN 1 AND 50),
      CONSTRAINT "FK_chat_channel_community" FOREIGN KEY ("communityId") REFERENCES "sto_info_app"."fleet_community"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_chat_channel_fleet" FOREIGN KEY ("fleetId", "communityId") REFERENCES "sto_info_app"."sto_fleet"("id", "communityId") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_chat_channel_armada" FOREIGN KEY ("armadaId", "communityId") REFERENCES "sto_info_app"."sto_armada"("id", "communityId") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_chat_channel_creator" FOREIGN KEY ("createdByUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_chat_channel_standard" ON "sto_info_app"."chat_channel" ("communityId", COALESCE("fleetId", '00000000-0000-0000-0000-000000000000'::uuid), COALESCE("armadaId", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "kind" = 'STANDARD'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_chat_channel_name" ON "sto_info_app"."chat_channel" ("communityId", COALESCE("fleetId", '00000000-0000-0000-0000-000000000000'::uuid), COALESCE("armadaId", '00000000-0000-0000-0000-000000000000'::uuid), lower("name")) WHERE "archivedAt" IS NULL`,
    );
    // The per-scope ceiling on custom channels, under the scope's lock, so
    // two creations at once are counted one after the other.
    await queryRunner.query(`CREATE OR REPLACE FUNCTION "sto_info_app"."chat_channel_limit"()
      RETURNS trigger AS $$
      BEGIN
        IF NEW."kind" = 'CUSTOM' AND NEW."archivedAt" IS NULL THEN
          PERFORM pg_advisory_xact_lock(hashtext('chat-channel:' || NEW."communityId"::text || ':' || COALESCE(NEW."fleetId"::text, '') || ':' || COALESCE(NEW."armadaId"::text, '')));
          IF (SELECT count(*) FROM "sto_info_app"."chat_channel"
              WHERE "communityId" = NEW."communityId"
                AND "fleetId" IS NOT DISTINCT FROM NEW."fleetId"
                AND "armadaId" IS NOT DISTINCT FROM NEW."armadaId"
                AND "kind" = 'CUSTOM'
                AND "archivedAt" IS NULL
                AND "id" <> NEW."id") >= 3 THEN
            RAISE EXCEPTION 'chat_channel custom limit reached' USING ERRCODE = '23514';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(
      `CREATE TRIGGER "TR_chat_channel_limit" BEFORE INSERT OR UPDATE OF "archivedAt", "kind" ON "sto_info_app"."chat_channel" FOR EACH ROW EXECUTE FUNCTION "sto_info_app"."chat_channel_limit"()`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."chat_direct_conversation" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "userLowId" uuid NOT NULL,
      "userHighId" uuid NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_chat_direct_conversation" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_chat_direct_conversation_pair" UNIQUE ("userLowId", "userHighId"),
      CONSTRAINT "CHK_chat_direct_conversation_order" CHECK ("userLowId" < "userHighId"),
      CONSTRAINT "FK_chat_direct_conversation_low" FOREIGN KEY ("userLowId") REFERENCES "sto_info_app"."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_chat_direct_conversation_high" FOREIGN KEY ("userHighId") REFERENCES "sto_info_app"."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE INDEX "IDX_chat_direct_conversation_high" ON "sto_info_app"."chat_direct_conversation" ("userHighId")`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."chat_message" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "channelId" uuid,
      "conversationId" uuid,
      "authorUserId" uuid,
      "clientMessageId" uuid NOT NULL,
      "body" varchar(2000) NOT NULL,
      "mentions" uuid[] NOT NULL DEFAULT '{}',
      "replyToMessageId" uuid,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      "deletedByUserId" uuid,
      CONSTRAINT "PK_chat_message" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_chat_message_client" UNIQUE ("authorUserId", "clientMessageId"),
      CONSTRAINT "CHK_chat_message_place" CHECK (("channelId" IS NULL) <> ("conversationId" IS NULL)),
      CONSTRAINT "CHK_chat_message_body" CHECK (length(btrim("body")) BETWEEN 1 AND 2000),
      CONSTRAINT "FK_chat_message_channel" FOREIGN KEY ("channelId") REFERENCES "sto_info_app"."chat_channel"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_chat_message_conversation" FOREIGN KEY ("conversationId") REFERENCES "sto_info_app"."chat_direct_conversation"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_chat_message_author" FOREIGN KEY ("authorUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
      CONSTRAINT "FK_chat_message_reply" FOREIGN KEY ("replyToMessageId") REFERENCES "sto_info_app"."chat_message"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
      CONSTRAINT "FK_chat_message_deleted_by" FOREIGN KEY ("deletedByUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE INDEX "IDX_chat_message_channel" ON "sto_info_app"."chat_message" ("channelId", "createdAt", "id") WHERE "channelId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_chat_message_conversation" ON "sto_info_app"."chat_message" ("conversationId", "createdAt", "id") WHERE "conversationId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_chat_message_created" ON "sto_info_app"."chat_message" ("createdAt")`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."chat_action" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "channelId" uuid,
      "messageId" uuid,
      "action" "sto_info_app"."chat_action_kind_enum" NOT NULL,
      "actorUserId" uuid,
      "reason" varchar(500),
      "detail" jsonb,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_chat_action" PRIMARY KEY ("id"),
      CONSTRAINT "FK_chat_action_channel" FOREIGN KEY ("channelId") REFERENCES "sto_info_app"."chat_channel"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_chat_action_message" FOREIGN KEY ("messageId") REFERENCES "sto_info_app"."chat_message"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
      CONSTRAINT "FK_chat_action_actor" FOREIGN KEY ("actorUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE INDEX "IDX_chat_action_channel" ON "sto_info_app"."chat_action" ("channelId", "createdAt")`,
    );
    // Write-once, but for the references a deletion is allowed to clear.
    await queryRunner.query(`CREATE OR REPLACE FUNCTION "sto_info_app"."chat_action_guard"()
      RETURNS trigger AS $$
      BEGIN
        IF (to_jsonb(NEW) - 'actorUserId' - 'messageId') IS DISTINCT FROM (to_jsonb(OLD) - 'actorUserId' - 'messageId')
          OR (NEW."actorUserId" IS NOT NULL AND NEW."actorUserId" IS DISTINCT FROM OLD."actorUserId")
          OR (NEW."messageId" IS NOT NULL AND NEW."messageId" IS DISTINCT FROM OLD."messageId") THEN
          RAISE EXCEPTION 'chat_action is write-once' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(
      `CREATE TRIGGER "TR_chat_action_guard" BEFORE UPDATE ON "sto_info_app"."chat_action" FOR EACH ROW EXECUTE FUNCTION "sto_info_app"."chat_action_guard"()`,
    );
  }

  /**
   * Reverts the migration, and every message with it.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "sto_info_app"."chat_action"`);
    await queryRunner.query(
      `DROP FUNCTION "sto_info_app"."chat_action_guard"()`,
    );
    await queryRunner.query(`DROP TABLE "sto_info_app"."chat_message"`);
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."chat_direct_conversation"`,
    );
    await queryRunner.query(`DROP TABLE "sto_info_app"."chat_channel"`);
    await queryRunner.query(
      `DROP FUNCTION "sto_info_app"."chat_channel_limit"()`,
    );
    await queryRunner.query(`DROP TYPE "sto_info_app"."chat_action_kind_enum"`);
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."chat_channel_kind_enum"`,
    );
  }
}

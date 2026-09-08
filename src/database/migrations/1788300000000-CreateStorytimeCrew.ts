import { MigrationInterface, QueryRunner } from 'typeorm';

import { STORYTIME_CREW_ROLES } from '../../storytime/crew/constants/storytime-crew-role.constants';

export class CreateStorytimeCrew1788300000000 implements MigrationInterface {
  name = 'CreateStorytimeCrew1788300000000';

  /**
   * Applies the migration to the database.
   *
   * Adds the three tables behind collaboration and credits.
   *
   * `storytime_story_collaborator` decides who besides the owner may edit a
   * Story. `storytime_crew_credit` is public acknowledgement and confers
   * nothing. They are deliberately separate tables, so thanking somebody in
   * the credits can never hand them the keys.
   *
   * `canPublish` carries a check constraint pinning it to false. Only the
   * owner may publish; the column exists so the model would not need reshaping
   * if that is ever revisited, and the constraint makes sure the decision
   * cannot be quietly bypassed by a stray update in the meantime.
   *
   * The credit uniqueness index coalesces the nullable Chapter and Character
   * columns, because Postgres treats NULLs as distinct — without it the same
   * Story-level credit could be added over and over.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.executeQueries(queryRunner, [
      `
      CREATE TYPE "sto_info_app"."storytime_collaboration_invitation_status_enum"
      AS ENUM ('INVITED', 'ACCEPTED', 'DECLINED', 'REVOKED')
    `,

      `
      CREATE TABLE "sto_info_app"."storytime_story_collaborator" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "storyId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "collaborationRole" character varying(100),
        "canEditStory" boolean NOT NULL DEFAULT false,
        "canManageChapters" boolean NOT NULL DEFAULT false,
        "canPublish" boolean NOT NULL DEFAULT false,
        "canManageCharacters" boolean NOT NULL DEFAULT false,
        "canManageCrew" boolean NOT NULL DEFAULT false,
        "canManageCollaborators" boolean NOT NULL DEFAULT false,
        "invitationStatus" "sto_info_app"."storytime_collaboration_invitation_status_enum"
          NOT NULL DEFAULT 'INVITED',
        "invitedByUserId" uuid NOT NULL,
        "invitedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "acceptedAt" TIMESTAMP,
        "revokedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_storytime_story_collaborator" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_storytime_story_collaborator" UNIQUE ("storyId", "userId"),
        CONSTRAINT "CHK_storytime_collaborator_no_publish" CHECK ("canPublish" = false),
        CONSTRAINT "FK_storytime_story_collaborator_story" FOREIGN KEY ("storyId")
          REFERENCES "sto_info_app"."storytime_story" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_storytime_story_collaborator_user" FOREIGN KEY ("userId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_storytime_story_collaborator_invited_by" FOREIGN KEY ("invitedByUserId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE CASCADE
      )
    `,

      // Drives the invitations somebody is waiting on, and the capability
      // lookup on every edit a collaborator makes.
      `
      CREATE INDEX "IDX_storytime_story_collaborator_by_user"
      ON "sto_info_app"."storytime_story_collaborator" ("userId", "invitationStatus")
    `,

      `
      CREATE TABLE "sto_info_app"."storytime_crew_role" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "code" character varying(50) NOT NULL,
        "name" character varying(100) NOT NULL,
        "description" character varying(500),
        "displayOrder" integer NOT NULL DEFAULT 0,
        "isSystem" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_storytime_crew_role" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_storytime_crew_role_code" UNIQUE ("code")
      )
    `,

      `
      CREATE TABLE "sto_info_app"."storytime_crew_credit" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "storyId" uuid NOT NULL,
        "chapterId" uuid,
        "characterId" uuid,
        "userId" uuid NOT NULL,
        "roleId" uuid NOT NULL,
        "creditLabel" character varying(100),
        "notes" character varying(500),
        "orderIndex" integer NOT NULL DEFAULT 0,
        "validFromChapterId" uuid,
        "validToChapterId" uuid,
        "moderationStatus" "sto_info_app"."storytime_moderation_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "removedAt" TIMESTAMP,
        "removedByUserId" uuid,
        "moderationMessage" character varying(1000),
        "createdByUserId" uuid NOT NULL,
        "updatedByUserId" uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_storytime_crew_credit" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_storytime_crew_credit_order_index" CHECK ("orderIndex" >= 0),
        CONSTRAINT "FK_storytime_crew_credit_story" FOREIGN KEY ("storyId")
          REFERENCES "sto_info_app"."storytime_story" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_storytime_crew_credit_chapter" FOREIGN KEY ("chapterId")
          REFERENCES "sto_info_app"."storytime_chapter" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_storytime_crew_credit_character" FOREIGN KEY ("characterId")
          REFERENCES "sto_info_app"."storytime_character" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_storytime_crew_credit_user" FOREIGN KEY ("userId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_storytime_crew_credit_role" FOREIGN KEY ("roleId")
          REFERENCES "sto_info_app"."storytime_crew_role" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_storytime_crew_credit_valid_from" FOREIGN KEY ("validFromChapterId")
          REFERENCES "sto_info_app"."storytime_chapter" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_storytime_crew_credit_valid_to" FOREIGN KEY ("validToChapterId")
          REFERENCES "sto_info_app"."storytime_chapter" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_storytime_crew_credit_removed_by" FOREIGN KEY ("removedByUserId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE SET NULL
      )
    `,

      // Postgres treats NULLs as distinct, so without coalescing the nullable
      // columns the same Story-level credit could be added repeatedly.
      `
      CREATE UNIQUE INDEX "UQ_storytime_crew_credit"
      ON "sto_info_app"."storytime_crew_credit" (
        "storyId",
        COALESCE("chapterId", '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE("characterId", '00000000-0000-0000-0000-000000000000'::uuid),
        "userId",
        "roleId"
      )
      WHERE "deletedAt" IS NULL
    `,

      // The index behind a Story's credits roll.
      `
      CREATE INDEX "IDX_storytime_crew_credit_listing"
      ON "sto_info_app"."storytime_crew_credit"
        ("storyId", "moderationStatus", "orderIndex")
      WHERE "deletedAt" IS NULL
    `,

      // The index behind a member's own credits across the site.
      `
      CREATE INDEX "IDX_storytime_crew_credit_by_user"
      ON "sto_info_app"."storytime_crew_credit" ("userId")
      WHERE "deletedAt" IS NULL
    `,

      `
      INSERT INTO "sto_info_app"."storytime_crew_role"
        ("code", "name", "description", "displayOrder", "isSystem")
      VALUES ${STORYTIME_CREW_ROLES.map(
        role =>
          `('${role.code}', '${role.name.replace(/'/g, "''")}', '${role.description.replace(/'/g, "''")}', ${role.displayOrder}, true)`,
      ).join(', ')}
    `,
    ]);
  }

  /**
   * Reverts the migration from the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.executeQueries(queryRunner, [
      `DROP TABLE "sto_info_app"."storytime_crew_credit"`,
      `DROP TABLE "sto_info_app"."storytime_crew_role"`,
      `DROP TABLE "sto_info_app"."storytime_story_collaborator"`,
      `DROP TYPE "sto_info_app"."storytime_collaboration_invitation_status_enum"`,
    ]);
  }

  /**
   * Executes migration queries in the given order.
   *
   * @param queryRunner - The TypeORM query runner.
   * @param queries - SQL statements to execute.
   */
  private async executeQueries(
    queryRunner: QueryRunner,
    queries: string[],
  ): Promise<void> {
    for (const query of queries) {
      await queryRunner.query(query);
    }
  }
}

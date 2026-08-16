import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStorytimeArcCollaborator1788600000000 implements MigrationInterface {
  name = 'CreateStorytimeArcCollaborator1788600000000';

  /**
   * Applies the migration to the database.
   *
   * Adds `storytime_arc_collaborator`, the people a curator has invited to
   * help assemble an Arc.
   *
   * Mirrors Story collaboration on purpose, down to the check constraint
   * pinning `canPublish` to false: only the curator may publish, and a rule
   * that load-bearing should not rest on the application alone.
   *
   * Reuses the collaboration invitation status enum rather than declaring a
   * second one, because the lifecycle is identical and two enums that must
   * always agree eventually will not.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.executeQueries(queryRunner, [
      `
      CREATE TABLE "sto_info_app"."storytime_arc_collaborator" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "arcId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "collaborationRole" character varying(100),
        "canEditArc" boolean NOT NULL DEFAULT false,
        "canManageStories" boolean NOT NULL DEFAULT false,
        "canManageCollaborators" boolean NOT NULL DEFAULT false,
        "canPublish" boolean NOT NULL DEFAULT false,
        "invitationStatus" "sto_info_app"."storytime_collaboration_invitation_status_enum"
          NOT NULL DEFAULT 'INVITED',
        "invitedByUserId" uuid NOT NULL,
        "invitedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "acceptedAt" TIMESTAMP,
        "revokedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_storytime_arc_collaborator" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_storytime_arc_collaborator" UNIQUE ("arcId", "userId"),
        CONSTRAINT "CHK_storytime_arc_collaborator_no_publish" CHECK ("canPublish" = false),
        CONSTRAINT "FK_storytime_arc_collaborator_arc" FOREIGN KEY ("arcId")
          REFERENCES "sto_info_app"."storytime_arc" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_storytime_arc_collaborator_user" FOREIGN KEY ("userId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_storytime_arc_collaborator_invited_by" FOREIGN KEY ("invitedByUserId")
          REFERENCES "sto_info_app"."user" ("id") ON DELETE CASCADE
      )
    `,

      // Drives both the invitations somebody is waiting on and the capability
      // lookup on every change a collaborator makes.
      `
      CREATE INDEX "IDX_storytime_arc_collaborator_by_user"
      ON "sto_info_app"."storytime_arc_collaborator" ("userId", "invitationStatus")
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
      `DROP TABLE "sto_info_app"."storytime_arc_collaborator"`,
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

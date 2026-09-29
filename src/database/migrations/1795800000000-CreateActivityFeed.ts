import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Activity feeds for Communities, Fleets and Armadas (FC-029).
 *
 * With Steve's decisions of 28 September 2026:
 *
 * - `activity_event` holds one row per thing that happened: news and events,
 *   membership, roster imports and holdings, Armada placements and
 *   governance. It names its scope, what happened, and who and what it was
 *   about by ID — never a name or a line of text — so the sentence a reader
 *   sees is written from current data after asking again whether they may
 *   see it.
 * - `visibility` records which rule applies: the scope's own visibility,
 *   its members only, or its source's audience.
 * - `idempotencyKey` is unique, so a replayed import or a retried change
 *   writes one item.
 * - Items are kept twelve months, by a daily job.
 *
 * The Fleet and Armada keys are composite with the Community, as elsewhere,
 * and the people it names go with their accounts.
 */
export class CreateActivityFeed1795800000000 implements MigrationInterface {
  name = 'CreateActivityFeed1795800000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."activity_type_enum" AS ENUM ('NEWS_PUBLISHED', 'EVENT_CREATED', 'EVENT_CANCELLED', 'OCCURRENCE_CANCELLED', 'OCCURRENCE_MOVED', 'MEMBER_JOINED', 'MEMBER_LEFT', 'MEMBER_REMOVED', 'ROSTER_IMPORTED', 'HOLDINGS_RECORDED', 'ARMADA_FLEET_PLACED', 'ARMADA_FLEET_MOVED', 'ARMADA_FLEET_LEFT', 'ROLE_APPOINTED', 'ROLE_WITHDRAWN', 'OWNERSHIP_TRANSFERRED', 'SCOPE_CLOSED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."activity_visibility_enum" AS ENUM ('SCOPE', 'MEMBERS', 'SOURCE')`,
    );
    await queryRunner.query(`CREATE TABLE "sto_info_app"."activity_event" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "communityId" uuid NOT NULL,
      "fleetId" uuid,
      "armadaId" uuid,
      "type" "sto_info_app"."activity_type_enum" NOT NULL,
      "visibility" "sto_info_app"."activity_visibility_enum" NOT NULL,
      "actorUserId" uuid,
      "subjectUserId" uuid,
      "sourceId" uuid,
      "detail" jsonb,
      "idempotencyKey" varchar(200) NOT NULL,
      "occurredAt" timestamptz NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_activity_event" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_activity_event_idempotency" UNIQUE ("idempotencyKey"),
      CONSTRAINT "CHK_activity_event_scope" CHECK ("fleetId" IS NULL OR "armadaId" IS NULL),
      CONSTRAINT "FK_activity_event_community" FOREIGN KEY ("communityId") REFERENCES "sto_info_app"."fleet_community"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_activity_event_fleet" FOREIGN KEY ("fleetId", "communityId") REFERENCES "sto_info_app"."sto_fleet"("id", "communityId") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_activity_event_armada" FOREIGN KEY ("armadaId", "communityId") REFERENCES "sto_info_app"."sto_armada"("id", "communityId") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_activity_event_actor" FOREIGN KEY ("actorUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
      CONSTRAINT "FK_activity_event_subject" FOREIGN KEY ("subjectUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE INDEX "IDX_activity_event_scope" ON "sto_info_app"."activity_event" ("communityId", "fleetId", "armadaId", "occurredAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_activity_event_occurred" ON "sto_info_app"."activity_event" ("occurredAt")`,
    );
  }

  /**
   * Reverts the migration, and every item with it.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "sto_info_app"."activity_event"`);
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."activity_visibility_enum"`,
    );
    await queryRunner.query(`DROP TYPE "sto_info_app"."activity_type_enum"`);
  }
}

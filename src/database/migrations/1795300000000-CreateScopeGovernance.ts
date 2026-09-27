import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records who governs a Community or Fleet, and offers of ownership (FC-022).
 *
 * With the decisions Steve made on 27 September 2026:
 *
 * - `scope_governance_action` is the append-only log of role assignments and
 *   withdrawals, capability grants, denials and clearings, ownership offers
 *   and their answers, a site administrator's dispute actions, and closures.
 *   A reason is required, by check constraint, wherever something is taken
 *   away: withdrawing a role, denying a capability, clearing a grant, a
 *   dispute action and a closure.
 * - `scope_ownership_transfer` holds an offer of a Community's ownership to
 *   one of its Admins, which lapses after seven days. Ownership itself stays
 *   in `fleet_community.ownerUserId`, so there is always exactly one Owner.
 *   At most one offer per Community is open, and an answered one never
 *   changes.
 *
 * Both tables are evidence. The only later change either accepts is a named
 * user's account being deleted.
 */
export class CreateScopeGovernance1795300000000 implements MigrationInterface {
  name = 'CreateScopeGovernance1795300000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."scope_governance_action_enum" AS ENUM ('ROLE_ASSIGNED', 'ROLE_WITHDRAWN', 'CAPABILITY_GRANTED', 'CAPABILITY_DENIED', 'CAPABILITY_CLEARED', 'OWNERSHIP_OFFERED', 'OWNERSHIP_ACCEPTED', 'OWNERSHIP_DECLINED', 'OWNERSHIP_CANCELLED', 'OWNERSHIP_REASSIGNED', 'CLOSED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."scope_ownership_transfer_status_enum" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'LAPSED')`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."scope_ownership_transfer" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "communityId" uuid NOT NULL,
      "fromUserId" uuid,
      "toUserId" uuid,
      "status" "sto_info_app"."scope_ownership_transfer_status_enum" NOT NULL DEFAULT 'PENDING',
      "offeredAt" timestamptz NOT NULL,
      "expiresAt" timestamptz NOT NULL,
      "answeredAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_scope_ownership_transfer" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_scope_ownership_transfer_answered" CHECK (("status" = 'PENDING') = ("answeredAt" IS NULL)),
      CONSTRAINT "CHK_scope_ownership_transfer_parties" CHECK ("fromUserId" IS NULL OR "toUserId" IS NULL OR "fromUserId" <> "toUserId"),
      CONSTRAINT "CHK_scope_ownership_transfer_expiry" CHECK ("expiresAt" > "offeredAt"),
      CONSTRAINT "FK_scope_ownership_transfer_community" FOREIGN KEY ("communityId") REFERENCES "sto_info_app"."fleet_community"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_scope_ownership_transfer_from" FOREIGN KEY ("fromUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
      CONSTRAINT "FK_scope_ownership_transfer_to" FOREIGN KEY ("toUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_scope_ownership_transfer_open" ON "sto_info_app"."scope_ownership_transfer" ("communityId") WHERE "status" = 'PENDING'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scope_ownership_transfer_to" ON "sto_info_app"."scope_ownership_transfer" ("toUserId", "status")`,
    );

    await queryRunner.query(`CREATE TABLE "sto_info_app"."scope_governance_action" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "communityId" uuid NOT NULL,
      "fleetId" uuid,
      "action" "sto_info_app"."scope_governance_action_enum" NOT NULL,
      "actorUserId" uuid,
      "asSiteAdmin" boolean NOT NULL DEFAULT false,
      "subjectUserId" uuid,
      "role" "sto_info_app"."fleet_scope_role_enum",
      "capability" varchar(100),
      "clearedEffect" "sto_info_app"."scope_capability_effect_enum",
      "reason" varchar(500),
      "transferId" uuid,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_scope_governance_action" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_scope_governance_action_reason" CHECK ("action" NOT IN ('ROLE_WITHDRAWN', 'CAPABILITY_DENIED', 'OWNERSHIP_REASSIGNED', 'CLOSED') OR ("reason" IS NOT NULL AND length(btrim("reason")) > 0)),
      CONSTRAINT "CHK_scope_governance_action_cleared_grant_reason" CHECK ("action" <> 'CAPABILITY_CLEARED' OR "clearedEffect" <> 'GRANT' OR ("reason" IS NOT NULL AND length(btrim("reason")) > 0)),
      CONSTRAINT "CHK_scope_governance_action_role" CHECK ("action" NOT IN ('ROLE_ASSIGNED', 'ROLE_WITHDRAWN') OR "role" IS NOT NULL),
      CONSTRAINT "CHK_scope_governance_action_capability" CHECK (("action" IN ('CAPABILITY_GRANTED', 'CAPABILITY_DENIED', 'CAPABILITY_CLEARED')) = ("capability" IS NOT NULL)),
      CONSTRAINT "CHK_scope_governance_action_cleared_effect" CHECK (("action" = 'CAPABILITY_CLEARED') = ("clearedEffect" IS NOT NULL)),
      CONSTRAINT "CHK_scope_governance_action_site_admin" CHECK (NOT "asSiteAdmin" OR "action" IN ('OWNERSHIP_REASSIGNED', 'OWNERSHIP_CANCELLED', 'CLOSED')),
      CONSTRAINT "FK_scope_governance_action_community" FOREIGN KEY ("communityId") REFERENCES "sto_info_app"."fleet_community"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_scope_governance_action_fleet" FOREIGN KEY ("fleetId") REFERENCES "sto_info_app"."sto_fleet"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_scope_governance_action_actor" FOREIGN KEY ("actorUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
      CONSTRAINT "FK_scope_governance_action_subject" FOREIGN KEY ("subjectUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
      CONSTRAINT "FK_scope_governance_action_transfer" FOREIGN KEY ("transferId") REFERENCES "sto_info_app"."scope_ownership_transfer"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE INDEX "IDX_scope_governance_action_community" ON "sto_info_app"."scope_governance_action" ("communityId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scope_governance_action_fleet" ON "sto_info_app"."scope_governance_action" ("fleetId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scope_governance_action_actor" ON "sto_info_app"."scope_governance_action" ("actorUserId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scope_governance_action_subject" ON "sto_info_app"."scope_governance_action" ("subjectUserId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scope_governance_action_transfer" ON "sto_info_app"."scope_governance_action" ("transferId")`,
    );

    // A logged action is evidence. The one change it accepts is a person it
    // names, or the offer it cites, going.
    await queryRunner.query(`CREATE OR REPLACE FUNCTION "sto_info_app"."scope_governance_action_guard"()
      RETURNS trigger AS $$
      BEGIN
        IF (to_jsonb(NEW) - 'actorUserId' - 'subjectUserId' - 'transferId')
            IS DISTINCT FROM (to_jsonb(OLD) - 'actorUserId' - 'subjectUserId' - 'transferId')
          OR (NEW."actorUserId" IS NOT NULL AND NEW."actorUserId" IS DISTINCT FROM OLD."actorUserId")
          OR (NEW."subjectUserId" IS NOT NULL AND NEW."subjectUserId" IS DISTINCT FROM OLD."subjectUserId")
          OR (NEW."transferId" IS NOT NULL AND NEW."transferId" IS DISTINCT FROM OLD."transferId") THEN
          RAISE EXCEPTION 'scope_governance_action is write-once' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(
      `CREATE TRIGGER "TR_scope_governance_action_guard" BEFORE UPDATE ON "sto_info_app"."scope_governance_action" FOR EACH ROW EXECUTE FUNCTION "sto_info_app"."scope_governance_action_guard"()`,
    );

    // What was offered, to whom and until when never changes. An answer is
    // given once, from PENDING, and then stands.
    await queryRunner.query(`CREATE OR REPLACE FUNCTION "sto_info_app"."scope_ownership_transfer_guard"()
      RETURNS trigger AS $$
      BEGIN
        IF NEW."communityId" IS DISTINCT FROM OLD."communityId"
          OR NEW."offeredAt" IS DISTINCT FROM OLD."offeredAt"
          OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
          OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
          OR (NEW."fromUserId" IS NOT NULL AND NEW."fromUserId" IS DISTINCT FROM OLD."fromUserId")
          OR (NEW."toUserId" IS NOT NULL AND NEW."toUserId" IS DISTINCT FROM OLD."toUserId") THEN
          RAISE EXCEPTION 'An ownership offer cannot change what was offered' USING ERRCODE = '23514';
        END IF;
        IF OLD."status" <> 'PENDING' AND (
          NEW."status" IS DISTINCT FROM OLD."status"
          OR NEW."answeredAt" IS DISTINCT FROM OLD."answeredAt") THEN
          RAISE EXCEPTION 'An answered ownership offer cannot be changed' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(
      `CREATE TRIGGER "TR_scope_ownership_transfer_guard" BEFORE UPDATE ON "sto_info_app"."scope_ownership_transfer" FOR EACH ROW EXECUTE FUNCTION "sto_info_app"."scope_ownership_transfer_guard"()`,
    );
  }

  /**
   * Reverts the migration.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TR_scope_ownership_transfer_guard" ON "sto_info_app"."scope_ownership_transfer"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "sto_info_app"."scope_ownership_transfer_guard"()`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TR_scope_governance_action_guard" ON "sto_info_app"."scope_governance_action"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "sto_info_app"."scope_governance_action_guard"()`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."scope_governance_action"`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."scope_ownership_transfer"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."scope_ownership_transfer_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."scope_governance_action_enum"`,
    );
  }
}

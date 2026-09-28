import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Arranges Fleets in an Armada by request and approval, with a history of
 * every placement, move and departure (FC-024, FC-025).
 *
 * With the decisions Steve made on 28 September 2026:
 *
 * - An Armada has an allegiance, Federation or Klingon, and a Fleet must share
 *   it to be placed. `sto_armada.allegianceFactionId` is nullable here only
 *   because an Armada registered before now has none; the service requires it
 *   of every registration, and an Armada with none accepts no Fleet.
 * - The Alpha slot may stand empty. A Beta therefore reports to the Armada's
 *   Alpha slot, not to one Alpha's placement, and only a Gamma names a parent:
 *   the Beta it sits under. `CHK_armada_fleet_membership_parent` changes to
 *   say so, and any Beta recorded under the old rule loses its parent.
 * - A placement is evidence. `TR_armada_fleet_membership_guard` lets it end
 *   once and lets its recorder's account go, and refuses anything else.
 * - `armada_join_request` holds a Fleet's request to join, which lapses after
 *   fourteen days. A Fleet has at most one open request at a time
 *   (`UX_armada_join_request_open`); an answered one never changes; a
 *   rejection carries its reason; an approval names the placement it made.
 * - `armada_action` is the append-only history of the Armada's shape: each
 *   placement, move, departure, removal and end by closure, from where to
 *   where, grouped by the change that made it. A move, a departure and a
 *   removal need a reason, by check constraint.
 *
 * - `scope_governance_action` gains `armadaId`, so the roles and delegation
 *   an Owner manages at an Armada are logged there as they are at a Fleet.
 *
 * Every change is recorded at the moment it is made; nothing is back-dated.
 */
export class CreateArmadaTopology1795500000000 implements MigrationInterface {
  name = 'CreateArmadaTopology1795500000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."sto_armada" ADD COLUMN "allegianceFactionId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."sto_armada" ADD CONSTRAINT "FK_sto_armada_allegiance_faction" FOREIGN KEY ("allegianceFactionId") REFERENCES "sto_info_app"."character_general_faction"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    // A Beta reports to the Alpha slot, which may be empty.
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."armada_fleet_membership" DROP CONSTRAINT "CHK_armada_fleet_membership_parent"`,
    );
    await queryRunner.query(
      `UPDATE "sto_info_app"."armada_fleet_membership" SET "parentMembershipId" = NULL WHERE "position" = 'BETA'`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."armada_fleet_membership" ADD CONSTRAINT "CHK_armada_fleet_membership_parent" CHECK (("position" = 'GAMMA') = ("parentMembershipId" IS NOT NULL))`,
    );

    // A placement ends once, and says nothing new after that.
    await queryRunner.query(`CREATE OR REPLACE FUNCTION "sto_info_app"."armada_fleet_membership_guard"()
      RETURNS trigger AS $$
      BEGIN
        IF (to_jsonb(NEW) - 'validTo' - 'updatedAt' - 'recordedByUserId')
            IS DISTINCT FROM (to_jsonb(OLD) - 'validTo' - 'updatedAt' - 'recordedByUserId')
          OR (NEW."recordedByUserId" IS NOT NULL AND NEW."recordedByUserId" IS DISTINCT FROM OLD."recordedByUserId")
          OR (OLD."validTo" IS NOT NULL AND NEW."validTo" IS DISTINCT FROM OLD."validTo") THEN
          RAISE EXCEPTION 'An Armada placement can only be ended' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(
      `CREATE TRIGGER "TR_armada_fleet_membership_guard" BEFORE UPDATE ON "sto_info_app"."armada_fleet_membership" FOR EACH ROW EXECUTE FUNCTION "sto_info_app"."armada_fleet_membership_guard"()`,
    );

    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."armada_join_request_status_enum" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'LAPSED', 'CANCELLED')`,
    );
    await queryRunner.query(`CREATE TABLE "sto_info_app"."armada_join_request" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "communityId" uuid NOT NULL,
      "armadaId" uuid NOT NULL,
      "fleetId" uuid NOT NULL,
      "requestedByUserId" uuid,
      "message" varchar(500),
      "status" "sto_info_app"."armada_join_request_status_enum" NOT NULL DEFAULT 'PENDING',
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "expiresAt" timestamptz NOT NULL,
      "answeredAt" timestamptz,
      "answeredByUserId" uuid,
      "reason" varchar(500),
      "membershipId" uuid,
      CONSTRAINT "PK_armada_join_request" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_armada_join_request_answered" CHECK (("status" = 'PENDING') = ("answeredAt" IS NULL)),
      CONSTRAINT "CHK_armada_join_request_expiry" CHECK ("expiresAt" > "createdAt"),
      CONSTRAINT "CHK_armada_join_request_message" CHECK ("message" IS NULL OR length(btrim("message")) > 0),
      CONSTRAINT "CHK_armada_join_request_rejection_reason" CHECK ("status" <> 'REJECTED' OR ("reason" IS NOT NULL AND length(btrim("reason")) > 0)),
      CONSTRAINT "CHK_armada_join_request_placement" CHECK (("status" = 'APPROVED') = ("membershipId" IS NOT NULL)),
      CONSTRAINT "FK_armada_join_request_armada" FOREIGN KEY ("armadaId", "communityId") REFERENCES "sto_info_app"."sto_armada"("id", "communityId") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_armada_join_request_fleet" FOREIGN KEY ("fleetId", "communityId") REFERENCES "sto_info_app"."sto_fleet"("id", "communityId") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_armada_join_request_requested_by" FOREIGN KEY ("requestedByUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
      CONSTRAINT "FK_armada_join_request_answered_by" FOREIGN KEY ("answeredByUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
      CONSTRAINT "FK_armada_join_request_membership" FOREIGN KEY ("membershipId") REFERENCES "sto_info_app"."armada_fleet_membership"("id") ON DELETE RESTRICT ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_armada_join_request_open" ON "sto_info_app"."armada_join_request" ("fleetId") WHERE "status" = 'PENDING'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_armada_join_request_armada" ON "sto_info_app"."armada_join_request" ("armadaId", "status", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_armada_join_request_open_expiry" ON "sto_info_app"."armada_join_request" ("expiresAt") WHERE "status" = 'PENDING'`,
    );
    await queryRunner.query(`CREATE OR REPLACE FUNCTION "sto_info_app"."armada_join_request_guard"()
      RETURNS trigger AS $$
      BEGIN
        IF NEW."communityId" IS DISTINCT FROM OLD."communityId"
          OR NEW."armadaId" IS DISTINCT FROM OLD."armadaId"
          OR NEW."fleetId" IS DISTINCT FROM OLD."fleetId"
          OR NEW."message" IS DISTINCT FROM OLD."message"
          OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
          OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
          OR (NEW."requestedByUserId" IS NOT NULL AND NEW."requestedByUserId" IS DISTINCT FROM OLD."requestedByUserId") THEN
          RAISE EXCEPTION 'An Armada request cannot change what was asked' USING ERRCODE = '23514';
        END IF;
        IF OLD."status" <> 'PENDING' AND (
          NEW."status" IS DISTINCT FROM OLD."status"
          OR NEW."answeredAt" IS DISTINCT FROM OLD."answeredAt"
          OR NEW."reason" IS DISTINCT FROM OLD."reason"
          OR NEW."membershipId" IS DISTINCT FROM OLD."membershipId"
          OR (NEW."answeredByUserId" IS NOT NULL AND NEW."answeredByUserId" IS DISTINCT FROM OLD."answeredByUserId")) THEN
          RAISE EXCEPTION 'An answered Armada request cannot be changed' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(
      `CREATE TRIGGER "TR_armada_join_request_guard" BEFORE UPDATE ON "sto_info_app"."armada_join_request" FOR EACH ROW EXECUTE FUNCTION "sto_info_app"."armada_join_request_guard"()`,
    );

    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."armada_action_enum" AS ENUM ('PLACED', 'MOVED', 'LEFT', 'REMOVED', 'CLOSED')`,
    );
    await queryRunner.query(`CREATE TABLE "sto_info_app"."armada_action" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "communityId" uuid NOT NULL,
      "armadaId" uuid NOT NULL,
      "fleetId" uuid NOT NULL,
      "changeId" uuid NOT NULL,
      "action" "sto_info_app"."armada_action_enum" NOT NULL,
      "fromPosition" "sto_info_app"."armada_position_enum",
      "fromParentFleetId" uuid,
      "toPosition" "sto_info_app"."armada_position_enum",
      "toParentFleetId" uuid,
      "actorUserId" uuid,
      "reason" varchar(500),
      "requestId" uuid,
      "createdAt" timestamptz NOT NULL,
      CONSTRAINT "PK_armada_action" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_armada_action_change_fleet" UNIQUE ("changeId", "fleetId"),
      CONSTRAINT "CHK_armada_action_reason" CHECK ("action" NOT IN ('MOVED', 'LEFT', 'REMOVED') OR ("reason" IS NOT NULL AND length(btrim("reason")) > 0)),
      CONSTRAINT "CHK_armada_action_from" CHECK (("action" = 'PLACED') = ("fromPosition" IS NULL)),
      CONSTRAINT "CHK_armada_action_to" CHECK (("action" IN ('PLACED', 'MOVED')) = ("toPosition" IS NOT NULL)),
      CONSTRAINT "CHK_armada_action_from_parent" CHECK (("fromPosition" IS NOT DISTINCT FROM 'GAMMA') = ("fromParentFleetId" IS NOT NULL)),
      CONSTRAINT "CHK_armada_action_to_parent" CHECK (("toPosition" IS NOT DISTINCT FROM 'GAMMA') = ("toParentFleetId" IS NOT NULL)),
      CONSTRAINT "CHK_armada_action_request" CHECK ("requestId" IS NULL OR "action" = 'PLACED'),
      CONSTRAINT "FK_armada_action_armada" FOREIGN KEY ("armadaId", "communityId") REFERENCES "sto_info_app"."sto_armada"("id", "communityId") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_armada_action_fleet" FOREIGN KEY ("fleetId", "communityId") REFERENCES "sto_info_app"."sto_fleet"("id", "communityId") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_armada_action_from_parent" FOREIGN KEY ("fromParentFleetId", "communityId") REFERENCES "sto_info_app"."sto_fleet"("id", "communityId") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_armada_action_to_parent" FOREIGN KEY ("toParentFleetId", "communityId") REFERENCES "sto_info_app"."sto_fleet"("id", "communityId") ON DELETE CASCADE ON UPDATE NO ACTION,
      CONSTRAINT "FK_armada_action_actor" FOREIGN KEY ("actorUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
      CONSTRAINT "FK_armada_action_request" FOREIGN KEY ("requestId") REFERENCES "sto_info_app"."armada_join_request"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
    await queryRunner.query(
      `CREATE INDEX "IDX_armada_action_armada" ON "sto_info_app"."armada_action" ("armadaId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_armada_action_fleet" ON "sto_info_app"."armada_action" ("fleetId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_armada_action_actor" ON "sto_info_app"."armada_action" ("actorUserId")`,
    );
    // A recorded change is evidence. The one change it accepts is a person
    // it names, or the request it cites, going.
    await queryRunner.query(`CREATE OR REPLACE FUNCTION "sto_info_app"."armada_action_guard"()
      RETURNS trigger AS $$
      BEGIN
        IF (to_jsonb(NEW) - 'actorUserId' - 'requestId') IS DISTINCT FROM (to_jsonb(OLD) - 'actorUserId' - 'requestId')
          OR (NEW."actorUserId" IS NOT NULL AND NEW."actorUserId" IS DISTINCT FROM OLD."actorUserId")
          OR (NEW."requestId" IS NOT NULL AND NEW."requestId" IS DISTINCT FROM OLD."requestId") THEN
          RAISE EXCEPTION 'armada_action is write-once' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(
      `CREATE TRIGGER "TR_armada_action_guard" BEFORE UPDATE ON "sto_info_app"."armada_action" FOR EACH ROW EXECUTE FUNCTION "sto_info_app"."armada_action_guard"()`,
    );

    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."scope_governance_action" ADD COLUMN "armadaId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."scope_governance_action" ADD CONSTRAINT "FK_scope_governance_action_armada" FOREIGN KEY ("armadaId", "communityId") REFERENCES "sto_info_app"."sto_armada"("id", "communityId") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."scope_governance_action" ADD CONSTRAINT "CHK_scope_governance_action_one_child" CHECK ("fleetId" IS NULL OR "armadaId" IS NULL)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scope_governance_action_armada" ON "sto_info_app"."scope_governance_action" ("armadaId", "createdAt")`,
    );
  }

  /**
   * Reverts the migration.
   *
   * The old parent rule needs every Beta to name a parent, which a Beta
   * placed under the new rule does not. Reverting is therefore refused while
   * any Beta placement exists; those have to go first.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_scope_governance_action_armada"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."scope_governance_action" DROP CONSTRAINT "CHK_scope_governance_action_one_child"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."scope_governance_action" DROP CONSTRAINT "FK_scope_governance_action_armada"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."scope_governance_action" DROP COLUMN "armadaId"`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TR_armada_action_guard" ON "sto_info_app"."armada_action"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "sto_info_app"."armada_action_guard"()`,
    );
    await queryRunner.query(`DROP TABLE "sto_info_app"."armada_action"`);
    await queryRunner.query(`DROP TYPE "sto_info_app"."armada_action_enum"`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TR_armada_join_request_guard" ON "sto_info_app"."armada_join_request"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "sto_info_app"."armada_join_request_guard"()`,
    );
    await queryRunner.query(`DROP TABLE "sto_info_app"."armada_join_request"`);
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."armada_join_request_status_enum"`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TR_armada_fleet_membership_guard" ON "sto_info_app"."armada_fleet_membership"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "sto_info_app"."armada_fleet_membership_guard"()`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."armada_fleet_membership" DROP CONSTRAINT "CHK_armada_fleet_membership_parent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."armada_fleet_membership" ADD CONSTRAINT "CHK_armada_fleet_membership_parent" CHECK (("position" = 'ALPHA' AND "parentMembershipId" IS NULL) OR ("position" <> 'ALPHA' AND "parentMembershipId" IS NOT NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."sto_armada" DROP CONSTRAINT "FK_sto_armada_allegiance_faction"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."sto_armada" DROP COLUMN "allegianceFactionId"`,
    );
  }
}

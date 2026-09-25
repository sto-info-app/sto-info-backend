import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets an investigator say how a Fleet's rank labels rank (FC-020).
 *
 * Plan section 3.7: rank text is the Fleet's own, and the corpus has 117
 * labels across its Fleets and no order common to them. A change of label
 * is only ever "rank changed" — FC-019 stores nothing more — unless the Fleet
 * has been given an order, which is what lets a report call it a promotion.
 *
 * ## Tiers, not a list
 *
 * Steve decided on 25 September 2026 that an order is a list of tiers, each
 * holding one or more labels. A move between tiers is a promotion or a
 * demotion; a move within one, which is what renaming a rank looks like, is
 * still "rank changed", and so is a move to or from a label nobody placed.
 * Tier 1 is the highest.
 *
 * `fleet_roster_rank_order` is the order now: one row per placed label,
 * matched to an export row's `guildRank` by its exact text. It is replaced
 * whole by each edit, and read when a page is drawn rather than replayed
 * into a revision, so an edit shows at once. That the tiers run from 1
 * without a gap is the service's to keep, since an edit writes them all.
 *
 * ## Every edit is written down, with a reason
 *
 * `fleet_roster_rank_order_action` keeps each edit's order before and after,
 * who made it and why, append-only and guarded like an import correction:
 * the actor may be cleared when their account goes, and nothing else may
 * change. The two orders are JSON arrays of tiers, each an array of labels.
 */
export class CreateRosterRankOrder1794600000000 implements MigrationInterface {
  name = 'CreateRosterRankOrder1794600000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "sto_info_app"."fleet_roster_rank_order" (
      "fleetId" uuid NOT NULL,
      "label" varchar(255) NOT NULL,
      "tier" integer NOT NULL,
      CONSTRAINT "PK_roster_rank_order" PRIMARY KEY ("fleetId", "label"),
      CONSTRAINT "CHK_roster_rank_order_tier" CHECK ("tier" >= 1),
      CONSTRAINT "FK_roster_rank_order_fleet" FOREIGN KEY ("fleetId") REFERENCES "sto_info_app"."sto_fleet"("id") ON DELETE RESTRICT ON UPDATE NO ACTION)`);

    await queryRunner.query(`CREATE TABLE "sto_info_app"."fleet_roster_rank_order_action" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "fleetId" uuid NOT NULL,
      "actorUserId" uuid,
      "reason" varchar(500) NOT NULL,
      "tiersBefore" jsonb NOT NULL,
      "tiersAfter" jsonb NOT NULL,
      "actedAt" timestamptz NOT NULL DEFAULT now(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_roster_rank_order_action" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_roster_rank_order_action_reason" CHECK (length(btrim("reason")) > 0),
      CONSTRAINT "CHK_roster_rank_order_action_tiers" CHECK (jsonb_typeof("tiersBefore") = 'array' AND jsonb_typeof("tiersAfter") = 'array'),
      CONSTRAINT "FK_roster_rank_order_action_fleet" FOREIGN KEY ("fleetId") REFERENCES "sto_info_app"."sto_fleet"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
      CONSTRAINT "FK_roster_rank_order_action_actor" FOREIGN KEY ("actorUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);

    await queryRunner.query(
      `CREATE INDEX "IDX_roster_rank_order_action_fleet" ON "sto_info_app"."fleet_roster_rank_order_action" ("fleetId", "actedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_roster_rank_order_action_actor" ON "sto_info_app"."fleet_roster_rank_order_action" ("actorUserId")`,
    );

    // The same rule as an import correction: the actor is the one column a
    // later event may change, when their account is deleted.
    await queryRunner.query(`CREATE OR REPLACE FUNCTION "sto_info_app"."roster_rank_order_action_guard"()
      RETURNS trigger AS $$
      BEGIN
        IF (to_jsonb(NEW) - 'actorUserId') IS DISTINCT FROM (to_jsonb(OLD) - 'actorUserId')
          OR (NEW."actorUserId" IS NOT NULL AND NEW."actorUserId" IS DISTINCT FROM OLD."actorUserId") THEN
          RAISE EXCEPTION 'fleet_roster_rank_order_action is write-once' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(
      `CREATE TRIGGER "TR_roster_rank_order_action_guard" BEFORE UPDATE ON "sto_info_app"."fleet_roster_rank_order_action" FOR EACH ROW EXECUTE FUNCTION "sto_info_app"."roster_rank_order_action_guard"()`,
    );
  }

  /**
   * Reverts the migration, losing every Fleet's rank order and its history.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TR_roster_rank_order_action_guard" ON "sto_info_app"."fleet_roster_rank_order_action"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "sto_info_app"."roster_rank_order_action_guard"()`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."fleet_roster_rank_order_action"`,
    );
    await queryRunner.query(
      `DROP TABLE "sto_info_app"."fleet_roster_rank_order"`,
    );
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets a Fleet membership that ends take back the question it asked (FC-021).
 *
 * Accepting an application grants Fleet membership and asks the member to
 * confirm their Character's Fleet once the in-game invitation has happened.
 * Steve decided on 27 September 2026 that when that membership ends — the
 * member leaves, or is removed — before the question is answered, the
 * question is withdrawn: it is about an invitation that is no longer coming.
 * They can still record the Fleet by hand.
 *
 * ## `WITHDRAWN`, the second status nobody chose
 *
 * Like `LAPSED`, the site writes it, and only then. Nobody answered, so
 * `answeredAt` stays null, and the answer check says so. A proposal a roster
 * import raised is not withdrawn: the application only adopted it, so it
 * goes back to being the roster's question instead.
 *
 * ## What is already there
 *
 * Unanswered proposals whose application's membership has already ended are
 * put right the same way, so nobody is left being asked about a Fleet they
 * have left.
 *
 * The type is rebuilt rather than extended, for the reason
 * `LapseCharacterFleetProposals` gives.
 */
export class WithdrawCharacterFleetProposals1795200000000 implements MigrationInterface {
  name = 'WithdrawCharacterFleetProposals1795200000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.rebuildStatus(queryRunner, [
      'PENDING',
      'ACCEPTED',
      'DECLINED',
      'LAPSED',
      'WITHDRAWN',
    ]);

    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_fleet_proposal" ADD CONSTRAINT "CHK_character_fleet_proposal_answer" CHECK (("status" IN ('PENDING', 'LAPSED', 'WITHDRAWN') AND "answeredAt" IS NULL) OR ("status" IN ('ACCEPTED', 'DECLINED') AND "answeredAt" IS NOT NULL))`,
    );

    await queryRunner.query(
      `UPDATE "sto_info_app"."character_fleet_proposal" AS "proposal"
        SET "status" = 'WITHDRAWN'
        FROM "sto_info_app"."fleet_application" AS "application",
          "sto_info_app"."scope_membership" AS "membership"
        WHERE "proposal"."applicationId" = "application"."id"
          AND "proposal"."status" = 'PENDING'
          AND "proposal"."evidenceImportId" IS NULL
          AND "proposal"."observedAt" IS NULL
          AND "membership"."fleetId" = "proposal"."fleetId"
          AND "membership"."userId" = "application"."applicantUserId"
          AND "membership"."deletedAt" IS NULL
          AND "membership"."status" IN ('LEFT', 'REVOKED')`,
    );

    await queryRunner.query(
      `UPDATE "sto_info_app"."character_fleet_proposal" AS "proposal"
        SET "applicationId" = NULL
        FROM "sto_info_app"."fleet_application" AS "application",
          "sto_info_app"."scope_membership" AS "membership"
        WHERE "proposal"."applicationId" = "application"."id"
          AND "proposal"."status" = 'PENDING'
          AND ("proposal"."evidenceImportId" IS NOT NULL
            OR "proposal"."observedAt" IS NOT NULL)
          AND "membership"."fleetId" = "proposal"."fleetId"
          AND "membership"."userId" = "application"."applicantUserId"
          AND "membership"."deletedAt" IS NULL
          AND "membership"."status" IN ('LEFT', 'REVOKED')`,
    );
  }

  /**
   * Reverts the migration.
   *
   * Refuses while any proposal is withdrawn, for the reason
   * `LapseCharacterFleetProposals` refuses over a lapsed one: `PENDING` would
   * ask again about a Fleet the member has left, and `DECLINED` would claim
   * an answer nobody gave. Adopted proposals handed back to the roster stay
   * the roster's.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM "sto_info_app"."character_fleet_proposal" WHERE "status" = 'WITHDRAWN') THEN
          RAISE EXCEPTION 'Cannot revert WithdrawCharacterFleetProposals while withdrawn proposals exist';
        END IF;
      END $$`);

    await this.rebuildStatus(queryRunner, [
      'PENDING',
      'ACCEPTED',
      'DECLINED',
      'LAPSED',
    ]);

    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_fleet_proposal" ADD CONSTRAINT "CHK_character_fleet_proposal_answer" CHECK (("status" IN ('PENDING', 'LAPSED') AND "answeredAt" IS NULL) OR ("status" IN ('ACCEPTED', 'DECLINED') AND "answeredAt" IS NOT NULL))`,
    );
  }

  /**
   * Replaces the status type with one holding exactly the given values.
   *
   * Drops the answer check and the open-proposal index, which both depend on
   * the column's type, and recreates the index afterwards. The check is left
   * to the caller, because its wording is what differs between the two
   * directions.
   *
   * @param queryRunner - The TypeORM query runner.
   * @param values - The values the rebuilt type holds.
   */
  private async rebuildStatus(
    queryRunner: QueryRunner,
    values: readonly string[],
  ): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_fleet_proposal" DROP CONSTRAINT "CHK_character_fleet_proposal_answer"`,
    );
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UX_character_fleet_proposal_open"`,
    );
    await queryRunner.query(
      `ALTER TYPE "sto_info_app"."character_fleet_proposal_status_enum" RENAME TO "character_fleet_proposal_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."character_fleet_proposal_status_enum" AS ENUM (${values
        .map(value => `'${value}'`)
        .join(', ')})`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_fleet_proposal" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_fleet_proposal" ALTER COLUMN "status" TYPE "sto_info_app"."character_fleet_proposal_status_enum" USING "status"::text::"sto_info_app"."character_fleet_proposal_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_fleet_proposal" ALTER COLUMN "status" SET DEFAULT 'PENDING'`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."character_fleet_proposal_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_character_fleet_proposal_open" ON "sto_info_app"."character_fleet_proposal" ("characterId", "fleetId") WHERE "status" = 'PENDING' AND "deletedAt" IS NULL`,
    );
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets a roster import ask again once a proposal has expired unanswered, and
 * makes a proposal cite the import it came from (FC-018).
 *
 * FC-014 allows one `PENDING` proposal per Character and Fleet, and reads
 * expiry from the date rather than storing it. Both were right while nothing
 * raised proposals. FC-018 does, and Steve decided on 24 September 2026 that
 * an expired proposal was never answered, so the next import may ask once
 * more — while a declined one is never asked again. The expired row has to
 * stop being `PENDING` for the new one to exist, and has to stay visible so
 * the owner's history shows the question was asked before.
 *
 * ## `LAPSED`, the one status nobody chose
 *
 * FC-014's rule was that every stored status is something a person did. This
 * adds the exception, deliberately and narrowly: `LAPSED` is written only when
 * a newer proposal replaces an expired one, and the replacement names it in
 * `replacesProposalId`. A lapsed proposal was expired before it lapsed, so
 * nothing a reader could see changes; the status only frees the slot.
 *
 * `UQ_character_fleet_proposal_replaces` lets a proposal be replaced once.
 *
 * ## The type is rebuilt, not extended
 *
 * `ALTER TYPE … ADD VALUE` cannot be used by the statement that follows it in
 * the same transaction, and the answer check has to name the new value. The
 * enum is therefore rebuilt under a new name and swapped in, with the partial
 * index and the check that depend on it dropped first and recreated after.
 *
 * ## The evidence it cites
 *
 * `evidenceImportId` is the import whose roster listed the Character, so a
 * proposal can say which export it rests on as well as when it was taken.
 * `SET NULL`, because an import removed later should not take the owner's
 * answer with it; `observedAt` still says when the evidence was taken.
 */
export class LapseCharacterFleetProposals1794200000000 implements MigrationInterface {
  name = 'LapseCharacterFleetProposals1794200000000';

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
    ]);

    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_fleet_proposal" ADD CONSTRAINT "CHK_character_fleet_proposal_answer" CHECK (("status" IN ('PENDING', 'LAPSED') AND "answeredAt" IS NULL) OR ("status" IN ('ACCEPTED', 'DECLINED') AND "answeredAt" IS NOT NULL))`,
    );

    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_fleet_proposal" ADD COLUMN "replacesProposalId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_fleet_proposal" ADD CONSTRAINT "UQ_character_fleet_proposal_replaces" UNIQUE ("replacesProposalId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_fleet_proposal" ADD CONSTRAINT "CHK_character_fleet_proposal_replaces" CHECK ("replacesProposalId" IS NULL OR "replacesProposalId" <> "id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_fleet_proposal" ADD CONSTRAINT "FK_character_fleet_proposal_replaces" FOREIGN KEY ("replacesProposalId") REFERENCES "sto_info_app"."character_fleet_proposal"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_fleet_proposal" ADD COLUMN "evidenceImportId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_fleet_proposal" ADD CONSTRAINT "FK_character_fleet_proposal_evidence" FOREIGN KEY ("evidenceImportId") REFERENCES "sto_info_app"."fleet_roster_import_source"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_character_fleet_proposal_evidence" ON "sto_info_app"."character_fleet_proposal" ("evidenceImportId")`,
    );
  }

  /**
   * Reverts the migration.
   *
   * Refuses while any proposal has lapsed. The earlier status type has no
   * value for one, and there is no honest status to turn it into: calling it
   * `PENDING` would collide with its replacement, and `DECLINED` would claim
   * an answer nobody gave.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM "sto_info_app"."character_fleet_proposal" WHERE "status" = 'LAPSED') THEN
          RAISE EXCEPTION 'Cannot revert LapseCharacterFleetProposals while lapsed proposals exist';
        END IF;
      END $$`);

    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_character_fleet_proposal_evidence"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_fleet_proposal" DROP CONSTRAINT "FK_character_fleet_proposal_evidence"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_fleet_proposal" DROP COLUMN "evidenceImportId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_fleet_proposal" DROP CONSTRAINT "FK_character_fleet_proposal_replaces"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_fleet_proposal" DROP CONSTRAINT "CHK_character_fleet_proposal_replaces"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_fleet_proposal" DROP CONSTRAINT "UQ_character_fleet_proposal_replaces"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_fleet_proposal" DROP COLUMN "replacesProposalId"`,
    );

    await this.rebuildStatus(queryRunner, ['PENDING', 'ACCEPTED', 'DECLINED']);

    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_fleet_proposal" ADD CONSTRAINT "CHK_character_fleet_proposal_answer" CHECK (("status" = 'PENDING' AND "answeredAt" IS NULL) OR ("status" <> 'PENDING' AND "answeredAt" IS NOT NULL))`,
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

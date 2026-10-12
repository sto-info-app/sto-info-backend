import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Caps a captain's Admiralty Tour of Duty at nine steps.
 *
 * The game pays the tour reward on the tenth step and starts the tour again,
 * so "ten" is never somewhere a captain stays. Any row recorded at ten was a
 * tour that had just paid out, and the game would already show it at nought -
 * so that is where it is put before the tighter check goes on.
 */
export class CapAdmiraltyTourOfDutyAtNine1792600000000 implements MigrationInterface {
  name = 'CapAdmiraltyTourOfDutyAtNine1792600000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "sto_info_app"."character_admiralty_progress" SET "tourOfDutyStep" = 0 WHERE "tourOfDutyStep" >= 10`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_admiralty_progress" DROP CONSTRAINT "CK_character_admiralty_progress_tour"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_admiralty_progress" ADD CONSTRAINT "CK_character_admiralty_progress_tour" CHECK ("tourOfDutyStep" BETWEEN 0 AND 9)`,
    );
  }

  /**
   * Reverts the migration from the database.
   *
   * The rows reset on the way up are not restored: a tour at nought is a
   * valid state under either rule, and nothing records which rows were ten.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_admiralty_progress" DROP CONSTRAINT "CK_character_admiralty_progress_tour"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character_admiralty_progress" ADD CONSTRAINT "CK_character_admiralty_progress_tour" CHECK ("tourOfDutyStep" BETWEEN 0 AND 10)`,
    );
  }
}

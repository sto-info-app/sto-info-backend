import { MigrationInterface, QueryRunner } from 'typeorm';

/** The check on a roster observation's level, by name. */
export const ROSTER_OBSERVATION_LEVEL_CHECK = 'CHK_roster_observation_level';

/**
 * Lets a roster observation record a level of zero.
 *
 * `CreateRosterObservation` required every level to be at least one. Star
 * Trek Online writes 0 for a Character created but never played, and real
 * exports carry such rows: the first roster imported on tribble (17 October
 * 2026) held two, the parser read both, and the publication that wrote the
 * ninety-three observations failed on the check and the import sat at
 * Reading. The parser's own rule, `ROSTER_LEVEL_PATTERN`, has always
 * accepted 0; the table disagreed with it, and the table was wrong about the
 * game. A negative level is still refused.
 *
 * The way down puts the original check back, and is refused by PostgreSQL
 * while any observation holds a level of zero, which is the right answer: a
 * row the game wrote should not be made unreadable by a rollback.
 */
export class AllowLevelZeroRosterObservations1798000000000 implements MigrationInterface {
  name = 'AllowLevelZeroRosterObservations1798000000000';

  /**
   * Relaxes the check to admit zero.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_roster_observation" DROP CONSTRAINT "${ROSTER_OBSERVATION_LEVEL_CHECK}"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_roster_observation" ADD CONSTRAINT "${ROSTER_OBSERVATION_LEVEL_CHECK}" CHECK ("level" >= 0)`,
    );
  }

  /**
   * Restores the original check.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_roster_observation" DROP CONSTRAINT "${ROSTER_OBSERVATION_LEVEL_CHECK}"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_roster_observation" ADD CONSTRAINT "${ROSTER_OBSERVATION_LEVEL_CHECK}" CHECK ("level" >= 1)`,
    );
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/** The collision reasons before a partial export could be skipped. */
const PREVIOUS_REASONS = [
  'SEVERAL_PARTNERS',
  'OLD_HANDLE_STILL_PRESENT',
  'NEW_HANDLE_ALREADY_PRESENT',
  'HANDLE_SPLIT',
  'HANDLE_MERGE',
];

/**
 * Gives a rename candidate one more reason it cannot be resolved (FC-019).
 *
 * Steve decided on 25 September 2026 that renames are suggested only between
 * consecutive complete exports: one marked partial, or with a row excluded,
 * cannot show that a name is gone, so it is skipped for pairing. What it can
 * still show is that two names were listed at once, and a pair it lists
 * together cannot be one name replacing the other. `LISTED_TOGETHER` records
 * that, and like every collision it keeps the candidate open.
 */
export class AddListedTogetherCollisionReason1794500000000 implements MigrationInterface {
  name = 'AddListedTogetherCollisionReason1794500000000';

  /**
   * Adds the value.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "sto_info_app"."roster_identity_collision_reason_enum" ADD VALUE IF NOT EXISTS 'LISTED_TOGETHER'`,
    );
  }

  /**
   * Removes the value.
   *
   * A candidate citing it is open, because a collision cannot be decided, so
   * dropping the reason from it changes no decision; the next recompute
   * under the earlier code suggests what that code would.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = `"sto_info_app"."fleet_roster_identity_candidate"`;
    const type = `"sto_info_app"."roster_identity_collision_reason_enum"`;
    const list = PREVIOUS_REASONS.map(value => `'${value}'`).join(', ');

    await queryRunner.query(
      `UPDATE ${table} SET "collisionReasons" = array_remove("collisionReasons", 'LISTED_TOGETHER'::${type}) WHERE 'LISTED_TOGETHER'::${type} = ANY ("collisionReasons")`,
    );
    await queryRunner.query(
      `ALTER TABLE ${table} ALTER COLUMN "collisionReasons" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TYPE ${type} RENAME TO "roster_identity_collision_reason_enum_old"`,
    );
    await queryRunner.query(`CREATE TYPE ${type} AS ENUM (${list})`);
    await queryRunner.query(
      `ALTER TABLE ${table} ALTER COLUMN "collisionReasons" TYPE ${type} array USING "collisionReasons"::text[]::${type}[]`,
    );
    await queryRunner.query(
      `ALTER TABLE ${table} ALTER COLUMN "collisionReasons" SET DEFAULT '{}'`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."roster_identity_collision_reason_enum_old"`,
    );
  }
}

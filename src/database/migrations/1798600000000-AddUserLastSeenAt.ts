import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records when a user was last seen (FC-053).
 *
 * `lastLoginAt` is written by the password sign-in alone, so a member who
 * stays signed in through token refresh for weeks reads as last seen on the
 * day they typed their password. `lastSeenAt` is set at sign-in and touched
 * at most once an hour on any authenticated request, and the Site Statistics
 * page counts a user as active by it, falling back to `lastLoginAt` for a
 * user not seen since the column arrived.
 *
 * The index serves the window counts and the last-seen-by-week series, both
 * of which read the column across the whole table.
 */
export class AddUserLastSeenAt1798600000000 implements MigrationInterface {
  name = 'AddUserLastSeenAt1798600000000';

  /**
   * Adds the column and its index.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."user" ADD "lastSeenAt" TIMESTAMP`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_last_seen_at" ON "sto_info_app"."user" ("lastSeenAt")`,
    );
  }

  /**
   * Takes the index and the column away again.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."IDX_user_last_seen_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."user" DROP COLUMN "lastSeenAt"`,
    );
  }
}

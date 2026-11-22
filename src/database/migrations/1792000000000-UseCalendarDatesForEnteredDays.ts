import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Converts the two columns that hold a day somebody typed from `timestamp` to
 * `date`.
 *
 * `account.accountCreatedDate` and `character.createdDate` record the day an
 * account or a captain was made in Star Trek Online. They have never had a
 * meaningful time of day: the form that collects them is an `<input
 * type="date">`, and the form that edits them takes the date part of the
 * stored value and throws the rest away.
 *
 * Storing them as instants made them wrong to read. A value entered through
 * the API lands at midnight UTC, and midnight UTC rendered anywhere west of
 * Greenwich is the previous day — so an account created on the fourth of March
 * showed as the third to a reader in New York. Nothing warned about it,
 * because a date that is one day out still looks like a perfectly ordinary
 * date.
 *
 * **The cast takes the date part and nothing else.** `timestamp without time
 * zone` has no zone, so `::date` truncates the fields it already has and the
 * session timezone cannot affect the result. That is also exactly what the
 * edit form has been showing all along, so no stored value changes meaning.
 *
 * **The rollback restores the type, not the time.** Going back makes every row
 * midnight, discarding the times the demo seed wrote — 10:30 and 14:15 UTC,
 * chosen to make seeded rows look distinct rather than to mean anything. A
 * migration that moves data cannot always be lossless in both directions; what
 * matters is that the day, which is the whole of the value, survives.
 */
export class UseCalendarDatesForEnteredDays1792000000000 implements MigrationInterface {
  name = 'UseCalendarDatesForEnteredDays1792000000000';

  /**
   * Applies the migration.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."account" ALTER COLUMN "accountCreatedDate" TYPE date USING "accountCreatedDate"::date`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" ALTER COLUMN "createdDate" TYPE date USING "createdDate"::date`,
    );
  }

  /**
   * Reverts the migration.
   *
   * Every restored row sits at midnight, which is the only instant a day can
   * be turned back into without inventing a time.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."character" ALTER COLUMN "createdDate" TYPE timestamp USING "createdDate"::timestamp`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."account" ALTER COLUMN "accountCreatedDate" TYPE timestamp USING "accountCreatedDate"::timestamp`,
    );
  }
}

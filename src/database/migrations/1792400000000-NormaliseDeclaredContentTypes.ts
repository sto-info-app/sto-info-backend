import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reduces every declared content type to one spelling (FC-011).
 *
 * The worker now compares what an upload claimed with what the bytes look
 * like, and a comparison is only as good as the spellings reaching it.
 * `image/jpg` and `image/jpeg` name the same format, and the existing upload
 * path accepts both — so without this, every JPEG uploaded through it would
 * be refused as a file pretending to be something it is not. ADR-0020.
 *
 * Three reductions, in the order the application applies them: drop the
 * parameters, lowercase what is left, then map the aliases. The alias list
 * here is the SQL twin of `normaliseMediaType`, and the two are kept honest
 * by the schema-alignment spec rather than by anybody remembering.
 *
 * **There is no `down` that restores the old spellings**, because they are
 * not recoverable: `image/jpg` and `image/jpeg` both become `image/jpeg` and
 * nothing records which row said which. The reverse is a no-op that says so
 * rather than a lie that looks reversible. Nothing depends on the old
 * spellings — the column has never been read by anything but a log line.
 */
export class NormaliseDeclaredContentTypes1792400000000 implements MigrationInterface {
  name = 'NormaliseDeclaredContentTypes1792400000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Parameters first, then case. `TEXT/CSV; charset=UTF-8` is one value
    // that needs both, and doing them in the other order would leave the
    // parameter's own casing behind.
    await queryRunner.query(`
      UPDATE "sto_info_app"."file_asset"
      SET "declaredContentType" = lower(btrim(split_part("declaredContentType", ';', 1)))
      WHERE "declaredContentType" IS NOT NULL
    `);

    await queryRunner.query(`
      UPDATE "sto_info_app"."file_asset"
      SET "declaredContentType" = CASE "declaredContentType"
        WHEN 'image/jpg' THEN 'image/jpeg'
        WHEN 'image/pjpeg' THEN 'image/jpeg'
        WHEN 'image/x-citrix-jpeg' THEN 'image/jpeg'
        WHEN 'image/x-png' THEN 'image/png'
        WHEN 'image/x-citrix-png' THEN 'image/png'
        WHEN 'application/csv' THEN 'text/csv'
        WHEN 'application/x-csv' THEN 'text/csv'
        WHEN 'text/comma-separated-values' THEN 'text/csv'
        WHEN 'text/x-comma-separated-values' THEN 'text/csv'
        WHEN 'application/vnd.ms-excel' THEN 'text/csv'
        WHEN 'application/excel' THEN 'text/csv'
        WHEN 'application/x-excel' THEN 'text/csv'
        ELSE "declaredContentType"
      END
      WHERE "declaredContentType" IS NOT NULL
    `);

    // A value that is not a bare media type after all that was never one to
    // begin with. Null is what the column already means by "nobody said",
    // and it is the honest place for a claim that cannot be read.
    await queryRunner.query(`
      UPDATE "sto_info_app"."file_asset"
      SET "declaredContentType" = NULL
      WHERE "declaredContentType" IS NOT NULL
        AND "declaredContentType" !~ '^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$'
    `);
  }

  /**
   * Reverses the migration.
   *
   * Takes no query runner, because it has nothing to run.
   */
  public async down(): Promise<void> {
    // Deliberately nothing. Which rows said `image/jpg` and which said
    // `image/jpeg` is not recorded anywhere, so there is nothing to put
    // back. Rolling this migration back leaves the canonical spellings in
    // place, which is harmless: they were always valid values for the
    // column, and no code before this migration distinguished them.
    return Promise.resolve();
  }
}

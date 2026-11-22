import { MigrationInterface, QueryRunner } from 'typeorm';

/** The values the placement subject enum held before roster imports. */
const PREVIOUS_SUBJECTS = [
  'USER_PROFILE',
  'STO_CHARACTER',
  'STORYTIME_ARC',
  'STORYTIME_STORY',
  'STORYTIME_CHAPTER',
  'STORYTIME_CAST_MEMBER',
  'STORYTIME_SPOTLIGHT',
  'CUSTOM_TRACKING_VALUE',
  'FLEET_COMMUNITY',
  'FLEET',
  'ARMADA',
];

/** The values the placement slot enum held before roster imports. */
const PREVIOUS_SLOTS = [
  'PICTURE',
  'PORTRAIT',
  'BANNER',
  'PROFILE',
  'COVER',
  'OVERRIDE',
  'EMBLEM',
];

/**
 * Lets a roster import be placed, and records why one was refused (FC-017).
 *
 * ## An import is placed like a picture
 *
 * `file_asset_placement` already answers the question an import needs
 * answered: accepted but not yet in force, or in force. A clean verdict is
 * necessary and not sufficient for a roster any more than for a picture, and
 * the placement is what says the rest of the checks have passed. So an
 * import claims a placement at upload, as an image does, under a subject of
 * its own.
 *
 * The subject identifier is the import, not the Fleet. The placement indexes
 * allow one pending and one active row per slot, and a Fleet has a history of
 * imports rather than one current file; keyed by the Fleet, each new upload
 * would supersede the last and a Fleet could only ever have one import in
 * force.
 *
 * ## Why a refusal is recorded on the import
 *
 * The upload already refuses a file whose rows do not read, so the publisher
 * refusing one means the reader changed between the two. That is rare, and it
 * is exactly the case in which an uploader is owed an explanation they cannot
 * get from the file itself: the same bytes passed an hour ago. The problems
 * are stored as the typed reader reports them — a line, a column name and a
 * code, never a value — and the column is outside
 * the write-once guard because it is written after the row is.
 *
 * The enums are widened with `ADD VALUE`, which PostgreSQL allows inside a
 * transaction so long as nothing in the same transaction uses the new value.
 * Nothing here does.
 */
export class PublishRosterImports1793600000000 implements MigrationInterface {
  name = 'PublishRosterImports1793600000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "sto_info_app"."file_asset_subject_enum" ADD VALUE IF NOT EXISTS 'ROSTER_IMPORT'`,
    );

    await queryRunner.query(
      `ALTER TYPE "sto_info_app"."file_asset_slot_enum" ADD VALUE IF NOT EXISTS 'SOURCE'`,
    );

    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_roster_import_source" ADD "publicationProblems" jsonb`,
    );
  }

  /**
   * Reverts the migration.
   *
   * PostgreSQL cannot drop a value from an enum, so each type is rebuilt
   * without it and its column moved across. A placement already naming a
   * roster import fails the cast, which is the correct outcome: reverting past
   * roster publication while imports are placed should stop rather than
   * quietly discard them.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_roster_import_source" DROP COLUMN "publicationProblems"`,
    );

    await this.narrow(
      queryRunner,
      'file_asset_subject_enum',
      'subject',
      PREVIOUS_SUBJECTS,
    );
    await this.narrow(
      queryRunner,
      'file_asset_slot_enum',
      'slot',
      PREVIOUS_SLOTS,
    );
  }

  /**
   * Rebuilds one placement enum with only the values it had before.
   *
   * The unique indexes that key on the column are rebuilt by PostgreSQL as
   * part of the type change; nothing here has to drop and recreate them.
   *
   * @param queryRunner - The TypeORM query runner.
   * @param type - The enum type's name.
   * @param column - The placement column that uses it.
   * @param values - What it held before.
   */
  private async narrow(
    queryRunner: QueryRunner,
    type: string,
    column: string,
    values: readonly string[],
  ): Promise<void> {
    const list = values.map(value => `'${value}'`).join(', ');

    await queryRunner.query(
      `ALTER TYPE "sto_info_app"."${type}" RENAME TO "${type}_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."${type}" AS ENUM (${list})`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."file_asset_placement" ALTER COLUMN "${column}" TYPE "sto_info_app"."${type}" USING "${column}"::text::"sto_info_app"."${type}"`,
    );
    await queryRunner.query(`DROP TYPE "sto_info_app"."${type}_old"`);
  }
}

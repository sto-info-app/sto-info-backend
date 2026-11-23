import { MigrationInterface, QueryRunner } from 'typeorm';

/** The check on a news post's shape, by name. */
export const NEWS_POST_SCOPE_CHECK = 'CHK_news_post_scope';

/** The asset kinds there were before this migration. */
export const PREVIOUS_KINDS = [
  'PROFILE_IMAGE',
  'CHARACTER_IMAGE',
  'STORYTIME_IMAGE',
  'CUSTOM_TRACKING_IMAGE',
  'ROSTER_IMPORT_SOURCE',
  'FLEET_IMAGE',
];

/** The placement subjects there were before this migration. */
export const PREVIOUS_SUBJECTS = [
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
  'ROSTER_IMPORT',
  'NEWS_POST',
];

/** Both shapes of post, as `ScopeNewsPosts` first wrote them. */
const SCOPED_BRANCH = `("communityId" IS NOT NULL AND ("fleetId" IS NULL OR "armadaId" IS NULL)
          AND "audience" IS NOT NULL AND "audience" <> 'PRIVATE'
          AND "category" IS NULL)`;

/**
 * Builds the shape check, with or without a cover allowed on the site's posts.
 *
 * @param siteCovers - Whether the site's own posts may carry a cover.
 * @returns The constraint's definition.
 */
function scopeCheck(siteCovers: boolean): string {
  const siteBranch = siteCovers
    ? `("communityId" IS NULL AND "fleetId" IS NULL AND "armadaId" IS NULL
          AND "audience" IS NULL AND "category" IS NOT NULL)`
    : `("communityId" IS NULL AND "fleetId" IS NULL AND "armadaId" IS NULL
          AND "audience" IS NULL AND "category" IS NOT NULL
          AND "coverImageId" IS NULL AND "coverImageAlt" IS NULL)`;

  return `ALTER TABLE "sto_info_app"."news_post" ADD CONSTRAINT "${NEWS_POST_SCOPE_CHECK}" CHECK (
        ${siteBranch}
        OR ${SCOPED_BRANCH})`;
}

/**
 * Lets the site's own news posts carry a cover image (sc-1447).
 *
 * The columns have been on `news_post` since `ScopeNewsPosts` (FC-027), which
 * kept them for a Community's, a Fleet's or an Armada's posts. The site's
 * posts now take one too, with the decisions made on 23 November 2026:
 *
 * - Its pictures are placed against a subject of their own, `SITE_NEWS_POST`,
 *   rather than sharing `NEWS_POST` with the scoped posts, so Fleet news's
 *   publisher is left as it is and each kind of post has its own.
 * - They are registered as a kind of their own, `NEWS_IMAGE`, so a rescan, a
 *   retention policy or the estate inventory counts them as the site's news
 *   rather than as Fleet artwork.
 *
 * The shape check keeps everything else it held: a site post names no scope,
 * has a category and no audience. Only the two cover columns are freed.
 *
 * The enums are widened with `ADD VALUE`, which PostgreSQL allows inside a
 * transaction so long as nothing in the same transaction uses the new value.
 * Nothing here does.
 *
 * The way down puts the original check back first, and PostgreSQL refuses it
 * while any site post still has a cover; then each enum is rebuilt without
 * its new value, and a registry row still using one fails the cast. Both stop
 * the revert rather than discarding a picture quietly.
 */
export class AllowSiteNewsCovers1798800000000 implements MigrationInterface {
  name = 'AllowSiteNewsCovers1798800000000';

  /**
   * Adds the kind and the subject, and frees the cover columns.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "sto_info_app"."file_asset_kind_enum" ADD VALUE IF NOT EXISTS 'NEWS_IMAGE'`,
    );
    await queryRunner.query(
      `ALTER TYPE "sto_info_app"."file_asset_subject_enum" ADD VALUE IF NOT EXISTS 'SITE_NEWS_POST'`,
    );
    await this.replaceCheck(queryRunner, true);
  }

  /**
   * Restores the original check and narrows both enums again.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.replaceCheck(queryRunner, false);
    await this.narrow(
      queryRunner,
      'file_asset_subject_enum',
      'file_asset_placement',
      'subject',
      PREVIOUS_SUBJECTS,
    );
    await this.narrow(
      queryRunner,
      'file_asset_kind_enum',
      'file_asset',
      'kind',
      PREVIOUS_KINDS,
    );
  }

  /**
   * Drops the shape check and adds it again.
   *
   * @param queryRunner - The TypeORM query runner.
   * @param siteCovers - Whether the site's own posts may carry a cover.
   */
  private async replaceCheck(
    queryRunner: QueryRunner,
    siteCovers: boolean,
  ): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."news_post" DROP CONSTRAINT "${NEWS_POST_SCOPE_CHECK}"`,
    );
    await queryRunner.query(scopeCheck(siteCovers));
  }

  /**
   * Rebuilds one enum with only the values it had before.
   *
   * @param queryRunner - The TypeORM query runner.
   * @param type - The enum type's name.
   * @param table - The table whose column uses it.
   * @param column - That column.
   * @param values - What it held before.
   */
  private async narrow(
    queryRunner: QueryRunner,
    type: string,
    table: string,
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
      `ALTER TABLE "sto_info_app"."${table}" ALTER COLUMN "${column}" TYPE "sto_info_app"."${type}" USING "${column}"::text::"sto_info_app"."${type}"`,
    );
    await queryRunner.query(`DROP TYPE "sto_info_app"."${type}_old"`);
  }
}

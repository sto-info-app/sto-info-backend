import { MigrationInterface, QueryRunner } from 'typeorm';

/** The picture subjects there were before this migration. */
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
  'ROSTER_IMPORT',
];

/**
 * Lets a Community, a Fleet or an Armada publish its own news (FC-027).
 *
 * The site's news table is extended rather than joined by a second one, so
 * there is one news system (R15). Every post that exists already is the
 * site's own and stays so: it names no scope, and every global query now says
 * so explicitly.
 *
 * With the decisions Steve made on 28 September 2026:
 *
 * - A scoped post names its Community and, for a Fleet or an Armada, that
 *   too — never both. The composite keys keep the Fleet or Armada in the
 *   Community the post names.
 * - It is published to one audience: anyone, the Community, or the scope's
 *   own members. Never `PRIVATE`, which means the Community's Owner alone.
 * - It has no category; those are the site's. It may carry one cover image,
 *   which the site's posts do not.
 * - A slug is unique among the site's posts, as before, and within each scope.
 *   The scope's index reads the Fleet and Armada through `COALESCE`, so a
 *   Community's own posts collide with each other rather than slipping past
 *   one another as NULLs, whatever version of PostgreSQL this runs on.
 *
 * `CHK_news_post_scope` states the shape of both kinds in one place. Each
 * branch tests every nullable column it relies on explicitly, so the check
 * can never evaluate to NULL and pass by default.
 */
export class ScopeNewsPosts1795600000000 implements MigrationInterface {
  name = 'ScopeNewsPosts1795600000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "sto_info_app"."file_asset_subject_enum" ADD VALUE IF NOT EXISTS 'NEWS_POST'`,
    );

    await queryRunner.query(`ALTER TABLE "sto_info_app"."news_post"
      ADD COLUMN "communityId" uuid,
      ADD COLUMN "fleetId" uuid,
      ADD COLUMN "armadaId" uuid,
      ADD COLUMN "audience" "sto_info_app"."fleet_audience_enum",
      ADD COLUMN "coverImageId" varchar(255),
      ADD COLUMN "coverImageAlt" varchar(300)`);
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."news_post" ALTER COLUMN "category" DROP NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."news_post" ADD CONSTRAINT "CHK_news_post_scope" CHECK (
        ("communityId" IS NULL AND "fleetId" IS NULL AND "armadaId" IS NULL
          AND "audience" IS NULL AND "category" IS NOT NULL
          AND "coverImageId" IS NULL AND "coverImageAlt" IS NULL)
        OR ("communityId" IS NOT NULL AND ("fleetId" IS NULL OR "armadaId" IS NULL)
          AND "audience" IS NOT NULL AND "audience" <> 'PRIVATE'
          AND "category" IS NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."news_post" ADD CONSTRAINT "FK_news_post_community" FOREIGN KEY ("communityId") REFERENCES "sto_info_app"."fleet_community"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."news_post" ADD CONSTRAINT "FK_news_post_fleet" FOREIGN KEY ("fleetId", "communityId") REFERENCES "sto_info_app"."sto_fleet"("id", "communityId") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."news_post" ADD CONSTRAINT "FK_news_post_armada" FOREIGN KEY ("armadaId", "communityId") REFERENCES "sto_info_app"."sto_armada"("id", "communityId") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`DROP INDEX "sto_info_app"."UX_news_post_slug"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_news_post_slug" ON "sto_info_app"."news_post" ("slug") WHERE "communityId" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_news_post_scope_slug" ON "sto_info_app"."news_post" ("communityId", COALESCE("fleetId", '00000000-0000-0000-0000-000000000000'::uuid), COALESCE("armadaId", '00000000-0000-0000-0000-000000000000'::uuid), "slug") WHERE "communityId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IX_news_post_scope" ON "sto_info_app"."news_post" ("communityId", "fleetId", "armadaId", "status", "publishedAt") WHERE "communityId" IS NOT NULL`,
    );
  }

  /**
   * Reverts the migration.
   *
   * Scoped posts go with their columns: the site's news had no way to hold
   * them. PostgreSQL cannot drop a value from an enum, so the subject type is
   * rebuilt without `NEWS_POST`; a placement still naming a post fails the
   * cast, which stops the revert rather than discarding it quietly.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "sto_info_app"."news_post" WHERE "communityId" IS NOT NULL`,
    );
    await queryRunner.query(`DROP INDEX "sto_info_app"."IX_news_post_scope"`);
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UX_news_post_scope_slug"`,
    );
    await queryRunner.query(`DROP INDEX "sto_info_app"."UX_news_post_slug"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_news_post_slug" ON "sto_info_app"."news_post" ("slug")`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."news_post" DROP CONSTRAINT "FK_news_post_armada"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."news_post" DROP CONSTRAINT "FK_news_post_fleet"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."news_post" DROP CONSTRAINT "FK_news_post_community"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."news_post" DROP CONSTRAINT "CHK_news_post_scope"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."news_post" ALTER COLUMN "category" SET NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "sto_info_app"."news_post"
      DROP COLUMN "coverImageAlt",
      DROP COLUMN "coverImageId",
      DROP COLUMN "audience",
      DROP COLUMN "armadaId",
      DROP COLUMN "fleetId",
      DROP COLUMN "communityId"`);

    await queryRunner.query(
      `ALTER TYPE "sto_info_app"."file_asset_subject_enum" RENAME TO "file_asset_subject_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."file_asset_subject_enum" AS ENUM (${PREVIOUS_SUBJECTS.map(value => `'${value}'`).join(', ')})`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."file_asset_placement" ALTER COLUMN "subject" TYPE "sto_info_app"."file_asset_subject_enum" USING "subject"::text::"sto_info_app"."file_asset_subject_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "sto_info_app"."file_asset_subject_enum_old"`,
    );
  }
}

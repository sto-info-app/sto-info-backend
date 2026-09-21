import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Widens the Fleet and Armada slug uniqueness scope to include the platform
 * (FC-013, ADR-0022).
 *
 * FC-004 made a scoped slug unique per Community. The canonical URL the plan
 * approved is `/fleets/{communitySlug}/{platform}/{fleetSlug}`, and the plan
 * also requires that slug resolution include the parent *and* the platform.
 * Those two cannot both be true: with Community-only uniqueness the platform
 * segment discriminates nothing, and a Community holding a Fleet of the same
 * name on PC and on Xbox would have to suffix the second one's slug.
 *
 * The indexes therefore move to `(communityId, platformId, slug)`, still over
 * live rows only, so a Community may hold `omega-armada` once per platform and
 * the segment that tells the two apart is the one a reader would expect to.
 *
 * Both indexes keep their names. They are the same invariant with a wider key,
 * not a new one, and renaming them would only make the next person look for a
 * constraint that never existed.
 *
 * The Fleet index keeps `"communityId" IS NOT NULL` as well: an unregistered
 * observation target has no Community, and therefore no URL and nothing to be
 * unique against.
 */
export class ScopeSlugsByPlatform1792700000000 implements MigrationInterface {
  name = 'ScopeSlugsByPlatform1792700000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UX_sto_fleet_community_slug"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_sto_fleet_community_slug" ON "sto_info_app"."sto_fleet" ("communityId", "platformId", "slug") WHERE "deletedAt" IS NULL AND "communityId" IS NOT NULL`,
    );

    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UX_sto_armada_community_slug"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_sto_armada_community_slug" ON "sto_info_app"."sto_armada" ("communityId", "platformId", "slug") WHERE "deletedAt" IS NULL`,
    );
  }

  /**
   * Reverts the migration.
   *
   * Narrowing the key back can fail, and deliberately so: if two live Fleets in
   * one Community share a slug across platforms, restoring the old index is
   * exactly the operation that must not silently succeed. The error names the
   * rows to resolve.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UX_sto_armada_community_slug"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_sto_armada_community_slug" ON "sto_info_app"."sto_armada" ("communityId", "slug") WHERE "deletedAt" IS NULL`,
    );

    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UX_sto_fleet_community_slug"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_sto_fleet_community_slug" ON "sto_info_app"."sto_fleet" ("communityId", "slug") WHERE "deletedAt" IS NULL AND "communityId" IS NOT NULL`,
    );
  }
}

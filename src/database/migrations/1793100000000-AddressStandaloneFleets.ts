import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gives a Fleet with no Community an address of its own (FC-013, ADR-0022).
 *
 * Until now a standalone Fleet had a slug-shaped label and nothing that used
 * it: the unique index covering the column was restricted to rows with a
 * Community, so two confirmations of the same name on one platform were free
 * to hold the same slug, and neither was reachable anyway.
 *
 * Steve's decision is that such a record gets a page, addressed under the
 * reserved segment `standalone` where a Community's slug would otherwise sit:
 * `/fleets/communities/standalone/fleets/{platform}/{fleetSlug}`. That makes
 * the slug an address rather than a label, and an address has to be unique —
 * among the standalone records on the same platform, which is exactly the
 * scope the segment names.
 *
 * Two things therefore have to be true before the index can exist, and both
 * are settled here rather than left for the first insert to discover.
 *
 * **No two live standalone Fleets on one platform share a slug.** Colliding
 * rows are suffixed in registration order, oldest keeping the plain slug,
 * which is what the slug service would have produced had it been minting
 * these all along.
 *
 * **No Community holds the slug `standalone`.** One that does is suffixed the
 * same way. The slug service refuses the segment from here on, so this is a
 * one-off correction rather than a rule the database has to keep.
 *
 * The suffixing is deliberately not recorded in `fleet_slug_history`. That
 * table's check constraint only accepts a Fleet row with a Community, and a
 * standalone Fleet has never had a resolvable address to retire: nothing can
 * link to a slug that answered to nothing.
 */
export class AddressStandaloneFleets1793100000000 implements MigrationInterface {
  name = 'AddressStandaloneFleets1793100000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Oldest first, so the record that has been answering to a name longest
    // keeps the plain slug and later ones move.
    await queryRunner.query(`
      WITH "ranked" AS (
        SELECT
          "id",
          "slug",
          ROW_NUMBER() OVER (
            PARTITION BY "platformId", "slug"
            ORDER BY "createdAt", "id"
          ) AS "position"
        FROM "sto_info_app"."sto_fleet"
        WHERE "deletedAt" IS NULL AND "communityId" IS NULL
      )
      UPDATE "sto_info_app"."sto_fleet" AS "fleet"
      SET "slug" = left("ranked"."slug", 80 - length("ranked"."position"::text) - 1)
        || '-' || "ranked"."position"::text
      FROM "ranked"
      WHERE "fleet"."id" = "ranked"."id" AND "ranked"."position" > 1
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_sto_fleet_standalone_slug" ON "sto_info_app"."sto_fleet" ("platformId", "slug") WHERE "deletedAt" IS NULL AND "communityId" IS NULL`,
    );

    // A Community called "Standalone" would otherwise own the segment that
    // now means "no Community", and one address would name two things. At
    // most one row can be holding it, the slug being unique, and the new one
    // is built from that row's own identifier so it cannot land on a slug
    // some other Community is already using.
    await queryRunner.query(`
      UPDATE "sto_info_app"."fleet_community"
      SET "slug" = 'standalone-' || left(replace("id"::text, '-', ''), 8)
      WHERE "slug" = 'standalone' AND "deletedAt" IS NULL
    `);
  }

  /**
   * Reverts the migration.
   *
   * The suffixes stay. They are now the slugs those records answer to, and
   * putting two rows back onto one name would leave whichever of them a
   * reader reached to chance.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "sto_info_app"."UX_sto_fleet_standalone_slug"`,
    );
  }
}

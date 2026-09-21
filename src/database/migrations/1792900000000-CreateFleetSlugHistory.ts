import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Remembers the slugs a Community, Fleet or Armada used to answer to
 * (FC-013, ADR-0022).
 *
 * A Fleet gets linked from Discord and from forum posts, and those links
 * outlive any rename. FC-004's entity documentation already promised that "a
 * rename mints a new slug and leaves a canonical redirect behind"; this is the
 * table that makes the promise true, and it is modelled on
 * `storytime_slug_history`, which solves the same problem for Stories.
 *
 * Two rules follow, and the indexes are how they are kept:
 *
 * **A retired slug is never reissued to a different scope.** An old link
 * quietly resolving to somebody else's Fleet is worse than the dead link the
 * history exists to prevent, so a candidate slug is taken if it is live *or*
 * retired. A scope may reclaim its own former slug.
 *
 * **A retired slug is unique in the same scope its live slug is unique in.**
 * Community slugs are unique across the site, so their history is too. Fleet
 * and Armada slugs are unique per Community and platform, so theirs is scoped
 * the same way — which is why there are two unique indexes rather than one
 * over a `COALESCE`. Two partial indexes say the same thing and stay ordinary
 * column indexes, which anything comparing the schema to the entities can
 * still read.
 *
 * The check constraint is what stops the two from overlapping: a Community row
 * carries neither parent, and a Fleet or Armada row carries both.
 */
export class CreateFleetSlugHistory1792900000000 implements MigrationInterface {
  name = 'CreateFleetSlugHistory1792900000000';

  /**
   * Applies the migration to the database.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "sto_info_app"."fleet_scope_kind_enum" AS ENUM ('COMMUNITY', 'FLEET', 'ARMADA')`,
    );

    await queryRunner.query(`
      CREATE TABLE "sto_info_app"."fleet_slug_history" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "targetType" "sto_info_app"."fleet_scope_kind_enum" NOT NULL,
        "targetId" uuid NOT NULL,
        "communityId" uuid,
        "platformId" uuid,
        "slug" character varying(80) NOT NULL,
        "replacedAt" timestamptz NOT NULL DEFAULT now(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fleet_slug_history" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_fleet_slug_history_scope" CHECK (
          ("targetType" = 'COMMUNITY' AND "communityId" IS NULL AND "platformId" IS NULL)
          OR ("targetType" <> 'COMMUNITY' AND "communityId" IS NOT NULL AND "platformId" IS NOT NULL)
        )
      )
    `);

    // A Community's own retired slugs are unique across the site, exactly as
    // its live slug is.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_fleet_slug_history_global" ON "sto_info_app"."fleet_slug_history" ("targetType", "slug") WHERE "communityId" IS NULL`,
    );

    // A Fleet's or an Armada's are unique where its live slug is: inside one
    // Community, on one platform.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UX_fleet_slug_history_scoped" ON "sto_info_app"."fleet_slug_history" ("targetType", "communityId", "platformId", "slug") WHERE "communityId" IS NOT NULL`,
    );

    // Resolution asks "who used to answer to this", so the target is read far
    // more often than it is written and is worth its own path.
    await queryRunner.query(
      `CREATE INDEX "IDX_fleet_slug_history_target" ON "sto_info_app"."fleet_slug_history" ("targetType", "targetId")`,
    );

    // Deleting the Community takes its scopes' retired slugs with it. Nothing
    // can resolve them once the Community is gone, and keeping them would only
    // reserve names against a parent that no longer exists.
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_slug_history" ADD CONSTRAINT "FK_fleet_slug_history_community" FOREIGN KEY ("communityId") REFERENCES "sto_info_app"."fleet_community"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "sto_info_app"."fleet_slug_history" ADD CONSTRAINT "FK_fleet_slug_history_platform" FOREIGN KEY ("platformId") REFERENCES "sto_info_app"."platform"("id") ON DELETE RESTRICT`,
    );
  }

  /**
   * Reverts the migration.
   *
   * Dropping the table loses every redirect, and there is no way to recover
   * them: the slug a scope used to have is not recorded anywhere else. Links
   * shared before a rename stop resolving.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "sto_info_app"."fleet_slug_history"`);
    await queryRunner.query(`DROP TYPE "sto_info_app"."fleet_scope_kind_enum"`);
  }
}

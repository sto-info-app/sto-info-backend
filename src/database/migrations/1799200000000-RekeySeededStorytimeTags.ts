import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The prefix `SeedStorytimeTags1790000600000` hashed with each slug to make
 * the seeded tag ids. Copied rather than imported: an old migration must not
 * change because a newer file did.
 */
export const SEEDED_TAG_ID_NAMESPACE = 'sto-info-storytime-tag:';

/** The check that keeps every tag id a version 4 UUID, by name. */
export const TAG_ID_VERSION_CHECK = 'CHK_storytime_tag_id_v4';

/**
 * A version 4 UUID in canonical lower-case text: version digit 4, variant
 * digit 8, 9, a or b. The same rule class-validator's `@IsUUID('4')` applies.
 */
export const VERSION_FOUR_UUID_PATTERN =
  '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

/** The tables that attach tags to content, and their foreign keys to a tag. */
export const TAG_LINK_TABLES = [
  'storytime_story_tag',
  'storytime_arc_tag',
  'storytime_character_tag',
] as const;

/** The id `SeedStorytimeTags1790000600000` gave the tag in this row. */
const SEEDED_ID = `md5('${SEEDED_TAG_ID_NAMESPACE}' || "tag"."slug")::uuid`;

/**
 * SQL that turns a UUID into a version 4 UUID by overwriting its version
 * digit with 4 and the top two bits of its variant digit with 10, keeping
 * every other digit. The same input always gives the same output, so every
 * environment re-keys a seeded tag to the same id.
 *
 * Not exported: TypeORM loads every exported function in a migration file as
 * a migration. Its TypeScript twin for specs is `toVersionFourId` in
 * `src/storytime/tags/testing/seeded-tag-ids.ts`.
 *
 * @param uuid - A SQL expression of type `uuid`.
 * @returns A SQL expression of type `uuid`.
 */
function versionFourOf(uuid: string): string {
  const text = `(${uuid})::text`;

  return `(
    substr(${text}, 1, 14)
    || '4'
    || substr(${text}, 16, 4)
    || substr('89ab', (('x' || substr(${text}, 20, 1))::bit(4)::int & 3) + 1, 1)
    || substr(${text}, 21)
  )::uuid`;
}

/**
 * Gives every seeded Storytime tag a version 4 id, and stops any other kind
 * of id reaching the table again.
 *
 * `SeedStorytimeTags1790000600000` made each seeded tag's id from an MD5 hash
 * of its slug cast to `uuid`. That is the right shape but carries whatever
 * version and variant digits the hash produced, so none of the 124 is a UUID
 * by validator 13.15's rules. `SetTagsDto` checks `@IsUUID('4')` and the
 * admin tag routes use `ParseUUIDPipe`, so no creator could save a seeded tag
 * on a Story or Arc ("each value in tagIds must be a UUID"), and no
 * administrator could edit or retire one (sc-1517).
 *
 * The new id keeps the hash and overwrites only the version and variant
 * digits, so it is still derived from the slug and every environment agrees.
 * Only rows still carrying the id the seed gave them change: a tag an
 * administrator made since has a `gen_random_uuid()` id and is left alone.
 *
 * The link tables' foreign keys do not cascade an update, so they are
 * dropped, the links and tags re-keyed together, and the keys put back as
 * they were, all in the migration's transaction.
 *
 * Then a check makes PostgreSQL refuse any tag id that is not version 4. If a
 * row this migration does not recognise still fails it, the migration fails
 * and rolls back rather than leaving an unsaveable tag behind.
 *
 * The way down restores the seed's ids, so the seed's own `down` still finds
 * the rows it inserted.
 */
export class RekeySeededStorytimeTags1799200000000 implements MigrationInterface {
  name = 'RekeySeededStorytimeTags1799200000000';

  /**
   * Re-keys the seeded tags and adds the check.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.dropLinkKeys(queryRunner);

    for (const table of TAG_LINK_TABLES) {
      await queryRunner.query(`
        UPDATE "sto_info_app"."${table}" AS "link"
        SET "tagId" = ${versionFourOf('"tag"."id"')}
        FROM "sto_info_app"."storytime_tag" AS "tag"
        WHERE "link"."tagId" = "tag"."id"
          AND "tag"."id" = ${SEEDED_ID}
      `);
    }

    await queryRunner.query(`
      UPDATE "sto_info_app"."storytime_tag" AS "tag"
      SET "id" = ${versionFourOf('"tag"."id"')}
      WHERE "tag"."id" = ${SEEDED_ID}
    `);

    await this.addLinkKeys(queryRunner);

    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."storytime_tag"
      ADD CONSTRAINT "${TAG_ID_VERSION_CHECK}"
      CHECK ("id"::text ~ '${VERSION_FOUR_UUID_PATTERN}')
    `);
  }

  /**
   * Removes the check and gives the seeded tags their old ids back.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sto_info_app"."storytime_tag"
      DROP CONSTRAINT "${TAG_ID_VERSION_CHECK}"
    `);

    await this.dropLinkKeys(queryRunner);

    for (const table of TAG_LINK_TABLES) {
      await queryRunner.query(`
        UPDATE "sto_info_app"."${table}" AS "link"
        SET "tagId" = ${SEEDED_ID}
        FROM "sto_info_app"."storytime_tag" AS "tag"
        WHERE "link"."tagId" = "tag"."id"
          AND "tag"."id" = ${versionFourOf(SEEDED_ID)}
      `);
    }

    await queryRunner.query(`
      UPDATE "sto_info_app"."storytime_tag" AS "tag"
      SET "id" = ${SEEDED_ID}
      WHERE "tag"."id" = ${versionFourOf(SEEDED_ID)}
    `);

    await this.addLinkKeys(queryRunner);
  }

  /**
   * Drops each link table's foreign key to a tag.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  private async dropLinkKeys(queryRunner: QueryRunner): Promise<void> {
    for (const table of TAG_LINK_TABLES) {
      await queryRunner.query(
        `ALTER TABLE "sto_info_app"."${table}" DROP CONSTRAINT "FK_${table}_tag"`,
      );
    }
  }

  /**
   * Puts back each link table's foreign key to a tag, exactly as
   * `CreateStorytimeTags1789200000000` made it.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  private async addLinkKeys(queryRunner: QueryRunner): Promise<void> {
    for (const table of TAG_LINK_TABLES) {
      await queryRunner.query(
        `ALTER TABLE "sto_info_app"."${table}" ADD CONSTRAINT "FK_${table}_tag" FOREIGN KEY ("tagId") REFERENCES "sto_info_app"."storytime_tag" ("id") ON DELETE CASCADE`,
      );
    }
  }
}

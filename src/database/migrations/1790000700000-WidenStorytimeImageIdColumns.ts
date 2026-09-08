import { MigrationInterface, QueryRunner } from 'typeorm';

/** Every Storytime column holding a Cloudflare Images identifier. */
const IMAGE_ID_COLUMNS: readonly (readonly [table: string, column: string])[] =
  [
    ['storytime_story', 'bannerImageId'],
    ['storytime_story', 'profileImageId'],
    ['storytime_chapter', 'coverImageId'],
    ['storytime_character', 'portraitImageId'],
    ['storytime_arc', 'bannerImageId'],
    ['storytime_arc', 'profileImageId'],
    ['storytime_spotlight', 'overrideImageId'],
  ];

/**
 * Widens the Storytime Cloudflare image identifier columns.
 *
 * The uploader names each image
 * `environment-userId-entityType-entityId-timestamp`. At 100 characters the
 * columns fit the entity types that came before Storytime — `user`,
 * `character` — but not Storytime's own, which run to
 * `storytime-character-portrait`. A banner upload therefore reached Cloudflare
 * and then failed on the way into the database, leaving an image stored under
 * an identifier nothing referred to.
 *
 * 160 covers the longest name the uploader can produce: an eleven-character
 * environment, two UUIDs, the longest entity type, a millisecond timestamp and
 * four separators come to 128.
 */
export class WidenStorytimeImageIdColumns1790000700000 implements MigrationInterface {
  name = 'WidenStorytimeImageIdColumns1790000700000';

  /**
   * Widens each image identifier column to 160 characters.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column] of IMAGE_ID_COLUMNS) {
      await queryRunner.query(
        `ALTER TABLE "sto_info_app"."${table}" ALTER COLUMN "${column}" TYPE character varying(160)`,
      );
    }
  }

  /**
   * Narrows each image identifier column back to 100 characters.
   *
   * Fails rather than truncates if any stored identifier is longer than that,
   * because a truncated identifier addresses no image at all.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column] of [...IMAGE_ID_COLUMNS].reverse()) {
      await queryRunner.query(
        `ALTER TABLE "sto_info_app"."${table}" ALTER COLUMN "${column}" TYPE character varying(100)`,
      );
    }
  }
}

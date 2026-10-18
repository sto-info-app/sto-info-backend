import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Deletes what deleted Storytime Stories left behind.
 *
 * Deleting a Story used to soft-delete the Story's own row and nothing else,
 * so its Chapters and their videos, its cast, its credits and its places in
 * Arcs were left live behind a Story nobody could reach or bring back (found
 * on tribble, 18 October 2026). Deleting a Story now takes them with it; this
 * does the same for every Story deleted before that, marking each leftover
 * deleted at the moment its Story was, by whoever deleted the Story.
 *
 * Their pictures are not touched here. Withdrawing one is a registry change
 * and a Cloudflare delete, which a migration should not make; the sweep at the
 * next start finds every picture a deleted work still holds and withdraws it.
 *
 * The way down restores what was deleted at the same moment as its Story,
 * which is what this marks. A Chapter or Character deleted on its own before
 * its Story keeps its own earlier moment and is left deleted.
 */
export class DeleteLeftoversOfDeletedStories1798200000000 implements MigrationInterface {
  name = 'DeleteLeftoversOfDeletedStories1798200000000';

  /**
   * Marks each deleted Story's leftovers deleted with it.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Videos first, while their Chapters can still be found live.
    await queryRunner.query(`
      UPDATE "sto_info_app"."storytime_chapter_media" m
         SET "deletedAt" = s."deletedAt"
        FROM "sto_info_app"."storytime_chapter" c
        JOIN "sto_info_app"."storytime_story" s ON s."id" = c."storyId"
       WHERE m."chapterId" = c."id"
         AND m."deletedAt" IS NULL
         AND c."deletedAt" IS NULL
         AND s."deletedAt" IS NOT NULL`);

    for (const table of ['storytime_chapter', 'storytime_character']) {
      await queryRunner.query(`
        UPDATE "sto_info_app"."${table}" w
           SET "deletedAt" = s."deletedAt",
               "deletedByUserId" = s."deletedByUserId"
          FROM "sto_info_app"."storytime_story" s
         WHERE w."storyId" = s."id"
           AND w."deletedAt" IS NULL
           AND s."deletedAt" IS NOT NULL`);
    }

    for (const table of ['storytime_crew_credit', 'storytime_arc_story']) {
      await queryRunner.query(`
        UPDATE "sto_info_app"."${table}" r
           SET "deletedAt" = s."deletedAt"
          FROM "sto_info_app"."storytime_story" s
         WHERE r."storyId" = s."id"
           AND r."deletedAt" IS NULL
           AND s."deletedAt" IS NOT NULL`);
    }
  }

  /**
   * Restores what was deleted at the same moment as its Story.
   *
   * @param queryRunner - The TypeORM query runner.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['storytime_arc_story', 'storytime_crew_credit']) {
      await queryRunner.query(`
        UPDATE "sto_info_app"."${table}" r
           SET "deletedAt" = NULL
          FROM "sto_info_app"."storytime_story" s
         WHERE r."storyId" = s."id"
           AND r."deletedAt" = s."deletedAt"`);
    }

    for (const table of ['storytime_character', 'storytime_chapter']) {
      await queryRunner.query(`
        UPDATE "sto_info_app"."${table}" w
           SET "deletedAt" = NULL,
               "deletedByUserId" = NULL
          FROM "sto_info_app"."storytime_story" s
         WHERE w."storyId" = s."id"
           AND w."deletedAt" = s."deletedAt"`);
    }

    await queryRunner.query(`
      UPDATE "sto_info_app"."storytime_chapter_media" m
         SET "deletedAt" = NULL
        FROM "sto_info_app"."storytime_chapter" c
        JOIN "sto_info_app"."storytime_story" s ON s."id" = c."storyId"
       WHERE m."chapterId" = c."id"
         AND m."deletedAt" = s."deletedAt"`);
  }
}

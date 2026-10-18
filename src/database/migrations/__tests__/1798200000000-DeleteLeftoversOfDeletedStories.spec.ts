import { describe, expect, it, jest } from '@jest/globals';
import { QueryRunner } from 'typeorm';

import { DeleteLeftoversOfDeletedStories1798200000000 } from '../1798200000000-DeleteLeftoversOfDeletedStories';

/**
 * Runs a direction of the migration and keeps what it sends.
 *
 * @param direction - Which.
 * @returns Every statement, in order, with its whitespace collapsed.
 */
async function capture(direction: 'up' | 'down'): Promise<string[]> {
  const statements: string[] = [];
  const queryRunner = {
    query: jest.fn((sql: string) => {
      statements.push(sql.replace(/\s+/g, ' ').trim());

      return Promise.resolve();
    }),
  } as unknown as QueryRunner;

  await new DeleteLeftoversOfDeletedStories1798200000000()[direction](
    queryRunner,
  );

  return statements;
}

/**
 * Deleting a Story used to leave its Chapters, cast, credits, videos and Arc
 * places live behind it; this marks those of every Story already deleted. The
 * statements are proved against a real database by the release rehearsal;
 * this holds what they ask for.
 */
describe('DeleteLeftoversOfDeletedStories1798200000000', () => {
  it('deletes the videos first, while their Chapters can still be found live', async () => {
    const [videos] = await capture('up');

    expect(videos).toBe(
      'UPDATE "sto_info_app"."storytime_chapter_media" m SET "deletedAt" = s."deletedAt" FROM "sto_info_app"."storytime_chapter" c JOIN "sto_info_app"."storytime_story" s ON s."id" = c."storyId" WHERE m."chapterId" = c."id" AND m."deletedAt" IS NULL AND c."deletedAt" IS NULL AND s."deletedAt" IS NOT NULL',
    );
  });

  it('deletes Chapters and cast at the moment their Story was, by whoever deleted it', async () => {
    const statements = await capture('up');

    for (const table of ['storytime_chapter', 'storytime_character']) {
      expect(statements).toContain(
        `UPDATE "sto_info_app"."${table}" w SET "deletedAt" = s."deletedAt", "deletedByUserId" = s."deletedByUserId" FROM "sto_info_app"."storytime_story" s WHERE w."storyId" = s."id" AND w."deletedAt" IS NULL AND s."deletedAt" IS NOT NULL`,
      );
    }
  });

  it('deletes credits and Arc places with their Story', async () => {
    const statements = await capture('up');

    for (const table of ['storytime_crew_credit', 'storytime_arc_story']) {
      expect(statements).toContain(
        `UPDATE "sto_info_app"."${table}" r SET "deletedAt" = s."deletedAt" FROM "sto_info_app"."storytime_story" s WHERE r."storyId" = s."id" AND r."deletedAt" IS NULL AND s."deletedAt" IS NOT NULL`,
      );
    }
    expect(statements).toHaveLength(5);
  });

  // Withdrawing a picture is a registry change and a Cloudflare delete; the
  // sweep at the next start does that, never a migration.
  it('leaves the pictures to the sweep', async () => {
    for (const statement of await capture('up')) {
      expect(statement).not.toMatch(/file_asset|ImageId/);
    }
  });

  // What was deleted on its own, before its Story, keeps its own moment.
  it('restores only what went at the same moment as its Story, in reverse', async () => {
    await expect(capture('down')).resolves.toEqual([
      'UPDATE "sto_info_app"."storytime_arc_story" r SET "deletedAt" = NULL FROM "sto_info_app"."storytime_story" s WHERE r."storyId" = s."id" AND r."deletedAt" = s."deletedAt"',
      'UPDATE "sto_info_app"."storytime_crew_credit" r SET "deletedAt" = NULL FROM "sto_info_app"."storytime_story" s WHERE r."storyId" = s."id" AND r."deletedAt" = s."deletedAt"',
      'UPDATE "sto_info_app"."storytime_character" w SET "deletedAt" = NULL, "deletedByUserId" = NULL FROM "sto_info_app"."storytime_story" s WHERE w."storyId" = s."id" AND w."deletedAt" = s."deletedAt"',
      'UPDATE "sto_info_app"."storytime_chapter" w SET "deletedAt" = NULL, "deletedByUserId" = NULL FROM "sto_info_app"."storytime_story" s WHERE w."storyId" = s."id" AND w."deletedAt" = s."deletedAt"',
      'UPDATE "sto_info_app"."storytime_chapter_media" m SET "deletedAt" = NULL FROM "sto_info_app"."storytime_chapter" c JOIN "sto_info_app"."storytime_story" s ON s."id" = c."storyId" WHERE m."chapterId" = c."id" AND m."deletedAt" = s."deletedAt"',
    ]);
  });
});

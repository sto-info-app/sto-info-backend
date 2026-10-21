import { jest } from '@jest/globals';
import { QueryRunner } from 'typeorm';

import { SeedStoInfoFleetCommunitiesAnnouncementNewsPost1798300000000 } from '../1798300000000-SeedStoInfoFleetCommunitiesAnnouncementNewsPost';

type RecordedQuery = { sql: string; parameters: unknown[] | undefined };

describe('SeedStoInfoFleetCommunitiesAnnouncementNewsPost1798300000000', () => {
  const runMigration = async (
    direction: 'up' | 'down',
  ): Promise<RecordedQuery[]> => {
    const migration =
      new SeedStoInfoFleetCommunitiesAnnouncementNewsPost1798300000000();
    const queries: RecordedQuery[] = [];
    const queryRunner = {
      query: jest.fn((sql: string, parameters?: unknown[]) => {
        queries.push({ sql, parameters });

        return Promise.resolve();
      }),
    } as unknown as QueryRunner;

    await migration[direction](queryRunner);

    return queries;
  };

  // The post is dated two hours before the migration runs, so that the
  // release notes seeded after it sit above it on the site's news.
  it('publishes one announcement, dated two hours before it lands', async () => {
    const queries = await runMigration('up');

    expect(queries).toHaveLength(1);

    const [{ sql, parameters }] = queries;

    expect(sql).toContain('INSERT INTO "sto_info_app"."news_post"');
    expect(sql).toContain("'PUBLISHED'");
    expect(sql).toContain('NOW() - make_interval(hours => $6::int)');
    expect(parameters).toEqual([
      'sto-info-introducing-fleet-communities',
      'Introducing Fleet Communities',
      expect.stringContaining('Register your Community'),
      expect.stringContaining('### Three kinds of record'),
      'ANNOUNCEMENT',
      2,
    ]);
  });

  // Re-running the migration against a database that already carries the
  // post must refresh it rather than fail on the unique slug, which Fleet
  // Community's ScopeNewsPosts leaves unique only among the site's own posts.
  it('replaces the post when the slug already exists among the site’s own', async () => {
    const [{ sql }] = await runMigration('up');

    expect(sql).toContain(
      'ON CONFLICT ("slug") WHERE "communityId" IS NULL DO UPDATE SET',
    );
    expect(sql).toContain('"body" = EXCLUDED."body"');
    expect(sql).toContain('"publishedAt" = EXCLUDED."publishedAt"');
  });

  it('covers every part of Fleet Community, chat included', async () => {
    const [{ parameters }] = await runMigration('up');
    const body = parameters?.[3] as string;

    for (const heading of [
      '### Find a Fleet, or follow a Community',
      '### Register your own',
      '### Your Characters and their Fleets',
      '### Joining and recruiting',
      '### Rosters, history and reports',
      '### Armadas and holdings',
      '### News, activity and events',
      '### Chat',
      '### Privacy and safety',
      '### Help is built in',
    ]) {
      expect(body).toContain(heading);
    }

    expect(body).toContain('Direct messages are between friends only');
    // Unlike Storytime's, this launch carries no Beta label; the Armada
    // positions are the only Betas in it.
    expect(body).not.toMatch(/launch\w* as a Beta/i);
  });

  it("removes the post by its slug on the way down, leaving a Community's", async () => {
    const queries = await runMigration('down');

    expect(queries).toEqual([
      {
        sql: 'DELETE FROM "sto_info_app"."news_post" WHERE "slug" = ANY($1) AND "communityId" IS NULL',
        parameters: [['sto-info-introducing-fleet-communities']],
      },
    ]);
  });
});

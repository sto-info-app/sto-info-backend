import { jest } from '@jest/globals';
import { QueryRunner } from 'typeorm';

import { SeedStoInfoSettingsAndLcarsRefreshAnnouncementNewsPost1798400000000 } from '../1798400000000-SeedStoInfoSettingsAndLcarsRefreshAnnouncementNewsPost';

type RecordedQuery = { sql: string; parameters: unknown[] | undefined };

describe('SeedStoInfoSettingsAndLcarsRefreshAnnouncementNewsPost1798400000000', () => {
  const runMigration = async (
    direction: 'up' | 'down',
  ): Promise<RecordedQuery[]> => {
    const migration =
      new SeedStoInfoSettingsAndLcarsRefreshAnnouncementNewsPost1798400000000();
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

  // The post is dated an hour before the migration runs: after the Fleet
  // Communities announcement, and before the release notes.
  it('publishes one announcement, dated an hour before it lands', async () => {
    const queries = await runMigration('up');

    expect(queries).toHaveLength(1);

    const [{ sql, parameters }] = queries;

    expect(sql).toContain('INSERT INTO "sto_info_app"."news_post"');
    expect(sql).toContain("'PUBLISHED'");
    expect(sql).toContain('NOW() - make_interval(hours => $6::int)');
    expect(parameters).toEqual([
      'sto-info-settings-tabs-and-the-lcars-refresh',
      'Settings in tabs, cogs where you need them, and a fresh LCARS look',
      expect.stringContaining('a tab for each part of the site'),
      expect.stringContaining('### Settings, in tabs'),
      'ANNOUNCEMENT',
      1,
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

  it('names the five tabs, the cogs and the LCARS refresh', async () => {
    const [{ parameters }] = await runMigration('up');
    const body = parameters?.[3] as string;

    for (const tab of [
      '**Account**',
      '**Chat**',
      '**Fleet**',
      '**Notifications**',
      '**Custom Tracking**',
    ]) {
      expect(body).toContain(tab);
    }

    expect(body).toContain('### Cogs that go straight to the right setting');
    expect(body).toContain('### A fresh LCARS look, everywhere');
    expect(body).toContain('Each setting is saved the moment you change it');
  });

  it("removes the post by its slug on the way down, leaving a Community's", async () => {
    const queries = await runMigration('down');

    expect(queries).toEqual([
      {
        sql: 'DELETE FROM "sto_info_app"."news_post" WHERE "slug" = ANY($1) AND "communityId" IS NULL',
        parameters: [['sto-info-settings-tabs-and-the-lcars-refresh']],
      },
    ]);
  });
});

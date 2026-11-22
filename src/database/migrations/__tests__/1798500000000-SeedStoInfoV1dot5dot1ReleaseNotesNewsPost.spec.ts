import { jest } from '@jest/globals';
import { QueryRunner } from 'typeorm';

import { SeedStoInfoV151ReleaseNotesNewsPost1798500000000 } from '../1798500000000-SeedStoInfoV1dot5dot1ReleaseNotesNewsPost';

type RecordedQuery = { sql: string; parameters: unknown[] | undefined };

describe('SeedStoInfoV151ReleaseNotesNewsPost1798500000000', () => {
  const runMigration = async (
    direction: 'up' | 'down',
  ): Promise<RecordedQuery[]> => {
    const migration = new SeedStoInfoV151ReleaseNotesNewsPost1798500000000();
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

  // The notes are dated as they land, after the two announcements seeded
  // before them, so that they sit on top of the site's news.
  it('publishes one release-notes post, dated as it lands', async () => {
    const queries = await runMigration('up');

    expect(queries).toHaveLength(1);

    const [{ sql, parameters }] = queries;

    expect(sql).toContain('INSERT INTO "sto_info_app"."news_post"');
    expect(sql).toContain("'PUBLISHED'");
    expect(sql).toContain('NOW() - make_interval(hours => $6::int)');
    expect(parameters).toEqual([
      'sto-info-version-1-5-1-release',
      'Update: Fleet Communities (v1.5.1)',
      expect.stringContaining('Fleet Communities'),
      expect.stringContaining('### Release information'),
      'RELEASE_NOTES',
      0,
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

  it('links all three releases and both announcements, and notes the policies', async () => {
    const [{ parameters }] = await runMigration('up');
    const body = parameters?.[3] as string;

    expect(body).toContain(
      'https://github.com/sto-info-app/sto-info-backend/releases/tag/v1.5.1',
    );
    expect(body).toContain(
      'https://github.com/sto-info-app/sto-info-frontend/releases/tag/v1.5.1',
    );
    expect(body).toContain(
      'https://github.com/sto-info-app/sto-info-file-scan-worker/releases/tag/v1.0.1',
    );
    expect(body).toContain('(/news/sto-info-introducing-fleet-communities)');
    expect(body).toContain(
      '(/news/sto-info-settings-tabs-and-the-lcars-refresh)',
    );
    expect(body).toContain('**Please note:**');
    expect(body).toContain('29 September 2026');
  });

  it("removes the post by its slug on the way down, leaving a Community's", async () => {
    const queries = await runMigration('down');

    expect(queries).toEqual([
      {
        sql: 'DELETE FROM "sto_info_app"."news_post" WHERE "slug" = ANY($1) AND "communityId" IS NULL',
        parameters: [['sto-info-version-1-5-1-release']],
      },
    ]);
  });
});

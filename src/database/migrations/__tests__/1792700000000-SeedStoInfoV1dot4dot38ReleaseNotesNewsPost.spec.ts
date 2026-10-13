import { jest } from '@jest/globals';
import { QueryRunner } from 'typeorm';

import { SeedStoInfoV1438ReleaseNotesNewsPost1792700000000 } from '../1792700000000-SeedStoInfoV1dot4dot38ReleaseNotesNewsPost';

type RecordedQuery = { sql: string; parameters: unknown[] | undefined };

describe('SeedStoInfoV1438ReleaseNotesNewsPost1792700000000', () => {
  // `scoped`: the database is already on Fleet Community's schema, where
  // news_post has a communityId column and the slug index is partial.
  const runMigration = async (
    direction: 'up' | 'down',
    scoped = false,
  ): Promise<RecordedQuery[]> => {
    const migration = new SeedStoInfoV1438ReleaseNotesNewsPost1792700000000();
    const queries: RecordedQuery[] = [];
    const queryRunner = {
      query: jest.fn((sql: string, parameters?: unknown[]) => {
        if (sql.includes('information_schema.columns')) {
          expect(sql).toContain("table_name = 'news_post'");
          expect(sql).toContain("column_name = 'communityId'");

          return Promise.resolve(scoped ? [{ '?column?': 1 }] : []);
        }

        queries.push({ sql, parameters });

        return Promise.resolve();
      }),
    } as unknown as QueryRunner;

    await migration[direction](queryRunner);

    return queries;
  };

  it('publishes one release-notes post', async () => {
    const queries = await runMigration('up');

    expect(queries).toHaveLength(1);

    const [{ sql, parameters }] = queries;

    expect(sql).toContain('INSERT INTO "sto_info_app"."news_post"');
    expect(sql).toContain("'PUBLISHED'");
    expect(parameters).toEqual([
      'sto-info-version-1-4-38-release',
      'Update: Captain Progress Summary & Collapsible Sections (v1.4.38)',
      expect.stringContaining('Captain overview'),
      expect.stringContaining('### Release information'),
      'RELEASE_NOTES',
      '2026-10-12T18:00:00.000Z',
    ]);
  });

  // Re-running the migration against a database that already carries the
  // post must refresh it rather than fail on the unique slug.
  it('replaces the post when the slug already exists', async () => {
    const [{ sql }] = await runMigration('up');

    expect(sql).toContain('ON CONFLICT ("slug") DO UPDATE SET');
    expect(sql).toContain('"body" = EXCLUDED."body"');
    expect(sql).toContain('"publishedAt" = EXCLUDED."publishedAt"');
  });

  // Fleet Community's ScopeNewsPosts leaves the slug unique only among the
  // site's own posts, and an upsert has to name that predicate to use it.
  it('names the site-only slug index once news is scoped', async () => {
    const queries = await runMigration('up', true);

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain(
      'ON CONFLICT ("slug") WHERE "communityId" IS NULL DO UPDATE SET',
    );
  });

  it('links both v1.4.38 releases and names the Tour of Duty reset', async () => {
    const [{ parameters }] = await runMigration('up');
    const body = parameters?.[3] as string;

    expect(body).toContain(
      'https://github.com/sto-info-app/sto-info-backend/releases/tag/v1.4.38',
    );
    expect(body).toContain(
      'https://github.com/sto-info-app/sto-info-frontend/releases/tag/v1.4.38',
    );
    expect(body).toContain('reset to zero');
  });

  it('removes the post by its slug on the way down', async () => {
    const queries = await runMigration('down');

    expect(queries).toEqual([
      {
        sql: 'DELETE FROM "sto_info_app"."news_post" WHERE "slug" = ANY($1)',
        parameters: [['sto-info-version-1-4-38-release']],
      },
    ]);
  });

  it("leaves a Community's post of the same slug once news is scoped", async () => {
    const queries = await runMigration('down', true);

    expect(queries).toEqual([
      {
        sql: 'DELETE FROM "sto_info_app"."news_post" WHERE "slug" = ANY($1) AND "communityId" IS NULL',
        parameters: [['sto-info-version-1-4-38-release']],
      },
    ]);
  });
});

import { jest } from '@jest/globals';
import { QueryRunner } from 'typeorm';

import { CreateCustomTrackingImageCleanupTable1791300000000 } from '../1791300000000-CreateCustomTrackingImageCleanupTable';

describe('CreateCustomTrackingImageCleanupTable1791300000000', () => {
  const runMigration = async (direction: 'up' | 'down'): Promise<string[]> => {
    const migration = new CreateCustomTrackingImageCleanupTable1791300000000();
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn((sql: string) => {
        queries.push(sql);

        return Promise.resolve();
      }),
    } as unknown as QueryRunner;

    await migration[direction](queryRunner);

    return queries;
  };

  const positionOf = (queries: string[], fragment: string): number =>
    queries.findIndex(query => query.includes(fragment));

  it('creates the queue table', async () => {
    const queries = await runMigration('up');

    expect(
      positionOf(
        queries,
        'CREATE TABLE "sto_info_app"."custom_tracking_image_cleanup"',
      ),
    ).toBeGreaterThan(-1);
  });

  it('creates the reason type before the table that uses it', async () => {
    const queries = await runMigration('up');

    expect(
      positionOf(queries, 'CREATE TYPE') <
        positionOf(queries, 'CREATE TABLE "sto_info_app"'),
    ).toBe(true);
  });

  // A replacement that is retried, or a sweep that runs twice over the same
  // night, has to write the same row rather than a second one to delete twice.
  it('makes queueing idempotent with a unique key on the identifier', async () => {
    const queries = await runMigration('up');

    expect(
      queries.find(query =>
        query.includes('UX_custom_tracking_image_cleanup_image'),
      ),
    ).toContain('CREATE UNIQUE INDEX');
  });

  // The pass takes the oldest first, so nothing waiting is starved by a steady
  // arrival of new work.
  it('indexes the arrival time the pass orders by', async () => {
    const queries = await runMigration('up');

    expect(
      positionOf(queries, 'IDX_custom_tracking_image_cleanup_created'),
    ).toBeGreaterThan(-1);
  });

  // The other two Custom Tracking migrations generate identifiers with
  // gen_random_uuid(), which Postgres provides itself. uuid_generate_v4() would
  // work here too — ten older migrations use it — but it comes from the
  // uuid-ossp extension, and there is no reason for one table of nine to be the
  // one that needs an extension installed.
  it('generates identifiers the way the rest of the feature does', async () => {
    const queries = await runMigration('up');

    const create = queries.find(query =>
      query.includes(
        'CREATE TABLE "sto_info_app"."custom_tracking_image_cleanup"',
      ),
    );

    expect(create).toContain('DEFAULT gen_random_uuid()');
    expect(create).not.toContain('uuid_generate_v4');
  });

  it('drops the table before the type it depends on', async () => {
    const queries = await runMigration('down');

    expect(positionOf(queries, 'DROP TABLE')).toBeLessThan(
      positionOf(queries, 'DROP TYPE'),
    );
  });
});

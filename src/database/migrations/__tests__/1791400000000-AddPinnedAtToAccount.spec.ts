import { jest } from '@jest/globals';
import { QueryRunner } from 'typeorm';

import { AddPinnedAtToAccount1791400000000 } from '../1791400000000-AddPinnedAtToAccount';

describe('AddPinnedAtToAccount1791400000000', () => {
  const runMigration = async (direction: 'up' | 'down'): Promise<string[]> => {
    const migration = new AddPinnedAtToAccount1791400000000();
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

  it('adds the pinnedAt column', async () => {
    const queries = await runMigration('up');

    expect(queries).toEqual([
      'ALTER TABLE "sto_info_app"."account" ADD "pinnedAt" TIMESTAMP',
    ]);
  });

  // Every existing account starts unpinned, so the column has to accept NULL
  // rather than carry a default that would pin the whole estate at once.
  it('adds the column as nullable with no default', async () => {
    const [addColumn] = await runMigration('up');

    expect(addColumn).not.toContain('NOT NULL');
    expect(addColumn).not.toContain('DEFAULT');
  });

  it('drops the pinnedAt column on the way down', async () => {
    const queries = await runMigration('down');

    expect(queries).toEqual([
      'ALTER TABLE "sto_info_app"."account" DROP COLUMN "pinnedAt"',
    ]);
  });
});

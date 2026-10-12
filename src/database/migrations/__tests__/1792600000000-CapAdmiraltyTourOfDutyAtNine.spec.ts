import { jest } from '@jest/globals';
import { QueryRunner } from 'typeorm';

import { CapAdmiraltyTourOfDutyAtNine1792600000000 } from '../1792600000000-CapAdmiraltyTourOfDutyAtNine';

describe('CapAdmiraltyTourOfDutyAtNine1792600000000', () => {
  const runMigration = async (direction: 'up' | 'down'): Promise<string[]> => {
    const migration = new CapAdmiraltyTourOfDutyAtNine1792600000000();
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

  // A tour recorded at ten has paid out and begun again, so it is put back to
  // nought - and that has to happen before the check that would refuse it.
  it('resets tours at ten before tightening the check', async () => {
    const queries = await runMigration('up');

    expect(queries).toEqual([
      'UPDATE "sto_info_app"."character_admiralty_progress" SET "tourOfDutyStep" = 0 WHERE "tourOfDutyStep" >= 10',
      'ALTER TABLE "sto_info_app"."character_admiralty_progress" DROP CONSTRAINT "CK_character_admiralty_progress_tour"',
      'ALTER TABLE "sto_info_app"."character_admiralty_progress" ADD CONSTRAINT "CK_character_admiralty_progress_tour" CHECK ("tourOfDutyStep" BETWEEN 0 AND 9)',
    ]);
  });

  it('leaves the campaign tier check alone', async () => {
    const queries = await runMigration('up');

    expect(queries.join('\n')).not.toContain(
      'CK_character_admiralty_progress_tier',
    );
    expect(queries.join('\n')).not.toContain('currentTier');
  });

  it('restores the ten-step check on the way down without touching rows', async () => {
    const queries = await runMigration('down');

    expect(queries).toEqual([
      'ALTER TABLE "sto_info_app"."character_admiralty_progress" DROP CONSTRAINT "CK_character_admiralty_progress_tour"',
      'ALTER TABLE "sto_info_app"."character_admiralty_progress" ADD CONSTRAINT "CK_character_admiralty_progress_tour" CHECK ("tourOfDutyStep" BETWEEN 0 AND 10)',
    ]);
    expect(queries.join('\n')).not.toContain('UPDATE');
  });
});

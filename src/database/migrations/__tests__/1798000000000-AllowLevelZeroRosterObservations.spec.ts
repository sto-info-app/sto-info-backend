import { describe, expect, it, jest } from '@jest/globals';
import { QueryRunner } from 'typeorm';

import {
  AllowLevelZeroRosterObservations1798000000000,
  ROSTER_OBSERVATION_LEVEL_CHECK,
} from '../1798000000000-AllowLevelZeroRosterObservations';

/**
 * Runs a direction of the migration and keeps what it sends.
 *
 * @param direction - Which.
 * @returns Every statement, in order.
 */
async function capture(direction: 'up' | 'down'): Promise<string[]> {
  const statements: string[] = [];
  const queryRunner = {
    query: jest.fn((sql: string) => {
      statements.push(sql);

      return Promise.resolve();
    }),
  } as unknown as QueryRunner;

  await new AllowLevelZeroRosterObservations1798000000000()[direction](
    queryRunner,
  );

  return statements;
}

/**
 * The game writes a level of 0 for a Character created but never played, and
 * the parser has always read it; the table refused it until this. The check
 * is proved against a real database by the release rehearsal; this holds
 * what it asks for.
 */
describe('AllowLevelZeroRosterObservations1798000000000', () => {
  it('replaces the level check with one that admits zero', async () => {
    await expect(capture('up')).resolves.toEqual([
      `ALTER TABLE "sto_info_app"."fleet_roster_observation" DROP CONSTRAINT "${ROSTER_OBSERVATION_LEVEL_CHECK}"`,
      `ALTER TABLE "sto_info_app"."fleet_roster_observation" ADD CONSTRAINT "${ROSTER_OBSERVATION_LEVEL_CHECK}" CHECK ("level" >= 0)`,
    ]);
  });

  it('keeps the check’s name, so nothing else has to learn a new one', () => {
    expect(ROSTER_OBSERVATION_LEVEL_CHECK).toBe('CHK_roster_observation_level');
  });

  it('puts the original check back on the way down', async () => {
    await expect(capture('down')).resolves.toEqual([
      `ALTER TABLE "sto_info_app"."fleet_roster_observation" DROP CONSTRAINT "${ROSTER_OBSERVATION_LEVEL_CHECK}"`,
      `ALTER TABLE "sto_info_app"."fleet_roster_observation" ADD CONSTRAINT "${ROSTER_OBSERVATION_LEVEL_CHECK}" CHECK ("level" >= 1)`,
    ]);
  });
});

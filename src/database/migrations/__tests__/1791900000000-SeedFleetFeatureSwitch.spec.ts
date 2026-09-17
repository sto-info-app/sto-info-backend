import { jest } from '@jest/globals';
import { QueryRunner } from 'typeorm';

import { FLEET_COMMUNITIES_ENABLED_SETTING_KEY } from '../../../fleet/constants/fleet-feature.constants';
import { SeedFleetFeatureSwitch1791900000000 } from '../1791900000000-SeedFleetFeatureSwitch';

/**
 * Migrations are excluded from coverage and run against a real database only in
 * rehearsal, so this spec asserts the SQL the migration emits.
 *
 * Three properties carry FC-006's requirement that the switch is seeded
 * disabled: the value is `false`, the key is the one the service actually
 * reads, and an environment that has already switched the feature on by hand is
 * not switched back off by deploying this.
 */
describe('SeedFleetFeatureSwitch1791900000000', () => {
  const runMigration = async (direction: 'up' | 'down'): Promise<string[]> => {
    const migration = new SeedFleetFeatureSwitch1791900000000();
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

  it('names the migration after its own class', () => {
    expect(new SeedFleetFeatureSwitch1791900000000().name).toBe(
      'SeedFleetFeatureSwitch1791900000000',
    );
  });

  it('seeds the switch disabled', async () => {
    const [insert] = await runMigration('up');

    expect(insert).toContain("'FLEET_COMMUNITIES_ENABLED', 'false'");
  });

  /**
   * Read from the constant the service uses rather than typed again here. A key
   * that differed between the seed and the reader would leave the setting row
   * sitting in the table while every lookup fell through to its default, which
   * is a failure no other test would catch.
   */
  it('seeds the key the feature service reads', async () => {
    const [insert] = await runMigration('up');

    expect(insert).toContain(FLEET_COMMUNITIES_ENABLED_SETTING_KEY);
  });

  it('leaves an environment that is already switched on alone', async () => {
    const [insert] = await runMigration('up');

    expect(insert).toContain('ON CONFLICT ("key") DO NOTHING');
  });

  /**
   * The description is what an administrator reads in the settings list before
   * throwing the switch, so it says what the switch does not do as well as what
   * it does.
   */
  it('says that file scanning and retention are unaffected', async () => {
    const [insert] = await runMigration('up');

    expect(insert).toMatch(/File scanning and retention jobs are site-wide/);
  });

  it('touches nothing but the one setting row', async () => {
    const up = await runMigration('up');
    const down = await runMigration('down');

    expect(up).toHaveLength(1);
    expect(down).toHaveLength(1);
    expect(down[0]).toContain('DELETE FROM');
    expect(down[0]).toContain('FLEET_COMMUNITIES_ENABLED');
  });
});

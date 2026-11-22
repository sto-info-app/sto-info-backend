import { jest } from '@jest/globals';
import { QueryRunner } from 'typeorm';

import { UseCalendarDatesForEnteredDays1792000000000 } from '../1792000000000-UseCalendarDatesForEnteredDays';

/**
 * Migrations are excluded from coverage and run against a real database only in
 * rehearsal, so this spec asserts the SQL the migration emits.
 *
 * The assertions that matter are about the cast. `ALTER COLUMN ... TYPE date`
 * without a `USING` clause is accepted by PostgreSQL and does its own implicit
 * conversion; spelling it out is what makes the truncation deliberate rather
 * than incidental, and what a reader checks when they want to know whether the
 * day could have moved.
 */
describe('UseCalendarDatesForEnteredDays1792000000000', () => {
  const runMigration = async (direction: 'up' | 'down'): Promise<string[]> => {
    const migration = new UseCalendarDatesForEnteredDays1792000000000();
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
    expect(new UseCalendarDatesForEnteredDays1792000000000().name).toBe(
      'UseCalendarDatesForEnteredDays1792000000000',
    );
  });

  describe('up', () => {
    it('converts both columns and nothing else', async () => {
      const queries = await runMigration('up');

      expect(queries).toHaveLength(2);
      expect(queries.every(query => query.includes('ALTER COLUMN'))).toBe(true);
    });

    it.each([
      ['account', 'accountCreatedDate'],
      ['character', 'createdDate'],
    ])(
      'converts %s.%s to a date, casting explicitly',
      async (table, column) => {
        const queries = await runMigration('up');
        const statement = queries.find(query => query.includes(`."${table}"`));

        expect(statement).toContain(`ALTER COLUMN "${column}" TYPE date`);
        expect(statement).toContain(`USING "${column}"::date`);
      },
    );

    /**
     * `timestamp without time zone` carries no zone, so `::date` truncates the
     * fields the value already has and the session timezone cannot move the
     * day. A cast through `timestamptz` could.
     */
    it('does not route the cast through a zoned type', async () => {
      const queries = await runMigration('up');

      expect(queries.join('\n')).not.toContain('timestamptz');
      expect(queries.join('\n')).not.toContain('AT TIME ZONE');
    });
  });

  describe('down', () => {
    it.each([
      ['account', 'accountCreatedDate'],
      ['character', 'createdDate'],
    ])('returns %s.%s to a timestamp', async (table, column) => {
      const queries = await runMigration('down');
      const statement = queries.find(query => query.includes(`."${table}"`));

      expect(statement).toContain(`ALTER COLUMN "${column}" TYPE timestamp`);
      expect(statement).toContain(`USING "${column}"::timestamp`);
    });

    it('reverses the order it applied them in', async () => {
      const up = await runMigration('up');
      const down = await runMigration('down');

      expect(up[0]).toContain('"account"');
      expect(down[0]).toContain('"character"');
    });
  });
});

import { jest } from '@jest/globals';
import { QueryRunner } from 'typeorm';

import { CreateUserPreference1791800000000 } from '../1791800000000-CreateUserPreference';

/**
 * Migrations are excluded from coverage and run against a real database only in
 * rehearsal, so this spec asserts the SQL the migration emits.
 *
 * The assertions here are almost entirely about the move. Creating a table is
 * hard to get wrong in a way nothing notices; dropping two columns that hold
 * everybody's privacy mode and session length is not, and the ordering — copy,
 * then drop — is the whole difference between a migration and a data loss.
 */
describe('CreateUserPreference1791800000000', () => {
  const runMigration = async (direction: 'up' | 'down'): Promise<string[]> => {
    const migration = new CreateUserPreference1791800000000();
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

  const indexOfStatement = (queries: string[], fragment: string): number => {
    const found = queries.findIndex(query => query.includes(fragment));

    if (found === -1) {
      throw new Error(`No statement contains: ${fragment}`);
    }

    return found;
  };

  it('names the migration after its own class', () => {
    expect(new CreateUserPreference1791800000000().name).toBe(
      'CreateUserPreference1791800000000',
    );
  });

  describe('up', () => {
    it('creates one table and one enum type', async () => {
      const queries = await runMigration('up');

      expect(
        queries.filter(query => query.includes('CREATE TABLE')),
      ).toHaveLength(1);
      expect(
        queries.filter(query => query.includes('CREATE TYPE')),
      ).toHaveLength(1);
    });

    /**
     * The one ordering that matters. Dropping first and copying afterwards
     * would read almost identically and would silently reset every user's
     * privacy mode and session length to the defaults.
     */
    it('copies the existing settings before dropping the columns', async () => {
      const queries = await runMigration('up');

      const copied = indexOfStatement(queries, 'INSERT INTO');
      const droppedTimeout = indexOfStatement(
        queries,
        'DROP COLUMN "sessionTimeoutMinutes"',
      );
      const droppedPrivacy = indexOfStatement(
        queries,
        'DROP COLUMN "privacyMode"',
      );

      expect(copied).toBeLessThan(droppedTimeout);
      expect(copied).toBeLessThan(droppedPrivacy);
    });

    /**
     * A profile with privacy mode off and no chosen timeout says exactly what
     * the defaults already say. Writing a row for it would put a copy of the
     * defaults next to every account and make a later change of default apply
     * to nobody.
     */
    it('copies only profiles that had chosen something', async () => {
      const queries = await runMigration('up');
      const insert = queries[indexOfStatement(queries, 'INSERT INTO')];

      expect(insert).toMatch(/WHERE\s+"privacyMode" = true/);
      expect(insert).toMatch(/OR\s+"sessionTimeoutMinutes" IS NOT NULL/);
    });

    it('carries the session timeout constraint across to the new table', async () => {
      const queries = await runMigration('up');
      const create = queries[indexOfStatement(queries, 'CREATE TABLE')];

      expect(create).toContain('CHK_user_preference_session_timeout');
      expect(create).toContain('IN (60, 240, 480)');
    });

    it('drops the old constraint with the column it guarded', async () => {
      const queries = await runMigration('up');

      expect(
        indexOfStatement(
          queries,
          'DROP CONSTRAINT "CHK_user_profile_session_timeout"',
        ),
      ).toBeLessThan(
        indexOfStatement(queries, 'DROP COLUMN "sessionTimeoutMinutes"'),
      );
    });

    /**
     * Preferences follow the account. There is nothing to keep once the user is
     * gone, and a row left behind would be a preference belonging to nobody.
     */
    it('cascades the row away with its user', async () => {
      const queries = await runMigration('up');
      const create = queries[indexOfStatement(queries, 'CREATE TABLE')];

      expect(create).toMatch(
        /FOREIGN KEY \("userId"\) REFERENCES "sto_info_app"\."user"\("id"\) ON DELETE CASCADE/,
      );
    });

    it('defaults presence to friends and typing to off', async () => {
      const queries = await runMigration('up');
      const create = queries[indexOfStatement(queries, 'CREATE TABLE')];

      expect(create).toMatch(/"presenceVisibility".*DEFAULT 'FRIENDS'/);
      expect(create).toMatch(
        /"typingIndicatorsEnabled" boolean NOT NULL DEFAULT false/,
      );
    });

    it('defaults every notification category to on', async () => {
      const queries = await runMigration('up');
      const create = queries[indexOfStatement(queries, 'CREATE TABLE')];

      for (const column of [
        'notifyMention',
        'notifyReply',
        'notifyDirectMessage',
        'notifyRosterAssociation',
        'notifyEventReminder',
      ]) {
        expect(create).toContain(`"${column}" boolean NOT NULL DEFAULT true`);
      }
    });

    /**
     * ADR-0007 restricts `timestamptz` to the Fleet tables. This is a user
     * table, so it follows the surrounding convention instead — the database
     * session is UTC, which is what makes a naive column an instant.
     */
    it('uses naive timestamps like the rest of the user schema', async () => {
      const queries = await runMigration('up');
      const create = queries[indexOfStatement(queries, 'CREATE TABLE')];

      expect(create).not.toContain('timestamptz');
      expect(create).toContain('"createdAt" TIMESTAMP NOT NULL');
    });
  });

  describe('down', () => {
    /**
     * A rollback that returned the schema but not the choices would be a
     * migration somebody could run twice and lose everything. The columns come
     * back, are repopulated from the table, and only then is the table dropped.
     */
    it('restores and repopulates the columns before dropping the table', async () => {
      const queries = await runMigration('down');

      const addedPrivacy = indexOfStatement(queries, 'ADD "privacyMode"');
      const addedTimeout = indexOfStatement(
        queries,
        'ADD "sessionTimeoutMinutes"',
      );
      const repopulated = indexOfStatement(queries, 'UPDATE');
      const dropped = indexOfStatement(queries, 'DROP TABLE');

      expect(addedPrivacy).toBeLessThan(repopulated);
      expect(addedTimeout).toBeLessThan(repopulated);
      expect(repopulated).toBeLessThan(dropped);
    });

    it('restores the original constraint name', async () => {
      const queries = await runMigration('down');

      expect(
        queries.some(query =>
          query.includes('CHK_user_profile_session_timeout'),
        ),
      ).toBe(true);
    });

    /**
     * The type is dropped after the table that uses it, which is the only order
     * PostgreSQL permits.
     */
    it('drops the enum type after the table', async () => {
      const queries = await runMigration('down');

      expect(indexOfStatement(queries, 'DROP TABLE')).toBeLessThan(
        indexOfStatement(queries, 'DROP TYPE'),
      );
    });
  });
});

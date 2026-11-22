import { jest } from '@jest/globals';
import { QueryRunner } from 'typeorm';

import { CreateFileAssets1792100000000 } from '../1792100000000-CreateFileAssets';

/**
 * Migrations are excluded from coverage and run against a real database only in
 * rehearsal, so this spec asserts the SQL the migration emits.
 *
 * Every assertion here corresponds to something FC-008's acceptance criteria
 * require, or to a property that would fail silently if it regressed. The
 * trigger is the one worth being fussy about: it is the only thing standing
 * between a stray `UPDATE` and a refused file becoming a published one, and
 * nothing about a missing trigger looks wrong until somebody tries it.
 */
describe('CreateFileAssets1792100000000', () => {
  const TABLE = 'sto_info_app"."file_asset';

  const runMigration = async (direction: 'up' | 'down'): Promise<string[]> => {
    const migration = new CreateFileAssets1792100000000();
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

  const statementFor = (queries: string[], fragment: string): string => {
    const found = queries.find(query => query.includes(fragment));

    if (found === undefined) {
      throw new Error(`No statement contains: ${fragment}`);
    }

    return found;
  };

  describe('the table itself', () => {
    it('creates one table and four enum types, and nothing else', async () => {
      const queries = await runMigration('up');

      expect(
        queries.filter(query => query.includes('CREATE TABLE')),
      ).toHaveLength(1);
      expect(
        queries.filter(query => query.includes('CREATE TYPE')),
      ).toHaveLength(4);
      expect(statementFor(queries, 'CREATE TABLE')).toContain(TABLE);
    });

    /**
     * ADR-0007. Anyone reviewing this against the other twenty-nine files will
     * think a naive timestamp was meant; it was not.
     */
    it('stores every instant with its offset', async () => {
      const create = statementFor(await runMigration('up'), 'CREATE TABLE');

      expect(create).not.toMatch(/\bTIMESTAMP\b(?!TZ)/i);
      expect(create).toContain('"availableAt" timestamptz');
      expect(create).toContain('"withdrawnAt" timestamptz');
    });

    it('names the state enum values the application uses', async () => {
      const queries = await runMigration('up');
      const stateType = statementFor(queries, 'file_asset_state_enum');

      for (const state of [
        'UNVERIFIED',
        'RECEIVING',
        'QUARANTINED',
        'SCANNING',
        'CLEAN',
        'AVAILABLE',
        'RETRY_PENDING',
        'REJECTED',
        'REVOKED',
        'DELETED',
      ]) {
        expect(stateType).toContain(`'${state}'`);
      }
    });

    it('reuses the Fleet audience type rather than declaring a second one', async () => {
      const queries = await runMigration('up');

      expect(statementFor(queries, 'CREATE TABLE')).toContain(
        '"scopeAudience" "sto_info_app"."fleet_audience_enum"',
      );
      expect(
        queries.filter(query =>
          query.includes('CREATE TYPE "sto_info_app"."fleet_audience_enum"'),
        ),
      ).toHaveLength(0);
    });
  });

  describe('the guard trigger', () => {
    it('is created and attached before every update', async () => {
      const queries = await runMigration('up');

      expect(statementFor(queries, 'CREATE OR REPLACE FUNCTION')).toContain(
        'file_asset_guard',
      );
      expect(statementFor(queries, 'CREATE TRIGGER')).toContain(
        'BEFORE UPDATE ON "sto_info_app"."file_asset" FOR EACH ROW',
      );
    });

    /**
     * The fourth acceptance criterion. Three columns, each refused
     * independently, and each only once it holds a value — filling one in is
     * how an upload completes.
     */
    it.each(['objectKey', 'objectVersion', 'sha256'])(
      'refuses a change to %s once it holds a value',
      async column => {
        const guard = statementFor(
          await runMigration('up'),
          'CREATE OR REPLACE FUNCTION',
        );

        expect(guard).toContain(
          `IF OLD."${column}" IS NOT NULL AND NEW."${column}" IS DISTINCT FROM OLD."${column}" THEN`,
        );
      },
    );

    /**
     * The first acceptance criterion. Two doors into `AVAILABLE` and no
     * others; in particular none from `REJECTED` or `REVOKED`.
     */
    it('lets an asset become available only from CLEAN or UNVERIFIED', async () => {
      const guard = statementFor(
        await runMigration('up'),
        'CREATE OR REPLACE FUNCTION',
      );

      expect(guard).toContain(
        `IF NEW."state" = 'AVAILABLE' AND OLD."state" NOT IN ('AVAILABLE', 'CLEAN', 'UNVERIFIED') THEN`,
      );
    });

    it('raises a check violation so callers can tell it apart', async () => {
      const guard = statementFor(
        await runMigration('up'),
        'CREATE OR REPLACE FUNCTION',
      );

      expect(guard.match(/ERRCODE = '23514'/g)).toHaveLength(4);
    });
  });

  describe('the constraints', () => {
    it.each([
      'CHK_file_asset_single_scope',
      'CHK_file_asset_scope_audience',
      'CHK_file_asset_scope_named',
      'CHK_file_asset_available_object',
      'CHK_file_asset_sha256_hex',
      'CHK_file_asset_byte_size',
      'CHK_file_asset_policy_version',
      'CHK_file_asset_purged_after_required',
    ])('declares %s', async constraint => {
      expect(statementFor(await runMigration('up'), 'CREATE TABLE')).toContain(
        constraint,
      );
    });

    /**
     * The row is what tells the cleanup cron an object exists. Cascading the
     * uploader's deletion onto it would leave bytes in the bucket with nothing
     * pointing at them, which no inventory can then reach.
     */
    it('severs the uploader rather than deleting the evidence', async () => {
      const create = statementFor(await runMigration('up'), 'CREATE TABLE');

      expect(create).toContain(
        'CONSTRAINT "FK_file_asset_owner" FOREIGN KEY ("ownerUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL',
      );
    });

    it('refuses to let a scope be deleted out from under its assets', async () => {
      const create = statementFor(await runMigration('up'), 'CREATE TABLE');

      for (const constraint of [
        'FK_file_asset_community',
        'FK_file_asset_fleet',
        'FK_file_asset_armada',
      ]) {
        expect(create).toMatch(
          new RegExp(`CONSTRAINT "${constraint}"[^,]*ON DELETE RESTRICT`),
        );
      }
    });
  });

  describe('the indexes', () => {
    /**
     * Partial, and it has to stay that way. A full unique index would refuse
     * every second row whose key is null, which is every asset between being
     * registered and being stored.
     */
    it('keeps one asset per object without blocking unstored ones', async () => {
      const index = statementFor(
        await runMigration('up'),
        'UX_file_asset_object',
      );

      expect(index).toContain('CREATE UNIQUE INDEX');
      expect(index).toContain(
        'WHERE "deletedAt" IS NULL AND "objectKey" IS NOT NULL',
      );
    });

    it('indexes the outstanding purges, which are normally none', async () => {
      const index = statementFor(
        await runMigration('up'),
        'IDX_file_asset_purge_outstanding',
      );

      expect(index).toContain(
        'WHERE "purgeRequiredAt" IS NOT NULL AND "purgedAt" IS NULL',
      );
    });
  });

  describe('the rollback', () => {
    it('removes the trigger, the function, the table and all four types', async () => {
      const queries = await runMigration('down');

      expect(queries.filter(query => query.includes('DROP TYPE'))).toHaveLength(
        4,
      );
      expect(statementFor(queries, 'DROP TRIGGER')).toContain(
        'TR_file_asset_guard',
      );
      expect(statementFor(queries, 'DROP FUNCTION')).toContain(
        'file_asset_guard',
      );
      expect(statementFor(queries, 'DROP TABLE')).toContain(TABLE);
    });

    it('drops the trigger before the table it is attached to', async () => {
      const queries = await runMigration('down');

      expect(
        queries.findIndex(query => query.includes('DROP TRIGGER')),
      ).toBeLessThan(queries.findIndex(query => query.includes('DROP TABLE')));
    });
  });
});

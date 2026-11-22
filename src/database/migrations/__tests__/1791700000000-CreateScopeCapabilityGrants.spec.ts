import { jest } from '@jest/globals';
import { QueryRunner } from 'typeorm';

import { CreateScopeCapabilityGrants1791700000000 } from '../1791700000000-CreateScopeCapabilityGrants';

/**
 * Migrations are excluded from coverage and run against a real database only in
 * rehearsal, so this spec asserts the SQL the migration emits.
 *
 * As with FC-004's, every assertion corresponds to something FC-005's
 * acceptance criteria require, or to a property that would fail silently if it
 * regressed: a partial unique index becoming a full one, a composite foreign
 * key losing its second column, or the effect column creeping into a uniqueness
 * key and letting a contradictory pair of grants be stored.
 */
describe('CreateScopeCapabilityGrants1791700000000', () => {
  const TABLE = 'sto_info_app"."scope_capability_grant';

  const OPEN_GRANT_INDEXES = [
    'UX_scope_capability_grant_open_community_user',
    'UX_scope_capability_grant_open_community_role',
    'UX_scope_capability_grant_open_fleet_user',
    'UX_scope_capability_grant_open_fleet_role',
    'UX_scope_capability_grant_open_armada_user',
    'UX_scope_capability_grant_open_armada_role',
  ];

  const runMigration = async (direction: 'up' | 'down'): Promise<string[]> => {
    const migration = new CreateScopeCapabilityGrants1791700000000();
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
    it('creates one table and one enum type, and nothing else', async () => {
      const queries = await runMigration('up');

      expect(
        queries.filter(query => query.includes('CREATE TABLE')),
      ).toHaveLength(1);
      expect(
        queries.filter(query => query.includes('CREATE TYPE')),
      ).toHaveLength(1);
      expect(queries.some(query => query.includes('ALTER TABLE'))).toBe(false);
      expect(queries.some(query => query.includes('DROP'))).toBe(false);
    });

    it('names the migration after its own class', () => {
      expect(new CreateScopeCapabilityGrants1791700000000().name).toBe(
        'CreateScopeCapabilityGrants1791700000000',
      );
    });

    // ADR-0007. The rest of the database stores naive TIMESTAMP; every instant
    // in this feature carries its zone.
    it('stores every instant as timestamptz and never as a naive TIMESTAMP', async () => {
      const create = statementFor(await runMigration('up'), 'CREATE TABLE');

      expect(create).toContain('timestamptz');
      expect(create).not.toMatch(/\bTIMESTAMP\b(?!TZ)/i);
    });

    it('reuses the role enum type rather than creating a second one', async () => {
      const queries = await runMigration('up');

      expect(statementFor(queries, 'CREATE TABLE')).toContain(
        '"sto_info_app"."fleet_scope_role_enum"',
      );
      expect(
        queries.some(query =>
          query.includes('CREATE TYPE "sto_info_app"."fleet_scope_role_enum"'),
        ),
      ).toBe(false);
    });

    it('stores the capability code as text rather than an enum type', async () => {
      const create = statementFor(await runMigration('up'), 'CREATE TABLE');

      expect(create).toContain('"capability" varchar(100) NOT NULL');
      expect(create).not.toContain('capability_enum');
    });
  });

  describe('AC1: deny and suspension win', () => {
    it('records an effect rather than expressing removal as a delete', async () => {
      const queries = await runMigration('up');

      expect(statementFor(queries, 'CREATE TYPE')).toContain(
        "AS ENUM ('GRANT', 'DENY')",
      );
      expect(statementFor(queries, 'CREATE TABLE')).toContain(
        '"effect" "sto_info_app"."scope_capability_effect_enum" NOT NULL',
      );
    });

    /**
     * An open GRANT and an open DENY for the same subject and capability would
     * be a stored contradiction. Including the effect in the uniqueness key
     * would permit exactly that, so its absence is the assertion.
     */
    it.each(OPEN_GRANT_INDEXES)(
      '%s does not include the effect in its uniqueness key',
      async name => {
        const statement = statementFor(await runMigration('up'), name);
        const columns = statement.slice(
          statement.indexOf('('),
          statement.indexOf(')'),
        );

        expect(columns).not.toContain('effect');
        expect(columns).toContain('"capability"');
      },
    );
  });

  describe('AC3: a delegation names a role or a person, never both', () => {
    it('requires exactly one subject', async () => {
      expect(statementFor(await runMigration('up'), 'CREATE TABLE')).toContain(
        'CHECK (num_nonnulls("subjectUserId", "subjectRole") = 1)',
      );
    });

    it('allows a scope to be the Community, a Fleet or an Armada, and not two', async () => {
      expect(statementFor(await runMigration('up'), 'CREATE TABLE')).toContain(
        'CHECK (num_nonnulls("fleetId", "armadaId") <= 1)',
      );
    });

    it('refuses an interval that ends before it starts', async () => {
      expect(statementFor(await runMigration('up'), 'CREATE TABLE')).toContain(
        'CHECK ("validTo" IS NULL OR "validTo" > "validFrom")',
      );
    });

    it.each(OPEN_GRANT_INDEXES)(
      '%s constrains only the open, live rows',
      async name => {
        const statement = statementFor(await runMigration('up'), name);

        expect(statement).toContain('CREATE UNIQUE INDEX');
        expect(statement).toContain('"validTo" IS NULL');
        expect(statement).toContain('"deletedAt" IS NULL');
      },
    );

    it('separates the Community-wide indexes from the child-scoped ones', async () => {
      const queries = await runMigration('up');

      for (const name of OPEN_GRANT_INDEXES.slice(0, 2)) {
        const statement = statementFor(queries, name);

        expect(statement).toContain('"fleetId" IS NULL AND "armadaId" IS NULL');
      }

      expect(statementFor(queries, OPEN_GRANT_INDEXES[2])).toContain(
        '"fleetId" IS NOT NULL',
      );
      expect(statementFor(queries, OPEN_GRANT_INDEXES[4])).toContain(
        '"armadaId" IS NOT NULL',
      );
    });
  });

  describe('AC4: a delegation cannot name another Community', () => {
    it.each([
      ['fleet', 'sto_fleet'],
      ['armada', 'sto_armada'],
    ])(
      'references %s by its identifier and its Community together',
      async (child, table) => {
        expect(
          statementFor(await runMigration('up'), 'CREATE TABLE'),
        ).toContain(
          `FOREIGN KEY ("${child}Id", "communityId") REFERENCES "sto_info_app"."${table}"("id", "communityId")`,
        );
      },
    );

    it('carries the Community on every row', async () => {
      expect(statementFor(await runMigration('up'), 'CREATE TABLE')).toContain(
        '"communityId" uuid NOT NULL',
      );
    });

    it('goes with the Community when the Community goes', async () => {
      expect(statementFor(await runMigration('up'), 'CREATE TABLE')).toContain(
        'FOREIGN KEY ("communityId") REFERENCES "sto_info_app"."fleet_community"("id") ON DELETE CASCADE',
      );
    });

    /**
     * The person who made a delegation is kept for the audit trail, so their
     * account closing must not take the record of the delegation with it.
     */
    it('keeps a grant when the account that made it is deleted', async () => {
      const create = statementFor(await runMigration('up'), 'CREATE TABLE');

      expect(create).toContain(
        'FOREIGN KEY ("grantedByUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE SET NULL',
      );
      expect(create).toContain(
        'FOREIGN KEY ("subjectUserId") REFERENCES "sto_info_app"."user"("id") ON DELETE CASCADE',
      );
    });
  });

  describe('indexes for reading', () => {
    it('indexes the columns the policy filters on', async () => {
      const queries = await runMigration('up');

      for (const name of [
        'IDX_scope_capability_grant_subject_user',
        'IDX_scope_capability_grant_community',
      ]) {
        expect(statementFor(queries, name)).toContain(`CREATE INDEX "${name}"`);
      }
    });

    it('creates every index against this table', async () => {
      const queries = await runMigration('up');
      const indexes = queries.filter(query => query.includes(' INDEX "'));

      expect(indexes).toHaveLength(OPEN_GRANT_INDEXES.length + 2);
      for (const statement of indexes) {
        expect(statement).toContain(TABLE);
      }
    });
  });

  describe('rolling back', () => {
    it('removes the table and the type it added, and nothing else', async () => {
      const queries = await runMigration('down');

      expect(queries).toEqual([
        `DROP TABLE "sto_info_app"."scope_capability_grant"`,
        `DROP TYPE "sto_info_app"."scope_capability_effect_enum"`,
      ]);
    });

    it('leaves the role enum type it did not create', async () => {
      const queries = await runMigration('down');

      expect(
        queries.some(query => query.includes('fleet_scope_role_enum')),
      ).toBe(false);
    });
  });
});

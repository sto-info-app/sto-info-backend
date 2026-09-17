import { jest } from '@jest/globals';
import { QueryRunner } from 'typeorm';

import { CreateFleetCommunityDomainTables1791600000000 } from '../1791600000000-CreateFleetCommunityDomainTables';

/**
 * Migrations are excluded from coverage and run against a real database only in
 * rehearsal, so this spec asserts the SQL the migration emits.
 *
 * It is deliberately not a transcription of the migration. Every assertion here
 * corresponds to something FC-004's acceptance criteria require, or to a
 * property that would fail silently if it regressed — a partial unique index
 * quietly becoming a full one, a `timestamptz` column reverting to the
 * database's usual `TIMESTAMP`, or a composite foreign key losing its second
 * column and letting a cross-community reference through.
 */
describe('CreateFleetCommunityDomainTables1791600000000', () => {
  const TABLES = [
    'fleet_community',
    'sto_fleet',
    'sto_armada',
    'fleet_name_alias',
    'armada_fleet_membership',
    'community_subscription',
    'scope_membership',
    'scope_role_assignment',
    'character_fleet_membership',
  ];

  const ENUM_TYPES = [
    'fleet_scope_status_enum',
    'fleet_recruitment_state_enum',
    'fleet_audience_enum',
    'armada_position_enum',
    'armada_membership_source_enum',
    'scope_membership_status_enum',
    'fleet_scope_role_enum',
    'character_fleet_membership_source_enum',
  ];

  const runMigration = async (direction: 'up' | 'down'): Promise<string[]> => {
    const migration = new CreateFleetCommunityDomainTables1791600000000();
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

  const statementFor = (queries: string[], fragment: string): string => {
    const found = queries.find(query => query.includes(fragment));

    if (found === undefined) {
      throw new Error(`No statement contains: ${fragment}`);
    }

    return found;
  };

  it('creates every domain table', async () => {
    const queries = await runMigration('up');

    for (const table of TABLES) {
      expect(
        positionOf(queries, `CREATE TABLE "sto_info_app"."${table}"`),
      ).toBeGreaterThan(-1);
    }
  });

  // A column cannot name a type that does not exist yet.
  it('creates every enum type before the first table', async () => {
    const queries = await runMigration('up');
    const firstTable = positionOf(queries, 'CREATE TABLE');

    for (const type of ENUM_TYPES) {
      const created = positionOf(
        queries,
        `CREATE TYPE "sto_info_app"."${type}"`,
      );

      expect(created).toBeGreaterThan(-1);
      expect(created).toBeLessThan(firstTable);
    }
  });

  // A child table cannot reference a parent that has not been created.
  it('creates each table before the ones referencing it', async () => {
    const queries = await runMigration('up');
    const at = (table: string): number =>
      positionOf(queries, `CREATE TABLE "sto_info_app"."${table}"`);

    expect(at('fleet_community')).toBeLessThan(at('sto_fleet'));
    expect(at('fleet_community')).toBeLessThan(at('sto_armada'));
    expect(at('sto_fleet')).toBeLessThan(at('fleet_name_alias'));
    expect(at('sto_armada')).toBeLessThan(at('armada_fleet_membership'));
    expect(at('sto_fleet')).toBeLessThan(at('armada_fleet_membership'));
    expect(at('sto_fleet')).toBeLessThan(at('scope_membership'));
    expect(at('sto_armada')).toBeLessThan(at('scope_role_assignment'));
    expect(at('sto_fleet')).toBeLessThan(at('character_fleet_membership'));
  });

  // ADR-0007. The rest of this database uses TIMESTAMP, so a copy-paste from an
  // older migration is the realistic way this regresses.
  it('stores every instant as timestamptz and never as a naive TIMESTAMP', async () => {
    const queries = await runMigration('up');
    const creates = queries.filter(query => query.includes('CREATE TABLE'));

    expect(creates).toHaveLength(TABLES.length);

    for (const create of creates) {
      expect(create).toContain('timestamptz');
      expect(create).not.toMatch(/\bTIMESTAMP\b(?!TZ)/i);
    }
  });

  describe('acceptance criterion 1 — duplicates coexist, scoped URLs do not', () => {
    it('places no unique constraint on a Fleet game name', async () => {
      const queries = await runMigration('up');

      const nameIndex = statementFor(queries, 'IDX_sto_fleet_platform_name');

      expect(nameIndex).not.toContain('UNIQUE');
      // Neither a table constraint nor a separate unique index may key on the
      // game name: two Communities each holding a record for the same in-game
      // Fleet is the expected case, not a conflict.
      expect(
        queries.some(query => query.includes('UNIQUE ("exactGameName')),
      ).toBe(false);
      expect(
        queries.some(
          query =>
            query.includes('CREATE UNIQUE INDEX') &&
            query.includes('"exactGameName'),
        ),
      ).toBe(false);
    });

    it('makes the Community slug unique only among live rows', async () => {
      const queries = await runMigration('up');

      const index = statementFor(queries, 'UX_fleet_community_slug');

      expect(index).toContain('CREATE UNIQUE INDEX');
      expect(index).toContain('WHERE "deletedAt" IS NULL');
    });

    it('scopes the Fleet slug to its Community and skips unregistered Fleets', async () => {
      const queries = await runMigration('up');

      const index = statementFor(queries, 'UX_sto_fleet_community_slug');

      expect(index).toContain('("communityId", "slug")');
      expect(index).toContain('"communityId" IS NOT NULL');
    });
  });

  describe('acceptance criterion 2 — one current record under concurrent writes', () => {
    it('allows one open personal membership per Character', async () => {
      const queries = await runMigration('up');

      const index = statementFor(queries, 'UX_character_fleet_membership_open');

      expect(index).toContain('CREATE UNIQUE INDEX');
      expect(index).toContain('("characterId")');
      expect(index).toContain(
        'WHERE "validTo" IS NULL AND "deletedAt" IS NULL',
      );
    });

    it('allows one open Armada association per Fleet', async () => {
      const queries = await runMigration('up');

      const index = statementFor(
        queries,
        'UX_armada_fleet_membership_open_fleet',
      );

      expect(index).toContain('CREATE UNIQUE INDEX');
      expect(index).toContain('("fleetId")');
      expect(index).toContain(
        'WHERE "validTo" IS NULL AND "deletedAt" IS NULL',
      );
    });

    it('allows one open Alpha per Armada', async () => {
      const queries = await runMigration('up');

      const index = statementFor(
        queries,
        'UX_armada_fleet_membership_open_alpha',
      );

      expect(index).toContain('("armadaId")');
      expect(index).toContain(`"position" = 'ALPHA'`);
    });

    it('requires a parent for a Beta or Gamma and forbids one for an Alpha', async () => {
      const queries = await runMigration('up');

      const create = statementFor(
        queries,
        'CREATE TABLE "sto_info_app"."armada_fleet_membership"',
      );

      expect(create).toContain('CHK_armada_fleet_membership_parent');
      expect(create).toContain(
        `("position" = 'ALPHA' AND "parentMembershipId" IS NULL)`,
      );
      expect(create).toContain(
        `("position" <> 'ALPHA' AND "parentMembershipId" IS NOT NULL)`,
      );
    });
  });

  describe('acceptance criterion 3 — history survives transfer and closure', () => {
    it('gives a Fleet a nullable Community so it can exist unregistered', async () => {
      const queries = await runMigration('up');

      const create = statementFor(
        queries,
        'CREATE TABLE "sto_info_app"."sto_fleet"',
      );

      expect(create).toContain('"communityId" uuid,');
      expect(create).not.toContain('"communityId" uuid NOT NULL');
    });

    it('closes scopes with a status and a date rather than deleting them', async () => {
      const queries = await runMigration('up');

      for (const table of ['fleet_community', 'sto_fleet', 'sto_armada']) {
        const create = statementFor(
          queries,
          `CREATE TABLE "sto_info_app"."${table}"`,
        );

        expect(create).toContain('"closedAt" timestamptz');
        expect(create).toContain('fleet_scope_status_enum');
        expect(create).toContain('"deletedAt" timestamptz');
      }
    });

    // Hard-deleting the account behind a live Community, or a Fleet somebody has
    // personal history against, must fail rather than cascade.
    it('protects owned scopes and personal history with RESTRICT', async () => {
      const queries = await runMigration('up');

      expect(statementFor(queries, 'FK_fleet_community_owner')).toContain(
        'ON DELETE RESTRICT',
      );
      expect(
        statementFor(queries, 'FK_character_fleet_membership_fleet'),
      ).toContain('ON DELETE RESTRICT');
    });

    it('keeps closed intervals valid and refuses inverted ones', async () => {
      const queries = await runMigration('up');

      for (const constraint of [
        'CHK_fleet_name_alias_interval',
        'CHK_armada_fleet_membership_interval',
        'CHK_scope_role_assignment_interval',
        'CHK_character_fleet_membership_interval',
      ]) {
        expect(statementFor(queries, constraint)).toContain(
          '"validTo" IS NULL OR "validTo" > "validFrom"',
        );
      }
    });
  });

  describe('acceptance criterion 4 — cross-community references cannot be made', () => {
    it.each([
      ['FK_armada_fleet_membership_fleet', 'sto_fleet'],
      ['FK_armada_fleet_membership_armada', 'sto_armada'],
      ['FK_scope_membership_fleet', 'sto_fleet'],
      ['FK_scope_membership_armada', 'sto_armada'],
      ['FK_scope_role_assignment_fleet', 'sto_fleet'],
      ['FK_scope_role_assignment_armada', 'sto_armada'],
    ])('%s is composite against %s (id, communityId)', async (fk, parent) => {
      const queries = await runMigration('up');

      const create = statementFor(queries, fk);
      const column = parent === 'sto_fleet' ? 'fleetId' : 'armadaId';

      expect(create).toContain(
        `CONSTRAINT "${fk}" FOREIGN KEY ("${column}", "communityId") ` +
          `REFERENCES "sto_info_app"."${parent}"("id", "communityId")`,
      );
    });

    it.each([
      ['sto_fleet', 'UQ_sto_fleet_id_community'],
      ['sto_armada', 'UQ_sto_armada_id_community'],
    ])(
      '%s exposes (id, communityId) for those keys to reference',
      async (table, constraint) => {
        const queries = await runMigration('up');

        expect(
          statementFor(queries, `CREATE TABLE "sto_info_app"."${table}"`),
        ).toContain(`CONSTRAINT "${constraint}" UNIQUE ("id", "communityId")`);
      },
    );

    // Typed columns plus a check, rather than an object ID and a type string,
    // so an unchecked arbitrary ID cannot reach the table — plan section 4.1.
    it.each(['scope_membership', 'scope_role_assignment'])(
      '%s types its scope columns and allows at most one',
      async table => {
        const queries = await runMigration('up');

        const create = statementFor(
          queries,
          `CREATE TABLE "sto_info_app"."${table}"`,
        );

        expect(create).toContain('"communityId" uuid NOT NULL');
        expect(create).toContain('"fleetId" uuid,');
        expect(create).toContain('"armadaId" uuid,');
        expect(create).toContain(
          'CHECK (num_nonnulls("fleetId", "armadaId") <= 1)',
        );
      },
    );
  });

  // Case-insensitive slug lookup is a plain index hit only if what is stored is
  // already lowercase.
  it.each(['fleet_community', 'sto_fleet', 'sto_armada'])(
    '%s refuses a slug that is not already lowercase',
    async table => {
      const queries = await runMigration('up');

      expect(
        statementFor(queries, `CREATE TABLE "sto_info_app"."${table}"`),
      ).toContain('CHECK ("slug" = lower("slug"))');
    },
  );

  // PostgreSQL does not index a foreign key for you.
  it.each([
    'IDX_fleet_community_owner',
    'IDX_sto_fleet_community',
    'IDX_community_subscription_user',
    'IDX_armada_fleet_membership_parent',
  ])('indexes the %s foreign key explicitly', async index => {
    const queries = await runMigration('up');

    expect(positionOf(queries, index)).toBeGreaterThan(-1);
  });

  it('gives following a Community no access columns at all', async () => {
    const queries = await runMigration('up');

    const create = statementFor(
      queries,
      'CREATE TABLE "sto_info_app"."community_subscription"',
    );

    // ADR-0002: following is not access. If a role or status column ever
    // appears here, the separation has been lost.
    expect(create).not.toContain('role');
    expect(create).not.toContain('status');
    expect(create).toContain('"joinedAt"');
    expect(create).toContain('"leftAt"');
  });

  describe('down', () => {
    it('drops every table and enum type it created', async () => {
      const queries = await runMigration('down');

      for (const table of TABLES) {
        expect(
          positionOf(queries, `DROP TABLE "sto_info_app"."${table}"`),
        ).toBeGreaterThan(-1);
      }
      for (const type of ENUM_TYPES) {
        expect(
          positionOf(queries, `DROP TYPE "sto_info_app"."${type}"`),
        ).toBeGreaterThan(-1);
      }
    });

    // A referenced table cannot be dropped while a child still references it,
    // and a type cannot be dropped while a column still uses it.
    it('drops children before parents, and every table before any type', async () => {
      const queries = await runMigration('down');
      const at = (table: string): number =>
        positionOf(queries, `DROP TABLE "sto_info_app"."${table}"`);

      expect(at('character_fleet_membership')).toBeLessThan(at('sto_fleet'));
      expect(at('armada_fleet_membership')).toBeLessThan(at('sto_armada'));
      expect(at('armada_fleet_membership')).toBeLessThan(at('sto_fleet'));
      expect(at('scope_membership')).toBeLessThan(at('sto_fleet'));
      expect(at('scope_role_assignment')).toBeLessThan(at('sto_armada'));
      expect(at('fleet_name_alias')).toBeLessThan(at('sto_fleet'));
      expect(at('sto_fleet')).toBeLessThan(at('fleet_community'));
      expect(at('sto_armada')).toBeLessThan(at('fleet_community'));
      expect(at('community_subscription')).toBeLessThan(at('fleet_community'));

      const lastTable = Math.max(...TABLES.map(at));
      const firstType = queries.findIndex(query => query.includes('DROP TYPE'));

      expect(lastTable).toBeLessThan(firstType);
    });

    it('is the exact inverse of up, table for table and type for type', async () => {
      const up = await runMigration('up');
      const down = await runMigration('down');

      const created = up
        .filter(query => query.startsWith('CREATE TABLE'))
        .map(query => query.split('"')[3]);
      const dropped = down
        .filter(query => query.startsWith('DROP TABLE'))
        .map(query => query.split('"')[3]);

      expect([...dropped].sort()).toEqual([...created].sort());
      expect(dropped).toEqual([...created].reverse());
    });
  });
});

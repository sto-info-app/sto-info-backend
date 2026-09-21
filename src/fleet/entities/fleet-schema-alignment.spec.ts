import { jest } from '@jest/globals';
import { getMetadataArgsStorage, QueryRunner } from 'typeorm';

import { CreateFleetCommunityDomainTables1791600000000 } from '../../database/migrations/1791600000000-CreateFleetCommunityDomainTables';
import { CreateScopeCapabilityGrants1791700000000 } from '../../database/migrations/1791700000000-CreateScopeCapabilityGrants';
import { ScopeSlugsByPlatform1792700000000 } from '../../database/migrations/1792700000000-ScopeSlugsByPlatform';
import { ArmadaFleetMembershipEntity } from './armada-fleet-membership.entity';
import { CharacterFleetMembershipEntity } from './character-fleet-membership.entity';
import { CommunitySubscriptionEntity } from './community-subscription.entity';
import { FleetCommunityEntity } from './fleet-community.entity';
import { FleetNameAliasEntity } from './fleet-name-alias.entity';
import { ScopeCapabilityGrantEntity } from './scope-capability-grant.entity';
import { ScopeMembershipEntity } from './scope-membership.entity';
import { ScopeRoleAssignmentEntity } from './scope-role-assignment.entity';
import { StoArmadaEntity } from './sto-armada.entity';
import { StoFleetEntity } from './sto-fleet.entity';

/**
 * Holds the entities and the hand-written migration to each other.
 *
 * The migration is raw SQL, so nothing generates one from the other and
 * nothing notices when they part company. A column added to an entity but not
 * to the migration fails at runtime with a message about a missing column, on
 * whichever query happens to touch it first — which may be a long way from the
 * change that caused it. Comparing the two here turns that into a failing test
 * in the same commit.
 *
 * This is not a substitute for rehearsing the migration against PostgreSQL. It
 * proves the two descriptions agree, not that either one is accepted.
 */
describe('Fleet schema alignment', () => {
  const ENTITIES = [
    FleetCommunityEntity,
    StoFleetEntity,
    StoArmadaEntity,
    FleetNameAliasEntity,
    ArmadaFleetMembershipEntity,
    CommunitySubscriptionEntity,
    ScopeMembershipEntity,
    ScopeRoleAssignmentEntity,
    ScopeCapabilityGrantEntity,
    CharacterFleetMembershipEntity,
  ];

  type EntityClass = (typeof ENTITIES)[number];

  let statements: string[];

  // Both migrations are replayed into one transcript. The feature's schema is
  // spread over more than one file and will spread further; comparing the
  // entities against only the first one would quietly stop checking every table
  // added after it.
  beforeAll(async () => {
    const captured: string[] = [];
    const queryRunner = {
      query: jest.fn((sql: string) => {
        captured.push(sql);

        return Promise.resolve();
      }),
    } as unknown as QueryRunner;

    await new CreateFleetCommunityDomainTables1791600000000().up(queryRunner);
    await new CreateScopeCapabilityGrants1791700000000().up(queryRunner);
    await new ScopeSlugsByPlatform1792700000000().up(queryRunner);
    statements = captured;
  });

  const tableNameOf = (entity: EntityClass): string => {
    const table = getMetadataArgsStorage().tables.find(
      candidate => candidate.target === entity,
    );

    if (table?.name === undefined) {
      throw new Error(`No @Entity name for ${entity.name}`);
    }

    return table.name;
  };

  const createTableFor = (entity: EntityClass): string => {
    const needle = `CREATE TABLE "sto_info_app"."${tableNameOf(entity)}"`;
    const found = statements.find(statement => statement.includes(needle));

    if (found === undefined) {
      throw new Error(`Migration does not create ${tableNameOf(entity)}`);
    }

    return found;
  };

  /** Column names declared on the entity, including the date columns. */
  const entityColumns = (entity: EntityClass): string[] =>
    getMetadataArgsStorage()
      .columns.filter(column => column.target === entity)
      .map(column => column.options.name ?? column.propertyName);

  /** Column names in the migration, ignoring the CONSTRAINT lines. */
  const migrationColumns = (entity: EntityClass): string[] =>
    createTableFor(entity)
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('"'))
      .map(line => line.slice(1, line.indexOf('"', 1)));

  it.each(ENTITIES.map(entity => [entity.name, entity] as const))(
    '%s declares exactly the columns the migration creates',
    (_name, entity) => {
      expect([...migrationColumns(entity)].sort()).toEqual(
        [...entityColumns(entity)].sort(),
      );
    },
  );

  // ADR-0007 again, from the other side: the entity has to ask for timestamptz
  // too, or TypeORM's default lands a plain timestamp in any future synchronise
  // or generated migration.
  it.each(ENTITIES.map(entity => [entity.name, entity] as const))(
    '%s types every instant column as timestamptz in both places',
    (_name, entity) => {
      const declared = getMetadataArgsStorage()
        .columns.filter(column => column.target === entity)
        .filter(column => column.options.type === 'timestamptz')
        .map(column => column.options.name ?? column.propertyName);

      const sqlLines = createTableFor(entity)
        .split('\n')
        .map(line => line.trim());

      expect(declared.length).toBeGreaterThan(0);
      for (const column of declared) {
        expect(sqlLines).toContainEqual(
          expect.stringMatching(
            new RegExp(`^"${column}" timestamptz(?![a-z])`),
          ),
        );
      }

      // Nothing may be left on the driver default.
      const dateColumns = getMetadataArgsStorage()
        .columns.filter(column => column.target === entity)
        .filter(column =>
          ['createDate', 'updateDate', 'deleteDate'].includes(
            column.mode ?? '',
          ),
        );

      for (const column of dateColumns) {
        expect(column.options.type).toBe('timestamptz');
      }
    },
  );

  /**
   * The statement that describes each index at the end of the transcript.
   *
   * A later migration may drop an index and recreate it under the same name
   * with a wider key: ADR-0022 does exactly that to both scoped slug indexes,
   * because the platform became part of the canonical URL. Two statements then
   * carry one name and only the last describes the database, so every
   * comparison below is against that one rather than the first one found.
   */
  const effectiveIndexStatements = (): Map<string, string> => {
    const tables = ENTITIES.map(tableNameOf);
    const effective = new Map<string, string>();

    for (const statement of statements) {
      const isIndex =
        statement.startsWith('CREATE') && statement.includes(' INDEX "');
      const onOurTable = tables.some(table =>
        statement.includes(`"sto_info_app"."${table}" (`),
      );

      if (isIndex && onOurTable) {
        effective.set(statement.split('"')[1], statement);
      }
    }

    return effective;
  };

  /**
   * The key columns of an index statement, in the order they are indexed in.
   *
   * Reads only the parenthesised key, because a partial index's `WHERE` clause
   * quotes column names too and they are not part of the key.
   *
   * @param statement - The `CREATE INDEX` statement.
   * @returns The column names.
   */
  const indexedColumns = (statement: string): string[] => {
    const open = statement.indexOf('" (') + 2;
    const key = statement.slice(open + 1, statement.indexOf(')', open));

    return [...key.matchAll(/"([^"]+)"/g)].map(match => match[1]);
  };

  const declaredIndexes = (): ReturnType<
    typeof getMetadataArgsStorage
  >['indices'] =>
    getMetadataArgsStorage().indices.filter(index =>
      ENTITIES.includes(index.target as EntityClass),
    );

  it('declares exactly the indexes the migration creates', () => {
    const declared = declaredIndexes().map(index => index.name!);
    const created = [...effectiveIndexStatements().keys()];

    expect(created.length).toBeGreaterThan(0);
    expect([...declared].sort()).toEqual([...created].sort());
  });

  it('indexes the same columns, in the same order, in both places', () => {
    const effective = effectiveIndexStatements();
    const declared = declaredIndexes();

    expect(declared.length).toBeGreaterThan(0);

    for (const index of declared) {
      const statement = effective.get(index.name!);

      expect(statement).toBeDefined();
      expect(indexedColumns(statement!)).toEqual(index.columns as string[]);
    }
  });

  it('matches the migration on which indexes are unique', () => {
    const effective = effectiveIndexStatements();
    const declared = declaredIndexes();

    expect(declared.length).toBeGreaterThan(0);

    for (const index of declared) {
      const keyword = index.unique ? 'CREATE UNIQUE INDEX' : 'CREATE INDEX';
      const statement = effective.get(index.name!);

      expect(statement).toBeDefined();
      expect(statement!.startsWith(`${keyword} "${index.name!}"`)).toBe(true);
      expect(
        statement!.includes(
          `"sto_info_app"."${tableNameOf(index.target as EntityClass)}"`,
        ),
      ).toBe(true);
    }
  });

  it('declares a partial index wherever the migration uses one', () => {
    const effective = effectiveIndexStatements();

    for (const index of declaredIndexes()) {
      const statement = effective.get(index.name!);

      expect(statement).toBeDefined();
      expect(statement!.includes(' WHERE ')).toBe(index.where !== undefined);
    }
  });
});

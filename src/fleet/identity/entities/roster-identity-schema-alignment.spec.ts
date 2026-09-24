import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { getMetadataArgsStorage, QueryRunner } from 'typeorm';

import { CreateRosterIdentities1794100000000 } from '../../../database/migrations/1794100000000-CreateRosterIdentities';
import { RosterIdentityAliasEntity } from './roster-identity-alias.entity';
import { RosterIdentityCandidateLinkEntity } from './roster-identity-candidate-link.entity';
import { RosterIdentityCandidateEntity } from './roster-identity-candidate.entity';
import { RosterIdentityDecisionEntity } from './roster-identity-decision.entity';
import { RosterIdentityEntity } from './roster-identity.entity';

/**
 * Runs a migration step and keeps every statement it issues.
 *
 * @param step - The step to run.
 * @returns What it sent to the database, in order.
 */
async function capture(
  step: (queryRunner: QueryRunner) => Promise<void>,
): Promise<string[]> {
  const captured: string[] = [];
  const queryRunner = {
    query: jest.fn((sql: string) => {
      captured.push(sql);

      return Promise.resolve();
    }),
  } as unknown as QueryRunner;

  await step(queryRunner);

  return captured;
}

/**
 * Holds the five identity entities and their hand-written migration to each
 * other, as the import and conflict alignment specs do for theirs. It proves
 * the two descriptions agree, not that PostgreSQL accepts either.
 */
describe('Roster identity schema alignment', () => {
  const migration = new CreateRosterIdentities1794100000000();
  let statements: string[];

  beforeAll(async () => {
    statements = await capture(queryRunner => migration.up(queryRunner));
  });

  const tables: ReadonlyArray<[string, object]> = [
    ['fleet_roster_identity', RosterIdentityEntity],
    ['fleet_roster_identity_alias', RosterIdentityAliasEntity],
    ['fleet_roster_identity_candidate', RosterIdentityCandidateEntity],
    ['fleet_roster_identity_candidate_link', RosterIdentityCandidateLinkEntity],
    ['fleet_roster_identity_decision', RosterIdentityDecisionEntity],
  ];

  const sqlLines = (table: string): string[] => {
    const found = statements.find(statement =>
      statement.includes(`CREATE TABLE "sto_info_app"."${table}" (`),
    );

    if (found === undefined) {
      throw new Error(`Migration does not create ${table}`);
    }

    return found.split('\n').map(line => line.trim());
  };

  const columnsOf = (target: object): string[] =>
    getMetadataArgsStorage()
      .columns.filter(column => column.target === target)
      .map(column => column.options.name ?? column.propertyName);

  it.each(tables)(
    'declares exactly the columns the migration creates for %s',
    (table, target) => {
      const migrationColumns = sqlLines(table)
        .filter(line => line.startsWith('"'))
        .map(line => line.slice(1, line.indexOf('"', 1)));

      expect([...migrationColumns].sort()).toEqual(
        [...columnsOf(target)].sort(),
      );
    },
  );

  // ADR-0007 from the other side: the entity has to ask for timestamptz too.
  it.each(tables)(
    'types every instant column of %s as timestamptz in both places',
    (table, target) => {
      const declared = getMetadataArgsStorage()
        .columns.filter(column => column.target === target)
        .filter(column => column.options.type === 'timestamptz')
        .map(column => column.options.name ?? column.propertyName);

      for (const column of declared) {
        expect(sqlLines(table)).toContainEqual(
          expect.stringMatching(
            new RegExp(`^"${column}" timestamptz(?![a-z])`),
          ),
        );
      }
    },
  );

  it.each([
    [
      'UX_roster_identity_alias_key',
      RosterIdentityAliasEntity,
      ['fleetId', 'characterNameNormalised', 'accountHandleNormalised'],
      undefined,
      `CREATE UNIQUE INDEX "UX_roster_identity_alias_key" ON "sto_info_app"."fleet_roster_identity_alias" ("fleetId", "characterNameNormalised", "accountHandleNormalised")`,
    ],
    [
      'UX_roster_identity_candidate_character',
      RosterIdentityCandidateEntity,
      ['fleetId', 'fromAliasId', 'toAliasId'],
      `"kind" = 'CHARACTER_RENAME'`,
      `CREATE UNIQUE INDEX "UX_roster_identity_candidate_character" ON "sto_info_app"."fleet_roster_identity_candidate" ("fleetId", "fromAliasId", "toAliasId") WHERE "kind" = 'CHARACTER_RENAME'`,
    ],
    [
      'UX_roster_identity_candidate_account',
      RosterIdentityCandidateEntity,
      ['fleetId', 'fromHandleNormalised', 'toHandleNormalised'],
      `"kind" = 'ACCOUNT_RENAME'`,
      `CREATE UNIQUE INDEX "UX_roster_identity_candidate_account" ON "sto_info_app"."fleet_roster_identity_candidate" ("fleetId", "fromHandleNormalised", "toHandleNormalised") WHERE "kind" = 'ACCOUNT_RENAME'`,
    ],
    [
      'UX_roster_identity_decision_revision',
      RosterIdentityDecisionEntity,
      ['candidateId', 'revision'],
      undefined,
      `CREATE UNIQUE INDEX "UX_roster_identity_decision_revision" ON "sto_info_app"."fleet_roster_identity_decision" ("candidateId", "revision")`,
    ],
  ])('declares %s in both places', (name, target, columns, where, sql) => {
    const index = getMetadataArgsStorage().indices.find(
      candidate => candidate.name === name,
    );

    expect(index).toEqual(
      expect.objectContaining({ target, columns, unique: true }),
    );
    expect(index?.where).toBe(where);
    expect(statements).toContainEqual(sql);
  });

  it.each([
    ['IDX_roster_identity_alias_identity', RosterIdentityAliasEntity],
    [
      'IDX_roster_identity_candidate_fleet_state',
      RosterIdentityCandidateEntity,
    ],
    ['IDX_roster_identity_candidate_earlier', RosterIdentityCandidateEntity],
    ['IDX_roster_identity_candidate_later', RosterIdentityCandidateEntity],
    [
      'IDX_roster_identity_candidate_link_from',
      RosterIdentityCandidateLinkEntity,
    ],
    [
      'IDX_roster_identity_candidate_link_to',
      RosterIdentityCandidateLinkEntity,
    ],
    [
      'IDX_roster_identity_decision_fleet_decided',
      RosterIdentityDecisionEntity,
    ],
    ['IDX_roster_identity_decision_actor', RosterIdentityDecisionEntity],
  ])('declares the plain index %s in both places', (name, target) => {
    const index = getMetadataArgsStorage().indices.find(
      candidate => candidate.name === name,
    );

    expect(index).toEqual(expect.objectContaining({ target }));
    expect(statements).toContainEqual(
      expect.stringContaining(`CREATE INDEX "${name}" ON`),
    );
  });

  it.each([
    ['UQ_roster_identity_tenancy', RosterIdentityEntity],
    ['UQ_roster_identity_alias_tenancy', RosterIdentityAliasEntity],
    ['UQ_roster_identity_alias_origin', RosterIdentityAliasEntity],
    ['UQ_roster_identity_candidate_link_to', RosterIdentityCandidateLinkEntity],
  ])('declares the unique constraint %s in both places', (name, target) => {
    const unique = getMetadataArgsStorage().uniques.find(
      candidate => candidate.name === name,
    );

    expect(unique).toEqual(expect.objectContaining({ target }));
    expect(statements.join('\n')).toContain(`CONSTRAINT "${name}" UNIQUE`);
  });

  // An unresolvable candidate is visible and undecidable, in the data as
  // well as at the route.
  it('keeps a candidate with collision reasons open', () => {
    expect(sqlLines('fleet_roster_identity_candidate')).toContainEqual(
      `CONSTRAINT "CHK_roster_identity_candidate_collision_open" CHECK (cardinality("collisionReasons") = 0 OR "state" = 'OPEN'),`,
    );
  });

  it('makes a decision write-once', () => {
    expect(statements).toContainEqual(
      expect.stringContaining(
        `CREATE TRIGGER "TR_roster_identity_decision_guard" BEFORE UPDATE ON "sto_info_app"."fleet_roster_identity_decision"`,
      ),
    );
  });

  it('drops everything it created when reverted', async () => {
    const reverted = (
      await capture(queryRunner => migration.down(queryRunner))
    ).join('\n');

    for (const [table] of tables) {
      expect(reverted).toContain(`DROP TABLE "sto_info_app"."${table}"`);
    }

    for (const type of [
      'roster_identity_candidate_kind_enum',
      'roster_identity_candidate_state_enum',
      'roster_identity_confidence_enum',
      'roster_identity_collision_reason_enum',
      'roster_identity_decision_action_enum',
    ]) {
      expect(reverted).toContain(`DROP TYPE "sto_info_app"."${type}"`);
    }

    expect(reverted).toContain(
      'DROP FUNCTION IF EXISTS "sto_info_app"."roster_identity_decision_guard"()',
    );
  });
});

import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { getMetadataArgsStorage, QueryRunner } from 'typeorm';

import { CreateArmadaTopology1795500000000 } from '../../../database/migrations/1795500000000-CreateArmadaTopology';
import { ArmadaActionEntity } from './armada-action.entity';
import { ArmadaJoinRequestEntity } from './armada-join-request.entity';

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
 * Holds the Armada request and history entities and their hand-written
 * migration to each other (FC-024, FC-025). It proves the two descriptions
 * agree, not that PostgreSQL accepts either: the constraints and triggers
 * were rehearsed against the local database, 29 cases each refused or
 * allowed as intended.
 */
describe('Armada schema alignment', () => {
  const migration = new CreateArmadaTopology1795500000000();
  let statements: string[];

  beforeAll(async () => {
    statements = await capture(queryRunner => migration.up(queryRunner));
  });

  const createTable = (table: string): string => {
    const found = statements.find(statement =>
      statement.includes(`CREATE TABLE "sto_info_app"."${table}" (`),
    );

    if (found === undefined) {
      throw new Error(`Migration does not create ${table}`);
    }

    return found;
  };

  const sqlLines = (table: string): string[] =>
    createTable(table)
      .split('\n')
      .map(line => line.trim());

  const declared = (entity: abstract new () => unknown) =>
    getMetadataArgsStorage().columns.filter(column => column.target === entity);

  const TABLES: [string, abstract new () => unknown][] = [
    ['armada_join_request', ArmadaJoinRequestEntity],
    ['armada_action', ArmadaActionEntity],
  ];

  it.each(TABLES)(
    'declares exactly the columns %s is created with',
    (table, entity) => {
      const migrationColumns = sqlLines(table)
        .filter(line => line.startsWith('"'))
        .map(line => line.slice(1, line.indexOf('"', 1)));

      expect([...migrationColumns].sort()).toEqual(
        declared(entity)
          .map(column => column.options.name ?? column.propertyName)
          .sort(),
      );
    },
  );

  it.each(TABLES)(
    'types every instant column of %s as timestamptz in both places',
    (table, entity) => {
      const instants = declared(entity)
        .filter(column => column.options.type === 'timestamptz')
        .map(column => column.propertyName);

      expect(instants).toContain('createdAt');

      for (const column of instants) {
        expect(sqlLines(table)).toContainEqual(
          expect.stringMatching(
            new RegExp(`^"${column}" timestamptz(?![a-z])`),
          ),
        );
      }
    },
  );

  it('lets a Beta report to the Alpha slot, and only a Gamma name a parent', () => {
    expect(statements).toContainEqual(
      `ALTER TABLE "sto_info_app"."armada_fleet_membership" ADD CONSTRAINT "CHK_armada_fleet_membership_parent" CHECK (("position" = 'GAMMA') = ("parentMembershipId" IS NOT NULL))`,
    );
  });

  it('allows one open request per Fleet', () => {
    expect(statements).toContainEqual(
      `CREATE UNIQUE INDEX "UX_armada_join_request_open" ON "sto_info_app"."armada_join_request" ("fleetId") WHERE "status" = 'PENDING'`,
    );
  });

  it('requires a reason to reject, to move, to leave and to remove', () => {
    expect(createTable('armada_join_request')).toContain(
      `CHECK ("status" <> 'REJECTED' OR ("reason" IS NOT NULL AND length(btrim("reason")) > 0))`,
    );
    expect(createTable('armada_action')).toContain(
      `CHECK ("action" NOT IN ('MOVED', 'LEFT', 'REMOVED') OR ("reason" IS NOT NULL AND length(btrim("reason")) > 0))`,
    );
  });

  it('guards placements, requests and history against change', () => {
    for (const table of [
      'armada_fleet_membership',
      'armada_join_request',
      'armada_action',
    ]) {
      expect(statements).toContainEqual(
        expect.stringContaining(
          `CREATE TRIGGER "TR_${table}_guard" BEFORE UPDATE`,
        ),
      );
    }
  });

  it('puts back what it changed when reverted', async () => {
    const reverted = (
      await capture(queryRunner => migration.down(queryRunner))
    ).join('\n');

    for (const expected of [
      'DROP TABLE "sto_info_app"."armada_action"',
      'DROP TABLE "sto_info_app"."armada_join_request"',
      'DROP TYPE "sto_info_app"."armada_action_enum"',
      'DROP TYPE "sto_info_app"."armada_join_request_status_enum"',
      'DROP TRIGGER IF EXISTS "TR_armada_fleet_membership_guard"',
      `CHECK (("position" = 'ALPHA' AND "parentMembershipId" IS NULL) OR ("position" <> 'ALPHA' AND "parentMembershipId" IS NOT NULL))`,
      'DROP COLUMN "allegianceFactionId"',
      'DROP COLUMN "armadaId"',
    ]) {
      expect(reverted).toContain(expected);
    }
  });
});

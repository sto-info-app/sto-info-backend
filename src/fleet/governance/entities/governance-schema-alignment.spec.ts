import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { getMetadataArgsStorage, QueryRunner } from 'typeorm';

import { CreateScopeGovernance1795300000000 } from '../../../database/migrations/1795300000000-CreateScopeGovernance';
import { OwnershipTransferEntity } from './ownership-transfer.entity';
import { ScopeGovernanceActionEntity } from './scope-governance-action.entity';

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
 * Holds the governance entities and their hand-written migration to each
 * other. It proves the two descriptions agree, not that PostgreSQL accepts
 * either: the constraints and triggers were rehearsed against the local
 * database, 23 statements each refused or allowed as intended.
 */
describe('Governance schema alignment', () => {
  const migration = new CreateScopeGovernance1795300000000();
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
    ['scope_governance_action', ScopeGovernanceActionEntity],
    ['scope_ownership_transfer', OwnershipTransferEntity],
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

  it('allows one open ownership offer per Community', () => {
    expect(statements).toContainEqual(
      `CREATE UNIQUE INDEX "UX_scope_ownership_transfer_open" ON "sto_info_app"."scope_ownership_transfer" ("communityId") WHERE "status" = 'PENDING'`,
    );
  });

  it('refuses a removal, denial, dispute action or closure without a reason', () => {
    const table = createTable('scope_governance_action');

    expect(table).toContain(
      `CHECK ("action" NOT IN ('ROLE_WITHDRAWN', 'CAPABILITY_DENIED', 'OWNERSHIP_REASSIGNED', 'CLOSED') OR ("reason" IS NOT NULL AND length(btrim("reason")) > 0))`,
    );
    expect(table).toContain(
      `CHECK ("action" <> 'CAPABILITY_CLEARED' OR "clearedEffect" <> 'GRANT' OR ("reason" IS NOT NULL AND length(btrim("reason")) > 0))`,
    );
  });

  it('lets a site administrator only move ownership, cancel an offer or close', () => {
    expect(createTable('scope_governance_action')).toContain(
      `CHECK (NOT "asSiteAdmin" OR "action" IN ('OWNERSHIP_REASSIGNED', 'OWNERSHIP_CANCELLED', 'CLOSED'))`,
    );
  });

  it('keeps an offer answered once, and never offered to its Owner', () => {
    const table = createTable('scope_ownership_transfer');

    expect(table).toContain(
      `CHECK (("status" = 'PENDING') = ("answeredAt" IS NULL))`,
    );
    expect(table).toContain(
      `CHECK ("fromUserId" IS NULL OR "toUserId" IS NULL OR "fromUserId" <> "toUserId")`,
    );
  });

  it('keeps both tables write-once but for a person or offer going', () => {
    const actionGuard = statements.find(statement =>
      statement.includes(
        'FUNCTION "sto_info_app"."scope_governance_action_guard"',
      ),
    );
    const transferGuard = statements.find(statement =>
      statement.includes(
        'FUNCTION "sto_info_app"."scope_ownership_transfer_guard"',
      ),
    );

    expect(actionGuard).toContain(
      `(to_jsonb(NEW) - 'actorUserId' - 'subjectUserId' - 'transferId')`,
    );
    expect(transferGuard).toContain(`IF OLD."status" <> 'PENDING' AND (`);
    for (const table of [
      'scope_governance_action',
      'scope_ownership_transfer',
    ]) {
      expect(statements).toContainEqual(
        expect.stringContaining(
          `CREATE TRIGGER "TR_${table}_guard" BEFORE UPDATE`,
        ),
      );
    }
  });

  it('drops everything it created when reverted', async () => {
    const reverted = (
      await capture(queryRunner => migration.down(queryRunner))
    ).join('\n');

    for (const expected of [
      'DROP TRIGGER IF EXISTS "TR_scope_ownership_transfer_guard"',
      'DROP FUNCTION IF EXISTS "sto_info_app"."scope_ownership_transfer_guard"()',
      'DROP TRIGGER IF EXISTS "TR_scope_governance_action_guard"',
      'DROP FUNCTION IF EXISTS "sto_info_app"."scope_governance_action_guard"()',
      'DROP TABLE "sto_info_app"."scope_governance_action"',
      'DROP TABLE "sto_info_app"."scope_ownership_transfer"',
      'DROP TYPE "sto_info_app"."scope_ownership_transfer_status_enum"',
      'DROP TYPE "sto_info_app"."scope_governance_action_enum"',
    ]) {
      expect(reverted).toContain(expected);
    }
  });
});

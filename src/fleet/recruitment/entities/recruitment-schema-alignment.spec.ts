import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { getMetadataArgsStorage, QueryRunner } from 'typeorm';

import { CreateFleetRecruitment1794900000000 } from '../../../database/migrations/1794900000000-CreateFleetRecruitment';
import { FleetApplicationActionEntity } from './fleet-application-action.entity';
import { FleetApplicationEntity } from './fleet-application.entity';
import { FleetInvitationEntity } from './fleet-invitation.entity';
import { FleetRecruitmentSettingsEntity } from './fleet-recruitment-settings.entity';
import { ScopeMembershipActionEntity } from './scope-membership-action.entity';

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
 * Holds the recruitment entities and their hand-written migration to each
 * other, as the other Fleet alignment specs do for theirs. It proves the two
 * descriptions agree, not that PostgreSQL accepts either: the constraint
 * behaviour was rehearsed against the local database.
 */
describe('Recruitment schema alignment', () => {
  const migration = new CreateFleetRecruitment1794900000000();
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
    ['fleet_recruitment_settings', FleetRecruitmentSettingsEntity],
    ['fleet_invitation', FleetInvitationEntity],
    ['fleet_application', FleetApplicationEntity],
    ['fleet_application_action', FleetApplicationActionEntity],
    ['scope_membership_action', ScopeMembershipActionEntity],
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

  // ADR-0007 from the other side: the entity has to ask for timestamptz too.
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

  it('allows one pending application per Character per Fleet', () => {
    expect(statements).toContainEqual(
      `CREATE UNIQUE INDEX "UX_fleet_application_pending" ON "sto_info_app"."fleet_application" ("fleetId", "characterId") WHERE "status" = 'PENDING'`,
    );
  });

  it('allows one open invitation per user per Fleet', () => {
    expect(statements).toContainEqual(
      `CREATE UNIQUE INDEX "UX_fleet_invitation_open" ON "sto_info_app"."fleet_invitation" ("fleetId", "invitedUserId") WHERE "status" = 'PENDING'`,
    );
  });

  it('refuses a rejection without a reason, in the application and its log', () => {
    expect(createTable('fleet_application')).toContain(
      `CHECK ("status" <> 'REJECTED' OR ("decisionNote" IS NOT NULL AND length(btrim("decisionNote")) > 0))`,
    );
    expect(createTable('fleet_application_action')).toContain(
      `CHECK ("action" <> 'REJECTED' OR ("note" IS NOT NULL AND length(btrim("note")) > 0))`,
    );
  });

  it('refuses a removal without a reason', () => {
    expect(createTable('scope_membership_action')).toContain(
      `CHECK ("action" <> 'REMOVED' OR ("reason" IS NOT NULL AND length(btrim("reason")) > 0))`,
    );
  });

  it('accepts a join and an invitation as they are made', () => {
    const table = createTable('fleet_application');

    expect(table).toContain(
      `CHECK ("route" = 'APPLICATION' OR "status" = 'ACCEPTED')`,
    );
    expect(table).toContain(
      `CHECK (("route" = 'INVITATION') = ("invitationId" IS NOT NULL))`,
    );
  });

  it('keeps each version, action and membership change write-once but for its actor', () => {
    for (const [table, actor] of [
      ['fleet_recruitment_settings', 'createdByUserId'],
      ['fleet_application_action', 'actorUserId'],
      ['scope_membership_action', 'actorUserId'],
    ]) {
      const guard = statements.find(statement =>
        statement.includes(`FUNCTION "sto_info_app"."${table}_guard"`),
      );

      expect(guard).toContain(
        `(to_jsonb(NEW) - '${actor}') IS DISTINCT FROM (to_jsonb(OLD) - '${actor}')`,
      );
      expect(statements).toContainEqual(
        expect.stringContaining(
          `CREATE TRIGGER "TR_${table}_guard" BEFORE UPDATE`,
        ),
      );
    }
  });

  it('never lets an application change what was asked, or a decision change', () => {
    const guard = statements.find(statement =>
      statement.includes('FUNCTION "sto_info_app"."fleet_application_guard"'),
    );

    for (const column of ['answers', 'settingsId', 'characterId', 'route']) {
      expect(guard).toContain(
        `NEW."${column}" IS DISTINCT FROM OLD."${column}"`,
      );
    }
    expect(guard).toContain(`IF OLD."status" <> 'PENDING' AND (`);
  });

  it('links a proposal to the application that raised it', () => {
    expect(statements).toContainEqual(
      `ALTER TABLE "sto_info_app"."character_fleet_proposal" ADD COLUMN "applicationId" uuid`,
    );
  });

  it('drops everything it created when reverted', async () => {
    const reverted = (
      await capture(queryRunner => migration.down(queryRunner))
    ).join('\n');

    for (const expected of [
      'DROP TRIGGER IF EXISTS "TR_fleet_application_guard"',
      'DROP FUNCTION IF EXISTS "sto_info_app"."fleet_application_guard"()',
      'DROP TRIGGER IF EXISTS "TR_scope_membership_action_guard"',
      'DROP TRIGGER IF EXISTS "TR_fleet_application_action_guard"',
      'DROP TRIGGER IF EXISTS "TR_fleet_recruitment_settings_guard"',
      'DROP COLUMN "applicationId"',
      'DROP TABLE "sto_info_app"."scope_membership_action"',
      'DROP TABLE "sto_info_app"."fleet_application_action"',
      'DROP TABLE "sto_info_app"."fleet_application"',
      'DROP TABLE "sto_info_app"."fleet_invitation"',
      'DROP TABLE "sto_info_app"."fleet_recruitment_settings"',
      'DROP TYPE "sto_info_app"."scope_membership_action_enum"',
      'DROP TYPE "sto_info_app"."fleet_invitation_status_enum"',
      'DROP TYPE "sto_info_app"."fleet_application_action_enum"',
      'DROP TYPE "sto_info_app"."fleet_application_status_enum"',
      'DROP TYPE "sto_info_app"."fleet_application_route_enum"',
    ]) {
      expect(reverted).toContain(expected);
    }
  });
});

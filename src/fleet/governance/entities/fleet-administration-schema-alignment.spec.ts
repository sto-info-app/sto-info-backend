import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { getMetadataArgsStorage, QueryRunner } from 'typeorm';

import { AddFleetAdministration1796300000000 } from '../../../database/migrations/1796300000000-AddFleetAdministration';
import { ModerationHoldActionEntity } from '../../chat/holds/moderation-hold-action.entity';
import { ModerationHoldEntity } from '../../chat/holds/moderation-hold.entity';
import {
  ModerationHoldActionKind,
  ModerationHoldKind,
} from '../../chat/holds/moderation-hold.enums';
import { ScopeMembershipActionKind } from '../../recruitment/enums/scope-membership-action-kind.enum';
import { ScopeGovernanceActionKind } from '../enums/scope-governance-action-kind.enum';
import { FleetInvestigationGrantEntity } from './fleet-investigation-grant.entity';

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
 * Holds FC-036's entities and its hand-written migration to each other. It
 * proves the two descriptions agree, not that PostgreSQL accepts either:
 * the migration was applied, reverted and applied again against the local
 * database, and its constraints exercised by a probe.
 */
describe('Fleet administration schema alignment (FC-036)', () => {
  const migration = new AddFleetAdministration1796300000000();
  let up: string[];
  let down: string[];

  beforeAll(async () => {
    up = await capture(queryRunner => migration.up(queryRunner));
    down = await capture(queryRunner => migration.down(queryRunner));
  });

  const table = (name: string): string =>
    up.find(statement =>
      statement.includes(`CREATE TABLE "sto_info_app"."${name}" (`),
    ) as string;

  const declared = (target: unknown) =>
    getMetadataArgsStorage().columns.filter(column => column.target === target);

  describe.each([
    ['moderation_hold', ModerationHoldEntity],
    ['moderation_hold_action', ModerationHoldActionEntity],
    ['fleet_investigation_grant', FleetInvestigationGrantEntity],
  ])('%s', (name, entity) => {
    it('declares exactly the columns the table is created with', () => {
      const columns = table(name)
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('"'))
        .map(line => line.slice(1, line.indexOf('"', 1)));

      // FC-039's migration adds the idempotency key; its spec holds that.
      expect([...columns].sort()).toEqual(
        declared(entity)
          .map(column => column.propertyName)
          .filter(column => column !== 'idempotencyKey')
          .sort(),
      );
    });

    it('types every instant as timestamptz', () => {
      for (const column of declared(entity).filter(
        each => each.options.type === 'timestamptz',
      )) {
        expect(table(name)).toMatch(
          new RegExp(`"${column.propertyName}" timestamptz`),
        );
      }
    });
  });

  it('adds suspension to both logs', () => {
    for (const [type, values] of [
      ['scope_membership_action_enum', ScopeMembershipActionKind],
      ['scope_governance_action_enum', ScopeGovernanceActionKind],
    ] as const) {
      for (const value of ['SUSPENDED', 'REINSTATED']) {
        expect(Object.values(values)).toContain(value);
        expect(up).toContain(
          `ALTER TYPE "sto_info_app"."${type}" ADD VALUE IF NOT EXISTS '${value}'`,
        );
      }
    }
  });

  it('makes the hold types hold every value the code knows', () => {
    expect(up).toContain(
      `CREATE TYPE "sto_info_app"."moderation_hold_kind_enum" AS ENUM (${Object.values(
        ModerationHoldKind,
      )
        .map(value => `'${value}'`)
        .join(', ')})`,
    );
    // FC-037's migration adds the system's two notices; its spec holds that.
    expect(up).toContain(
      `CREATE TYPE "sto_info_app"."moderation_hold_action_kind_enum" AS ENUM (${Object.values(
        ModerationHoldActionKind,
      )
        .filter(
          value =>
            value !== ModerationHoldActionKind.REVIEW_DUE &&
            value !== ModerationHoldActionKind.RELEASE_WARNED,
        )
        .map(value => `'${value}'`)
        .join(', ')})`,
    );
  });

  it('needs a reason to suspend or reinstate, and only a site admin suspends a scope', () => {
    expect(up).toContainEqual(
      expect.stringContaining(
        `ADD CONSTRAINT "CHK_scope_membership_action_removal_reason" CHECK ("action"::text NOT IN ('REMOVED', 'SUSPENDED', 'REINSTATED')`,
      ),
    );
    expect(up).toContainEqual(
      expect.stringContaining(
        `ADD CONSTRAINT "CHK_scope_governance_action_suspension" CHECK ("action"::text NOT IN ('SUSPENDED', 'REINSTATED') OR "asSiteAdmin")`,
      ),
    );
    expect(up).toContainEqual(
      expect.stringContaining(
        `"action"::text NOT IN ('ROLE_WITHDRAWN', 'CAPABILITY_DENIED', 'OWNERSHIP_REASSIGNED', 'CLOSED', 'SUSPENDED', 'REINSTATED')`,
      ),
    );
  });

  it('keeps one live hold per report and per member, with no key to the report', () => {
    expect(up).toContainEqual(
      expect.stringMatching(
        /^CREATE UNIQUE INDEX "UX_moderation_hold_report" .* WHERE "releasedAt" IS NULL/,
      ),
    );
    expect(up).toContainEqual(
      expect.stringMatching(
        /^CREATE UNIQUE INDEX "UX_moderation_hold_subject" .* WHERE "releasedAt" IS NULL/,
      ),
    );
    expect(table('moderation_hold')).not.toContain('chat_message_report');
    expect(table('moderation_hold')).toContain(
      `CONSTRAINT "CHK_moderation_hold_release" CHECK (("releasedAt" IS NULL) = ("releaseReason" IS NULL))`,
    );
  });

  it('bounds a look into a Fleet to 24 hours, with a purpose', () => {
    expect(table('fleet_investigation_grant')).toContain(
      `CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + interval '24 hours')`,
    );
    expect(table('fleet_investigation_grant')).toContain(
      `CHECK (length(btrim("purpose")) BETWEEN 10 AND 500)`,
    );
  });

  it('makes both new logs write-once', () => {
    for (const name of [
      'moderation_hold_action',
      'fleet_investigation_grant',
    ]) {
      expect(up).toContain(
        `CREATE TRIGGER "TR_${name}_guard" BEFORE UPDATE ON "sto_info_app"."${name}" FOR EACH ROW EXECUTE FUNCTION "sto_info_app"."${name}_guard"()`,
      );
    }
  });

  it('takes it all back out, remaking both logs’ types and CHECKs without suspension', () => {
    expect(down.slice(0, 7)).toEqual([
      'DROP TABLE "sto_info_app"."fleet_investigation_grant"',
      'DROP FUNCTION "sto_info_app"."fleet_investigation_grant_guard"()',
      'DROP TABLE "sto_info_app"."moderation_hold_action"',
      'DROP FUNCTION "sto_info_app"."moderation_hold_action_guard"()',
      'DROP TABLE "sto_info_app"."moderation_hold"',
      'DROP TYPE "sto_info_app"."moderation_hold_action_kind_enum"',
      'DROP TYPE "sto_info_app"."moderation_hold_kind_enum"',
    ]);
    expect(down).toContain(
      `ALTER TABLE "sto_info_app"."scope_governance_action" DROP CONSTRAINT IF EXISTS "CHK_scope_governance_action_suspension"`,
    );
    expect(down).not.toContainEqual(
      expect.stringContaining(
        'ADD CONSTRAINT "CHK_scope_governance_action_suspension"',
      ),
    );
    expect(down).toContain(
      `ALTER TABLE "sto_info_app"."scope_membership_action" ADD CONSTRAINT "CHK_scope_membership_action_removal_reason" CHECK ("action" <> 'REMOVED' OR ("reason" IS NOT NULL AND length(btrim("reason")) > 0))`,
    );
    expect(down).toContain(
      `CREATE TYPE "sto_info_app"."scope_membership_action_enum" AS ENUM ('APPROVED', 'LEFT', 'REMOVED')`,
    );
  });
});

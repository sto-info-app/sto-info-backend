import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { getMetadataArgsStorage, QueryRunner } from 'typeorm';

import { SiteAdminActionKind } from '../../audit/site-admin/site-admin-action.enum';
import {
  AddRescanCampaigns1796800000000,
  RESCAN_ACTIONS,
} from '../../database/migrations/1796800000000-AddRescanCampaigns';
import {
  DecideRescanFindings1797100000000,
  FC050_ACTIONS,
} from '../../database/migrations/1797100000000-DecideRescanFindings';
import { LEDGER_ACTIONS } from '../../database/migrations/1797200000000-RecordLedgerReconciliation';
import { OPERATIONS_ACTIONS } from '../../database/migrations/1797500000000-AddOperationsAlerts';
import { FileRescanCampaignEntity } from './file-rescan-campaign.entity';
import { FileRescanEntity } from './file-rescan.entity';
import {
  RescanCampaignKind,
  RescanCampaignState,
  RescanDecision,
  RescanState,
} from './rescan.enums';

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
 * Holds the rescan campaigns' tables and the site admin log's new actions
 * to the code (FC-041). It proves the descriptions agree, not that
 * PostgreSQL accepts them: the migration was run up, down and up again on
 * the local database.
 */
/** The rescan columns FC-050 adds. */
const LATER_RESCAN_COLUMNS = ['decision', 'decidedAt', 'decidedByUserId'];

describe('Rescan campaign schema alignment (FC-041)', () => {
  const migration = new AddRescanCampaigns1796800000000();
  let up: string[];
  let down: string[];

  beforeAll(async () => {
    up = await capture(queryRunner => migration.up(queryRunner));
    down = await capture(queryRunner => migration.down(queryRunner));
  });

  const table = (name: string): string =>
    up.find(statement =>
      statement.includes(`CREATE TABLE "sto_info_app"."${name}"`),
    )!;

  it.each([
    ['file_rescan_campaign', FileRescanCampaignEntity],
    ['file_rescan', FileRescanEntity],
  ])('declares exactly the columns %s is created with', (name, entity) => {
    const created = table(name)
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('"'))
      .map(line => line.slice(1, line.indexOf('"', 1)));
    const declared = getMetadataArgsStorage()
      .columns.filter(column => column.target === entity)
      .map(column => column.options.name ?? column.propertyName)
      // Added by FC-050's migration, held below.
      .filter(column => !LATER_RESCAN_COLUMNS.includes(column));

    expect([...created].sort()).toEqual([...declared].sort());
  });

  it.each([
    ['file_rescan_campaign_kind_enum', RescanCampaignKind],
    ['file_rescan_campaign_state_enum', RescanCampaignState],
    ['file_rescan_state_enum', RescanState],
  ])('gives %s every value the code knows', (name, values) => {
    expect(up).toContain(
      `CREATE TYPE "sto_info_app"."${name}" AS ENUM (${Object.values(values)
        .map(value => `'${value}'`)
        .join(', ')})`,
    );
  });

  it('rescans a picture once per policy and definition epoch, but retries a failure', () => {
    expect(up).toContain(
      `CREATE UNIQUE INDEX "UX_file_rescan_once" ON "sto_info_app"."file_rescan" ("assetId", "policyVersion", "definitionEpoch") WHERE "state" <> 'FAILED'`,
    );
    expect(table('file_rescan')).toContain(
      `CHECK (("state" = 'REQUESTED') = ("verdictAt" IS NULL))`,
    );
    expect(table('file_rescan')).toContain(
      `CHECK ("state" NOT IN ('INFECTED', 'REFUSED') OR "rejectionCode" IS NOT NULL)`,
    );
    expect(table('file_rescan_campaign')).toContain(
      `CHECK (("state" IN ('DONE', 'CANCELLED')) = ("finishedAt" IS NOT NULL))`,
    );
  });

  it('adds the campaigns’ actions to the site admin log, and takes them out again', () => {
    const added = Object.values(SiteAdminActionKind).filter(value =>
      value.startsWith('RESCAN_'),
    );

    expect([...RESCAN_ACTIONS]).toEqual(added);
    expect(up.slice(-added.length)).toEqual(
      added.map(
        value =>
          `ALTER TYPE "sto_info_app"."site_admin_action_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      ),
    );
    expect(down).toContain(
      `CREATE TYPE "sto_info_app"."site_admin_action_enum" AS ENUM (${Object.values(
        SiteAdminActionKind,
      )
        .filter(
          value =>
            !value.startsWith('RESCAN_') &&
            !(FC050_ACTIONS as readonly string[]).includes(value) &&
            !(LEDGER_ACTIONS as readonly string[]).includes(value) &&
            !(OPERATIONS_ACTIONS as readonly string[]).includes(value),
        )
        .map(value => `'${value}'`)
        .join(', ')})`,
    );
    expect(down.slice(-2)).toEqual([
      'DROP TYPE "sto_info_app"."file_rescan_campaign_state_enum"',
      'DROP TYPE "sto_info_app"."file_rescan_campaign_kind_enum"',
    ]);
  });
});

/**
 * Holds FC-050's decision on a policy refusal, and the site admin log's
 * actions it adds, to the code.
 */
describe('Rescan decision schema alignment (FC-050)', () => {
  const migration = new DecideRescanFindings1797100000000();
  let up: string[];
  let down: string[];

  beforeAll(async () => {
    up = await capture(queryRunner => migration.up(queryRunner));
    down = await capture(queryRunner => migration.down(queryRunner));
  });

  it('adds exactly the columns the entity declares beyond FC-041’s', () => {
    const added = up
      .map(statement => /ADD COLUMN "([^"]+)"/.exec(statement)?.[1])
      .filter(column => column !== undefined);

    expect(added).toEqual(LATER_RESCAN_COLUMNS);
    expect(
      getMetadataArgsStorage()
        .columns.filter(column => column.target === FileRescanEntity)
        .map(column => column.propertyName),
    ).toEqual(expect.arrayContaining(LATER_RESCAN_COLUMNS));
  });

  it('gives the decision type every value the code knows', () => {
    expect(up).toContain(
      `CREATE TYPE "sto_info_app"."file_rescan_decision_enum" AS ENUM (${Object.values(
        RescanDecision,
      )
        .map(value => `'${value}'`)
        .join(', ')})`,
    );
  });

  it('lets only a policy refusal be decided, and always with a time', () => {
    expect(up).toContainEqual(
      expect.stringContaining(
        `CHECK (("decision" IS NULL) = ("decidedAt" IS NULL) AND ("decision" IS NULL OR "state" = 'REFUSED'))`,
      ),
    );
  });

  it('adds its actions to the site admin log, and takes them out again', () => {
    // FC-042's come later.
    const later: readonly string[] = [...LEDGER_ACTIONS, ...OPERATIONS_ACTIONS];
    const all = Object.values(SiteAdminActionKind).filter(
      value => !later.includes(value),
    );

    expect(all.slice(-FC050_ACTIONS.length)).toEqual([...FC050_ACTIONS]);
    expect(up.slice(-FC050_ACTIONS.length)).toEqual(
      FC050_ACTIONS.map(
        value =>
          `ALTER TYPE "sto_info_app"."site_admin_action_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      ),
    );
    expect(down).toContain(
      `CREATE TYPE "sto_info_app"."site_admin_action_enum" AS ENUM (${all
        .slice(0, -FC050_ACTIONS.length)
        .map(value => `'${value}'`)
        .join(', ')})`,
    );
    expect(down[down.length - 1]).toBe(
      'DROP TYPE "sto_info_app"."file_rescan_decision_enum"',
    );
  });
});

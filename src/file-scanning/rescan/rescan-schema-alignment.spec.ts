import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { getMetadataArgsStorage, QueryRunner } from 'typeorm';

import { SiteAdminActionKind } from '../../audit/site-admin/site-admin-action.enum';
import {
  AddRescanCampaigns1796800000000,
  RESCAN_ACTIONS,
} from '../../database/migrations/1796800000000-AddRescanCampaigns';
import { FileRescanCampaignEntity } from './file-rescan-campaign.entity';
import { FileRescanEntity } from './file-rescan.entity';
import {
  RescanCampaignKind,
  RescanCampaignState,
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
      .map(column => column.options.name ?? column.propertyName);

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
        .filter(value => !value.startsWith('RESCAN_'))
        .map(value => `'${value}'`)
        .join(', ')})`,
    );
    expect(down.slice(-2)).toEqual([
      'DROP TYPE "sto_info_app"."file_rescan_campaign_state_enum"',
      'DROP TYPE "sto_info_app"."file_rescan_campaign_kind_enum"',
    ]);
  });
});

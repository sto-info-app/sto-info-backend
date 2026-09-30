import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { getMetadataArgsStorage, QueryRunner } from 'typeorm';

import { SiteAdminActionKind } from '../../audit/site-admin/site-admin-action.enum';
import {
  AddPrivateImageDelivery1796700000000,
  IMAGE_ESTATE_ACTIONS,
} from '../../database/migrations/1796700000000-AddPrivateImageDelivery';
import { FC050_ACTIONS } from '../../database/migrations/1797100000000-DecideRescanFindings';
import { FileAssetEntity } from '../entities/file-asset.entity';
import { ImageEstateRunEntity } from './image-estate-run.entity';
import { ImageEstateStepEntity } from './image-estate-step.entity';
import {
  ImageEstateRunKind,
  ImageEstateRunState,
  ImageEstateStepState,
  ImageInventoryRunState,
} from './image-estate.enums';
import { ImageInventoryRunEntity } from './image-inventory-run.entity';

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
 * The columns an entity declares.
 *
 * @param entity - Its class.
 * @returns Their names.
 */
const declared = (entity: object): string[] =>
  getMetadataArgsStorage()
    .columns.filter(column => column.target === entity)
    .map(column => column.options.name ?? column.propertyName);

/**
 * Holds the image estate's tables, the registry's private flag and the site
 * admin log's new actions to the code (FC-040). It proves the descriptions
 * agree, not that PostgreSQL accepts them: the migration was run up, down
 * and up again on the local database.
 */
describe('Image estate schema alignment (FC-040)', () => {
  const migration = new AddPrivateImageDelivery1796700000000();
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

  const columnsOf = (name: string): string[] =>
    table(name)
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('"'))
      .map(line => line.slice(1, line.indexOf('"', 1)));

  it.each([
    ['image_estate_run', ImageEstateRunEntity],
    ['image_estate_step', ImageEstateStepEntity],
    ['image_inventory_run', ImageInventoryRunEntity],
  ])('declares exactly the columns %s is created with', (name, entity) => {
    expect([...columnsOf(name)].sort()).toEqual([...declared(entity)].sort());
  });

  it.each([
    ['image_estate_run_kind_enum', ImageEstateRunKind],
    ['image_estate_run_state_enum', ImageEstateRunState],
    ['image_estate_step_state_enum', ImageEstateStepState],
    ['image_inventory_run_state_enum', ImageInventoryRunState],
  ])('gives %s every value the code knows', (name, values) => {
    expect(up).toContain(
      `CREATE TYPE "sto_info_app"."${name}" AS ENUM (${Object.values(values)
        .map(value => `'${value}'`)
        .join(', ')})`,
    );
  });

  it('adds the private flag the registry declares', () => {
    expect(declared(FileAssetEntity)).toContain('deliveryPrivate');
    expect(up[0]).toBe(
      `ALTER TABLE "sto_info_app"."file_asset" ADD "deliveryPrivate" boolean NOT NULL DEFAULT false`,
    );
  });

  it('keeps one run open at a time, and a picture copied once', () => {
    expect(up).toContain(
      `CREATE UNIQUE INDEX "UX_image_estate_run_open" ON "sto_info_app"."image_estate_run" ((true)) WHERE "state" <> 'DONE'`,
    );
    expect(up).toContain(
      `CREATE UNIQUE INDEX "UX_image_estate_step_asset" ON "sto_info_app"."image_estate_step" ("assetId") WHERE "state" IN ('PENDING', 'COPIED', 'RETIRED')`,
    );
    expect(table('image_estate_step')).toContain(
      `CHECK ("state" IN ('PENDING', 'FAILED') OR "toReference" IS NOT NULL)`,
    );
    expect(table('image_estate_run')).toContain(
      `CHECK (("state" = 'DONE') = ("finishedAt" IS NOT NULL))`,
    );
  });

  it('adds the image estate’s actions to the site admin log', () => {
    // FC-050's picture decisions start the same way, and come later.
    const later: readonly string[] = FC050_ACTIONS;
    const added = Object.values(SiteAdminActionKind).filter(
      value => value.startsWith('IMAGE_') && !later.includes(value),
    );

    expect([...IMAGE_ESTATE_ACTIONS]).toEqual(added);
    expect(up.slice(-added.length)).toEqual(
      added.map(
        value =>
          `ALTER TYPE "sto_info_app"."site_admin_action_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      ),
    );
  });

  it('undoes it all, making the log’s type again without them', () => {
    // FC-041's rescan actions and FC-050's come later, and are not in it
    // either.
    const later: readonly string[] = FC050_ACTIONS;
    const before = Object.values(SiteAdminActionKind).filter(
      value =>
        !value.startsWith('IMAGE_') &&
        !value.startsWith('RESCAN_') &&
        !later.includes(value),
    );

    expect(down).toContain(
      `CREATE TYPE "sto_info_app"."site_admin_action_enum" AS ENUM (${before.map(value => `'${value}'`).join(', ')})`,
    );
    expect(down.slice(-1)).toEqual([
      `ALTER TABLE "sto_info_app"."file_asset" DROP COLUMN "deliveryPrivate"`,
    ]);
  });
});

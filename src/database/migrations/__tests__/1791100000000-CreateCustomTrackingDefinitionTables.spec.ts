import { jest } from '@jest/globals';
import { QueryRunner } from 'typeorm';

import { CreateCustomTrackingDefinitionTables1791100000000 } from '../1791100000000-CreateCustomTrackingDefinitionTables';

describe('CreateCustomTrackingDefinitionTables1791100000000', () => {
  const runMigration = async (direction: 'up' | 'down'): Promise<string[]> => {
    const migration = new CreateCustomTrackingDefinitionTables1791100000000();
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

  it('creates every definition table', async () => {
    const queries = await runMigration('up');

    for (const table of [
      'custom_tracking_policy_acceptance',
      'custom_tracking_section',
      'custom_tracking_tab',
      'custom_tracking_field',
      'custom_tracking_option',
    ]) {
      expect(
        positionOf(queries, `CREATE TABLE "sto_info_app"."${table}"`),
      ).toBeGreaterThan(-1);
    }
  });

  // A column cannot name a type that does not exist yet.
  it('creates the enum types before the tables that use them', async () => {
    const queries = await runMigration('up');

    expect(
      positionOf(
        queries,
        'CREATE TYPE "sto_info_app"."custom_tracking_field_type_enum"',
      ),
    ).toBeLessThan(
      positionOf(
        queries,
        'CREATE TABLE "sto_info_app"."custom_tracking_field"',
      ),
    );
  });

  // A child table cannot reference a parent that has not been created.
  it('creates each table before the one that references it', async () => {
    const queries = await runMigration('up');

    expect(
      positionOf(
        queries,
        'CREATE TABLE "sto_info_app"."custom_tracking_section"',
      ),
    ).toBeLessThan(
      positionOf(queries, 'CREATE TABLE "sto_info_app"."custom_tracking_tab"'),
    );
    expect(
      positionOf(queries, 'CREATE TABLE "sto_info_app"."custom_tracking_tab"'),
    ).toBeLessThan(
      positionOf(
        queries,
        'CREATE TABLE "sto_info_app"."custom_tracking_field"',
      ),
    );
    expect(
      positionOf(
        queries,
        'CREATE TABLE "sto_info_app"."custom_tracking_field"',
      ),
    ).toBeLessThan(
      positionOf(
        queries,
        'CREATE TABLE "sto_info_app"."custom_tracking_option"',
      ),
    );
  });

  // Uniqueness has to ignore deleted rows, or a name could never be reused
  // after its definition was deleted.
  it.each([
    ['UX_custom_tracking_section_user_scope_name'],
    ['UX_custom_tracking_tab_section_name'],
    ['UX_custom_tracking_field_tab_name'],
    ['UX_custom_tracking_option_field_label'],
  ])('makes %s unique among live rows only', async indexName => {
    const queries = await runMigration('up');
    const index = queries.find(query => query.includes(indexName));

    expect(index).toContain('CREATE UNIQUE INDEX');
    expect(index).toContain('WHERE "deletedAt" IS NULL');
  });

  // An environment that has never been configured should keep an unreleased
  // feature hidden rather than exposing it the moment the schema arrives.
  it('seeds the feature switch as off', async () => {
    const queries = await runMigration('up');
    const seed = queries.find(query =>
      query.includes('INSERT INTO "sto_info_app"."app_setting"'),
    );

    expect(seed).toContain("'CUSTOM_TRACKING_ENABLED', 'false'");
    expect(seed).toContain('ON CONFLICT ("key") DO NOTHING');
  });

  it('drops each table before the one it references', async () => {
    const queries = await runMigration('down');

    expect(
      positionOf(queries, 'DROP TABLE "sto_info_app"."custom_tracking_option"'),
    ).toBeLessThan(
      positionOf(queries, 'DROP TABLE "sto_info_app"."custom_tracking_field"'),
    );
    expect(
      positionOf(queries, 'DROP TABLE "sto_info_app"."custom_tracking_field"'),
    ).toBeLessThan(
      positionOf(queries, 'DROP TABLE "sto_info_app"."custom_tracking_tab"'),
    );
    expect(
      positionOf(queries, 'DROP TABLE "sto_info_app"."custom_tracking_tab"'),
    ).toBeLessThan(
      positionOf(
        queries,
        'DROP TABLE "sto_info_app"."custom_tracking_section"',
      ),
    );
  });

  // A type cannot be dropped while a column still uses it.
  it('drops the enum types after every table that used them', async () => {
    const queries = await runMigration('down');

    expect(
      positionOf(queries, 'DROP TABLE "sto_info_app"."custom_tracking_field"'),
    ).toBeLessThan(
      positionOf(
        queries,
        'DROP TYPE "sto_info_app"."custom_tracking_field_type_enum"',
      ),
    );
  });

  it('removes the feature switch it seeded', async () => {
    const queries = await runMigration('down');

    expect(
      positionOf(queries, `"key" = 'CUSTOM_TRACKING_ENABLED'`),
    ).toBeGreaterThan(-1);
  });
});

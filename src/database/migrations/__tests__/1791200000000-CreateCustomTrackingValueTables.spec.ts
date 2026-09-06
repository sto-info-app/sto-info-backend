import { jest } from '@jest/globals';
import { QueryRunner } from 'typeorm';

import { CreateCustomTrackingValueTables1791200000000 } from '../1791200000000-CreateCustomTrackingValueTables';

describe('CreateCustomTrackingValueTables1791200000000', () => {
  const runMigration = async (direction: 'up' | 'down'): Promise<string[]> => {
    const migration = new CreateCustomTrackingValueTables1791200000000();
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

  it('creates every value table', async () => {
    const queries = await runMigration('up');

    for (const table of [
      'custom_tracking_value',
      'custom_tracking_value_option',
      'custom_tracking_image_value',
    ]) {
      expect(
        positionOf(queries, `CREATE TABLE "sto_info_app"."${table}"`),
      ).toBeGreaterThan(-1);
    }
  });

  // A service check would let the first bad row through under a race and leave
  // it to be found by whatever tried to render it.
  it('makes target exclusivity a check constraint', async () => {
    const queries = await runMigration('up');
    const table = queries.find(query =>
      query.includes('CREATE TABLE "sto_info_app"."custom_tracking_value"'),
    );

    expect(table).toContain('CK_custom_tracking_value_target');
    expect(table).toContain(
      `"targetScope" = 'ACCOUNT' AND "accountId" IS NOT NULL AND "characterId" IS NULL`,
    );
    expect(table).toContain(
      `"targetScope" = 'CHARACTER' AND "characterId" IS NOT NULL AND "accountId" IS NULL`,
    );
  });

  // The composite key is what refuses an Account value recorded against a
  // Character-scoped field, rather than a comparison somebody remembered.
  it('makes scope consistency a composite foreign key', async () => {
    const queries = await runMigration('up');

    expect(
      positionOf(queries, 'UX_custom_tracking_field_id_scope'),
    ).toBeLessThan(
      positionOf(
        queries,
        'CREATE TABLE "sto_info_app"."custom_tracking_value"',
      ),
    );

    const table = queries.find(query =>
      query.includes('CREATE TABLE "sto_info_app"."custom_tracking_value"'),
    );

    expect(table).toContain(
      'FOREIGN KEY ("fieldId", "targetScope") REFERENCES "sto_info_app"."custom_tracking_field"("id", "targetScope")',
    );
  });

  // A null does not compare equal to anything in SQL, so one index over both
  // target columns would let the same Account be answered twice.
  it('uses one partial index per target column', async () => {
    const queries = await runMigration('up');
    const account = queries.find(query =>
      query.includes('UX_custom_tracking_value_field_account'),
    );
    const character = queries.find(query =>
      query.includes('UX_custom_tracking_value_field_character'),
    );

    expect(account).toContain(
      'WHERE "deletedAt" IS NULL AND "accountId" IS NOT NULL',
    );
    expect(character).toContain(
      'WHERE "deletedAt" IS NULL AND "characterId" IS NOT NULL',
    );
  });

  // This is what makes a withdrawn option outlive its retention window for as
  // long as a value still names it, without anything having to remember.
  it('restricts deleting an option a value still names', async () => {
    const queries = await runMigration('up');
    const table = queries.find(query =>
      query.includes(
        'CREATE TABLE "sto_info_app"."custom_tracking_value_option"',
      ),
    );

    expect(table).toContain(
      'REFERENCES "sto_info_app"."custom_tracking_option"("id") ON DELETE RESTRICT',
    );
  });

  it('allows only one picture per value', async () => {
    const queries = await runMigration('up');
    const table = queries.find(query =>
      query.includes(
        'CREATE TABLE "sto_info_app"."custom_tracking_image_value"',
      ),
    );

    expect(table).toContain(
      'CONSTRAINT "UX_custom_tracking_image_value_value" UNIQUE ("valueId")',
    );
  });

  it('drops each table before the one it references', async () => {
    const queries = await runMigration('down');

    expect(
      positionOf(
        queries,
        'DROP TABLE "sto_info_app"."custom_tracking_value_option"',
      ),
    ).toBeLessThan(
      positionOf(queries, 'DROP TABLE "sto_info_app"."custom_tracking_value"'),
    );
  });

  // The unique key exists only to be the target of the composite foreign key,
  // so it goes once nothing references it.
  it('removes the field unique key it added', async () => {
    const queries = await runMigration('down');

    expect(
      positionOf(queries, 'DROP TABLE "sto_info_app"."custom_tracking_value"'),
    ).toBeLessThan(
      positionOf(
        queries,
        'DROP CONSTRAINT "UX_custom_tracking_field_id_scope"',
      ),
    );
  });

  it('drops the image shape type last', async () => {
    const queries = await runMigration('down');

    expect(
      positionOf(
        queries,
        'DROP TABLE "sto_info_app"."custom_tracking_image_value"',
      ),
    ).toBeLessThan(
      positionOf(
        queries,
        'DROP TYPE "sto_info_app"."custom_tracking_image_shape_enum"',
      ),
    );
  });
});

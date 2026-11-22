import { describe, expect, it, jest } from '@jest/globals';
import { QueryRunner } from 'typeorm';

import { GUARDED_IMAGE_COLUMNS } from '../1797300000000-GuardPublishedImageReferences';
import {
  CHARACTER_PICTURE_SHAPE,
  ClearCharacterNamesFromPictures1797800000000,
  FILE_ASSET_REFERENCES,
} from '../1797800000000-ClearCharacterNamesFromPictures';

/**
 * Runs a direction of the migration and keeps what it sends.
 *
 * @param direction - Which.
 * @returns Every statement, in order.
 */
async function capture(direction: 'up' | 'down'): Promise<string[]> {
  const statements: string[] = [];
  const queryRunner = {
    query: jest.fn((sql: string) => {
      statements.push(sql);

      return Promise.resolve();
    }),
  } as unknown as QueryRunner;

  await new ClearCharacterNamesFromPictures1797800000000()[direction](
    queryRunner,
  );

  return statements;
}

/** Whether a value has the shape of a Character picture, as PostgreSQL's `~*` reads it. */
const pictureShaped = (value: string): boolean =>
  value.includes('/') || new RegExp(CHARACTER_PICTURE_SHAPE, 'i').test(value);

/**
 * The migration's SQL is proved against a real database by the release
 * rehearsal (`npm run rehearse:release`), with names, R2 keys and Cloudflare
 * IDs side by side. What this holds is what it may touch.
 */
describe('ClearCharacterNamesFromPictures1797800000000 (FC-045)', () => {
  it.each([
    ['production/6a1f0c2e-1b2c-4d3e-8f90-123456789abc/abc/portrait.png'],
    [
      'production-6a1f0c2e-1b2c-4d3e-8f90-123456789abc-character-1a2b-1767000000000',
    ],
    ['local-1d730bb8-b732-4f50-af97-a991e0010aa3-character-e83ee2b'],
    ['6A1F0C2E-1B2C-4D3E-8F90-123456789ABC'],
  ])('keeps %s, which can be a picture', value => {
    expect(pictureShaped(value)).toBe(true);
  });

  it.each([
    ['Aria Venn'],
    ['Sisko'],
    ['Jean-Luc'],
    ['6a1f0c2e'],
    ['Captain 6a1f0c2e-1b2c-4d3e-8f90-123456789abc'],
  ])('clears %s, which cannot be a picture', value => {
    expect(pictureShaped(value)).toBe(false);
  });

  it('only ever clears the Character picture column, to NULL', async () => {
    const statements = await capture('up');
    const updates = statements.filter(sql => sql.startsWith('UPDATE'));

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatch(
      /^UPDATE "sto_info_app"\."character" SET "profilePictureId" = NULL WHERE "profilePictureId" IS NOT NULL/,
    );
    expect(updates[0]).toContain(`POSITION('/' IN "profilePictureId") = 0`);
    expect(updates[0]).toContain(
      `"profilePictureId" !~* '${CHARACTER_PICTURE_SHAPE}'`,
    );
  });

  it('deletes only unverified public pictures no column holds and nothing refers to', async () => {
    const statements = await capture('up');
    const chosen = statements.find(sql =>
      sql.includes('CREATE TEMPORARY TABLE "fc045_unpictured"'),
    )!;
    const deletes = statements.filter(sql => sql.startsWith('DELETE'));

    expect(chosen).toContain(`a."state" = 'UNVERIFIED'`);
    expect(chosen).toContain(`a."storage" = 'PUBLIC_IMAGES'`);

    for (const [table, column] of GUARDED_IMAGE_COLUMNS) {
      expect(chosen).toContain(
        `SELECT "${column}" AS "value" FROM "sto_info_app"."${table}" WHERE "${column}" IS NOT NULL`,
      );
    }

    const kept = statements.find(sql => sql.startsWith('DO $$'))!;

    for (const [schema, table] of FILE_ASSET_REFERENCES) {
      expect(kept).toContain(`to_regclass('"${schema}"."${table}"')`);
      expect(kept).toContain(`USING "${schema}"."${table}" r`);
    }

    expect(deletes).toEqual([
      'DELETE FROM "sto_info_app"."file_asset" a USING pg_temp."fc045_unpictured" n WHERE a."id" = n."id"',
    ]);
  });

  it('chooses the names before clearing them, and tidies up after', async () => {
    const statements = await capture('up');
    const at = (start: string) =>
      statements.findIndex(sql => sql.startsWith(start));

    expect(at('CREATE TEMPORARY TABLE "fc045_cleared"')).toBeLessThan(
      at('UPDATE'),
    );
    expect(statements[statements.length - 1]).toBe(
      'DROP TABLE pg_temp."fc045_unpictured", pg_temp."fc045_cleared"',
    );
  });

  it('puts nothing back on the way down', async () => {
    await expect(capture('down')).resolves.toEqual([]);
  });
});

import { jest } from '@jest/globals';
import { QueryRunner } from 'typeorm';

import { BackfillLegacyFileAssets1792200000000 } from '../1792200000000-BackfillLegacyFileAssets';

/**
 * The backfill emits one statement, and what matters about it is which tables
 * it reads and what it refuses to do to them.
 *
 * The rehearsal proves the query returns the right rows against a real
 * database. What this adds is the property that it is a read of the estate and
 * nothing else: no `UPDATE`, no `DELETE` and no `ALTER` anywhere in it, so a
 * migration that counts the site's images cannot change one.
 */
describe('BackfillLegacyFileAssets1792200000000', () => {
  const runMigration = async (direction: 'up' | 'down'): Promise<string[]> => {
    const migration = new BackfillLegacyFileAssets1792200000000();
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

  describe('what it reads', () => {
    it.each([
      'user_profile',
      'character',
      'account',
      'storytime_arc',
      'storytime_story',
      'storytime_chapter',
      'storytime_character',
      'storytime_spotlight',
      'custom_tracking_image_value',
      'custom_tracking_value',
    ])('counts the images held in %s', async table => {
      const [statement] = await runMigration('up');

      expect(statement).toContain(`"sto_info_app"."${table}"`);
    });

    /**
     * Every join is a `LEFT JOIN`, so an image whose owner cannot be resolved
     * is still counted with a null uploader. An inner join would quietly drop
     * exactly the objects nobody remembers, which are the ones a rescan
     * campaign most needs to find.
     */
    it('never drops an object whose owner cannot be resolved', async () => {
      const [statement] = await runMigration('up');

      expect(statement).not.toMatch(/\bINNER JOIN\b/);
      expect(statement.match(/LEFT JOIN/g)?.length).toBeGreaterThan(0);
    });

    it('changes nothing it reads', async () => {
      const [statement] = await runMigration('up');

      expect(statement).not.toMatch(/\bUPDATE\b/);
      expect(statement).not.toMatch(/\bDELETE\b/);
      expect(statement).not.toMatch(/\bALTER\b/);
      expect(statement).not.toMatch(/\bDROP\b/);
    });
  });

  describe('what it writes', () => {
    it('writes one row per object rather than one per reference', async () => {
      const [statement] = await runMigration('up');

      expect(statement).toContain(
        'SELECT DISTINCT ON (source."storage", source."objectKey")',
      );
    });

    /**
     * The honest state. Counting the estate is not a verdict about it, and a
     * migration that wrote `CLEAN` or `AVAILABLE` here would be claiming a
     * scanner looked at bytes that no scanner has ever seen.
     */
    it('records every counted object as unverified', async () => {
      const [statement] = await runMigration('up');

      expect(statement).toContain(`'UNVERIFIED'`);
      expect(statement).not.toContain(`'CLEAN'`);
      expect(statement).not.toContain(`'AVAILABLE'`);
    });

    it('tells a pre-Images object from a Cloudflare identifier', async () => {
      const [statement] = await runMigration('up');

      expect(statement).toContain(
        `CASE WHEN POSITION('/' IN sto_character."profilePictureId") > 0`,
      );
      expect(statement).toContain(
        `THEN 'LEGACY_PUBLIC_R2' ELSE 'PUBLIC_IMAGES'`,
      );
    });

    it('skips an object the registry already knows about', async () => {
      const [statement] = await runMigration('up');

      expect(statement).toContain('WHERE NOT EXISTS');
    });
  });

  describe('the rollback', () => {
    /**
     * Only rows this migration could have written. `UNVERIFIED` is reachable
     * no other way, since every asset registered through the service starts in
     * `RECEIVING` — so a row that has since been scanned has left the state
     * and survives the revert, which is what it should do.
     */
    it('removes only the counted rows, and only while they are still uncounted', async () => {
      const [statement] = await runMigration('down');

      expect(statement).toContain('DELETE FROM "sto_info_app"."file_asset"');
      expect(statement).toContain(`"state" = 'UNVERIFIED'`);
      expect(statement).toContain(
        `"storage" IN ('PUBLIC_IMAGES', 'LEGACY_PUBLIC_R2')`,
      );
    });

    it('leaves quarantined assets alone', async () => {
      const [statement] = await runMigration('down');

      expect(statement).not.toContain(`'QUARANTINE'`);
    });
  });
});

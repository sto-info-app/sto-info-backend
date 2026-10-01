import { jest } from '@jest/globals';
import { MigrationInterface, QueryRunner } from 'typeorm';

import { SHOWABLE_IMAGE_STATES } from 'src/file-assets/delivery/image-url-signing.interceptor';
import { IMAGE_REFERENCE_COLUMNS } from 'src/file-assets/estate/image-references';

import {
  GUARDED_IMAGE_COLUMNS,
  GuardPublishedImageReferences1797300000000,
  PUBLISHED_IMAGE_GUARD_DOWN_REFUSAL,
  PUBLISHED_IMAGE_GUARD_SQLSTATE,
} from '../1797300000000-GuardPublishedImageReferences';

/**
 * Migrations are excluded from coverage and run against a real database only
 * in rehearsal, so this spec asserts the SQL the migration emits, and that it
 * guards every picture column the application knows about.
 *
 * The rehearsal (`npm run rehearse:migration:published-image-guard`) is what
 * proves PostgreSQL refuses the writes this describes.
 */
describe('GuardPublishedImageReferences1797300000000', () => {
  const runUp = async (): Promise<string[]> => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn((sql: string) => {
        queries.push(sql);

        return Promise.resolve();
      }),
    } as unknown as QueryRunner;

    await new GuardPublishedImageReferences1797300000000().up(queryRunner);

    return queries;
  };

  const guardFunction = async (): Promise<string> =>
    (await runUp()).find(query =>
      query.includes('CREATE OR REPLACE FUNCTION'),
    ) as string;

  const triggers = async (): Promise<string[]> =>
    (await runUp()).filter(query => query.includes('CREATE TRIGGER'));

  describe('which columns it guards', () => {
    /**
     * The drift check. A picture column added to the application without a
     * trigger is exactly the gap an old build would publish through.
     */
    it('guards every picture column the application knows, and no other', () => {
      const known = IMAGE_REFERENCE_COLUMNS.map(
        each => `${each.table}.${each.column}`,
      ).sort();
      const guarded = GUARDED_IMAGE_COLUMNS.map(
        ([table, column]) => `${table}.${column}`,
      ).sort();

      expect(guarded).toEqual(known);
    });

    it('creates one function and one trigger per column', async () => {
      const queries = await runUp();

      expect(queries).toHaveLength(GUARDED_IMAGE_COLUMNS.length + 1);
      expect(await triggers()).toHaveLength(17);
    });

    it.each(GUARDED_IMAGE_COLUMNS.map(([table, column]) => [table, column]))(
      'checks %s.%s before every insert and every update of it',
      async (table, column) => {
        expect(await triggers()).toContain(
          `CREATE TRIGGER "TR_${table}_${column}_published" BEFORE INSERT OR UPDATE OF "${column}" ON "sto_info_app"."${table}" FOR EACH ROW EXECUTE FUNCTION "sto_info_app"."published_image_reference_guard"('${column}')`,
        );
      },
    );

    it('keeps every trigger name within PostgreSQL’s 63 characters', async () => {
      for (const trigger of await triggers()) {
        const name = /CREATE TRIGGER "([^"]+)"/.exec(trigger)?.[1] as string;

        expect(name.length).toBeLessThanOrEqual(63);
      }
    });
  });

  describe('what the guard lets through', () => {
    it('always allows NULL', async () => {
      expect(await guardFunction()).toContain(
        'IF reference IS NULL THEN\n          RETURN NEW;',
      );
    });

    it('allows an update that leaves the value as it was', async () => {
      expect(await guardFunction()).toContain(
        `IF TG_OP = 'UPDATE' AND reference IS NOT DISTINCT FROM (to_jsonb(OLD) ->> TG_ARGV[0]) THEN`,
      );
    });

    /**
     * The same two states delivery shows, so a picture the site would show
     * can always be put back where it was, and nothing else can go in.
     */
    it('accepts only a registry picture in a showable state', async () => {
      const states = SHOWABLE_IMAGE_STATES.map(state => `'${state}'`).join(
        ', ',
      );

      expect(await guardFunction()).toContain(
        `WHERE asset."deliveryReference" = reference\n            AND asset."state" IN (${states})`,
      );
    });
  });

  describe('the refusal', () => {
    it('raises its own SQLSTATE', async () => {
      expect(await guardFunction()).toContain(
        `USING ERRCODE = '${PUBLISHED_IMAGE_GUARD_SQLSTATE}'`,
      );
      expect(PUBLISHED_IMAGE_GUARD_SQLSTATE).toMatch(/^[0-9A-Z]{5}$/);
    });

    /**
     * An error message is logged. Naming the table and column tells an
     * operator what was refused; the value would tell them nothing more and
     * does not belong in a log.
     */
    it('names the table and column, never the value', async () => {
      const raise = /RAISE EXCEPTION ([^\n]+)/.exec(
        await guardFunction(),
      )?.[1] as string;

      expect(raise).toBe(
        `'%.% may only hold a picture the asset registry has published', TG_TABLE_NAME, TG_ARGV[0]`,
      );
    });
  });

  describe('the rollback', () => {
    it('refuses, and says to roll forward', async () => {
      await expect(
        new GuardPublishedImageReferences1797300000000().down(),
      ).rejects.toThrow(PUBLISHED_IMAGE_GUARD_DOWN_REFUSAL);
      expect(PUBLISHED_IMAGE_GUARD_DOWN_REFUSAL).toContain('Roll forward');
    });

    it('changes nothing before refusing', async () => {
      const query = jest.fn();
      const migration: MigrationInterface =
        new GuardPublishedImageReferences1797300000000();

      await expect(
        migration.down({ query } as unknown as QueryRunner),
      ).rejects.toThrow(Error);
      expect(query).not.toHaveBeenCalled();
    });
  });
});

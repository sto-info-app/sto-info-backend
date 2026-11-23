import { describe, expect, it, jest } from '@jest/globals';
import { QueryRunner } from 'typeorm';

import { FileAssetKind } from 'src/file-assets/enums/file-asset-kind.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';

import {
  AllowSiteNewsCovers1798800000000,
  NEWS_POST_SCOPE_CHECK,
  PREVIOUS_KINDS,
  PREVIOUS_SUBJECTS,
} from '../1798800000000-AllowSiteNewsCovers';

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

  await new AllowSiteNewsCovers1798800000000()[direction](queryRunner);

  return statements;
}

/**
 * The check as one line, so a test can read it without minding the layout.
 *
 * @param sql - A statement.
 * @returns It with every run of white space made one space.
 */
const flat = (sql: string): string => sql.replace(/\s+/g, ' ');

/**
 * The site's own news posts gain a cover (sc-1447). The check is proved
 * against a real database by the release rehearsal; this holds what each
 * direction asks for.
 */
describe('AllowSiteNewsCovers1798800000000', () => {
  it('adds the kind and the subject before freeing the cover columns', async () => {
    const statements = await capture('up');

    expect(statements.slice(0, 3)).toEqual([
      `ALTER TYPE "sto_info_app"."file_asset_kind_enum" ADD VALUE IF NOT EXISTS 'NEWS_IMAGE'`,
      `ALTER TYPE "sto_info_app"."file_asset_subject_enum" ADD VALUE IF NOT EXISTS 'SITE_NEWS_POST'`,
      `ALTER TABLE "sto_info_app"."news_post" DROP CONSTRAINT "${NEWS_POST_SCOPE_CHECK}"`,
    ]);
    expect(statements).toHaveLength(4);
  });

  it('lets a site post carry a cover, and still holds everything else about its shape', async () => {
    const check = flat((await capture('up'))[3]);
    const [site, scoped] = check.split(' OR ("communityId" IS NOT NULL');

    expect(site).toContain(
      '("communityId" IS NULL AND "fleetId" IS NULL AND "armadaId" IS NULL AND "audience" IS NULL AND "category" IS NOT NULL)',
    );
    expect(site).not.toContain('coverImage');
    expect(scoped).toContain(`"audience" <> 'PRIVATE' AND "category" IS NULL`);
  });

  it('keeps the check’s name, so nothing else has to learn a new one', () => {
    expect(NEWS_POST_SCOPE_CHECK).toBe('CHK_news_post_scope');
  });

  it('puts the original check back before narrowing the enums on the way down', async () => {
    const statements = (await capture('down')).map(flat);

    expect(statements[0]).toBe(
      `ALTER TABLE "sto_info_app"."news_post" DROP CONSTRAINT "${NEWS_POST_SCOPE_CHECK}"`,
    );
    expect(statements[1]).toContain(
      '"category" IS NOT NULL AND "coverImageId" IS NULL AND "coverImageAlt" IS NULL)',
    );
    expect(statements.slice(2)).toEqual([
      `ALTER TYPE "sto_info_app"."file_asset_subject_enum" RENAME TO "file_asset_subject_enum_old"`,
      `CREATE TYPE "sto_info_app"."file_asset_subject_enum" AS ENUM (${PREVIOUS_SUBJECTS.map(value => `'${value}'`).join(', ')})`,
      `ALTER TABLE "sto_info_app"."file_asset_placement" ALTER COLUMN "subject" TYPE "sto_info_app"."file_asset_subject_enum" USING "subject"::text::"sto_info_app"."file_asset_subject_enum"`,
      `DROP TYPE "sto_info_app"."file_asset_subject_enum_old"`,
      `ALTER TYPE "sto_info_app"."file_asset_kind_enum" RENAME TO "file_asset_kind_enum_old"`,
      `CREATE TYPE "sto_info_app"."file_asset_kind_enum" AS ENUM (${PREVIOUS_KINDS.map(value => `'${value}'`).join(', ')})`,
      `ALTER TABLE "sto_info_app"."file_asset" ALTER COLUMN "kind" TYPE "sto_info_app"."file_asset_kind_enum" USING "kind"::text::"sto_info_app"."file_asset_kind_enum"`,
      `DROP TYPE "sto_info_app"."file_asset_kind_enum_old"`,
    ]);
  });

  it('narrows each enum to values the application still knows, less the one it added', () => {
    const kinds: string[] = Object.values(FileAssetKind);
    const subjects: string[] = Object.values(FileAssetSubject);

    expect(kinds).toEqual(expect.arrayContaining(PREVIOUS_KINDS));
    expect(PREVIOUS_KINDS).not.toContain(FileAssetKind.NEWS_IMAGE);
    expect(subjects).toEqual(expect.arrayContaining(PREVIOUS_SUBJECTS));
    expect(PREVIOUS_SUBJECTS).not.toContain(FileAssetSubject.SITE_NEWS_POST);
  });
});

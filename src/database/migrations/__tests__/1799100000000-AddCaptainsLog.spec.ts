import { describe, expect, it, jest } from '@jest/globals';
import { getMetadataArgsStorage, QueryRunner } from 'typeorm';

import { LogEntryEntity } from 'src/captains-log/entities/log-entry.entity';
import { FileAssetKind } from 'src/file-assets/enums/file-asset-kind.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';

import {
  AddCaptainsLog1799100000000,
  KINDS_BEFORE_LOG,
  LOG_ENTRY_ACTIONS_DOWN_REFUSAL,
  SUBJECTS_BEFORE_LOG,
} from '../1799100000000-AddCaptainsLog';

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

  await new AddCaptainsLog1799100000000()[direction](queryRunner);

  return statements;
}

/**
 * The Captain's Log (sc-1450). The migration was run up, down and up again
 * on the local database; this holds what each direction asks for.
 */
describe('AddCaptainsLog1799100000000', () => {
  it('widens the enums before anything uses the new values', async () => {
    const statements = await capture('up');

    expect(statements.slice(0, 3)).toEqual([
      `ALTER TYPE "sto_info_app"."file_asset_kind_enum" ADD VALUE IF NOT EXISTS 'LOG_IMAGE'`,
      `ALTER TYPE "sto_info_app"."file_asset_subject_enum" ADD VALUE IF NOT EXISTS 'LOG_ENTRY'`,
      `ALTER TYPE "sto_info_app"."site_admin_action_enum" ADD VALUE IF NOT EXISTS 'LOG_ENTRY_REMOVED'`,
    ]);
  });

  it('creates exactly the columns the entity declares', async () => {
    const table = (await capture('up')).find(statement =>
      statement.includes('CREATE TABLE "sto_info_app"."log_entry"'),
    )!;
    const created = table
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('"'))
      .map(line => line.slice(1, line.indexOf('"', 1)));
    const declared = getMetadataArgsStorage()
      .columns.filter(column => column.target === LogEntryEntity)
      .map(column => column.propertyName);

    expect([...created].sort()).toEqual([...declared].sort());
    expect(table).toContain('"stardate" numeric(8,2) NOT NULL');
    expect(table).toContain('char_length("body") <= 10000');
    expect(table).toContain('"headline" character varying(120)');
    expect(table).toContain('ON DELETE CASCADE');
  });

  it('holds the picture column to pictures the registry has published', async () => {
    expect(await capture('up')).toContain(
      `CREATE TRIGGER "TR_log_entry_pictureId_published" BEFORE INSERT OR UPDATE OF "pictureId" ON "sto_info_app"."log_entry" FOR EACH ROW EXECUTE FUNCTION "sto_info_app"."published_image_reference_guard"('pictureId')`,
    );
  });

  it('lets a user report name the entry it is about', async () => {
    const statements = await capture('up');

    expect(statements).toContain(
      `ALTER TABLE "sto_info_app"."user_report" ADD "logEntryId" uuid`,
    );
    expect(
      statements.some(statement =>
        statement.includes('"FK_user_report_log_entry"'),
      ),
    ).toBe(true);
  });

  it('refuses first on the way down while the log holds a removal', async () => {
    const statements = await capture('down');

    expect(statements[0]).toBe(
      `DO $$ BEGIN IF EXISTS (SELECT 1 FROM "sto_info_app"."site_admin_action" WHERE "action"::text IN ('LOG_ENTRY_REMOVED')) THEN RAISE EXCEPTION '${LOG_ENTRY_ACTIONS_DOWN_REFUSAL}'; END IF; END $$`,
    );
    expect(LOG_ENTRY_ACTIONS_DOWN_REFUSAL).toContain('roll forward instead');
    expect(LOG_ENTRY_ACTIONS_DOWN_REFUSAL).not.toContain("'");
    expect(statements.some(statement => statement.startsWith('DELETE'))).toBe(
      false,
    );
  });

  it('drops the table before narrowing each enum to what it held', async () => {
    const statements = await capture('down');
    const dropped = statements.indexOf(`DROP TABLE "sto_info_app"."log_entry"`);
    const kinds = KINDS_BEFORE_LOG.map(value => `'${value}'`).join(', ');
    const subjects = SUBJECTS_BEFORE_LOG.map(value => `'${value}'`).join(', ');

    expect(dropped).toBeGreaterThan(0);
    expect(
      statements.indexOf(
        `CREATE TYPE "sto_info_app"."file_asset_kind_enum" AS ENUM (${kinds})`,
      ),
    ).toBeGreaterThan(dropped);
    expect(statements).toContain(
      `CREATE TYPE "sto_info_app"."file_asset_subject_enum" AS ENUM (${subjects})`,
    );
    expect(statements[statements.length - 1]).toBe(
      `DROP TYPE "sto_info_app"."file_asset_kind_enum_old"`,
    );
  });

  it('knew every kind and subject there was before it, and adds only its own', () => {
    expect([...KINDS_BEFORE_LOG, FileAssetKind.LOG_IMAGE]).toEqual(
      Object.values(FileAssetKind),
    );
    expect([...SUBJECTS_BEFORE_LOG, FileAssetSubject.LOG_ENTRY]).toEqual(
      Object.values(FileAssetSubject),
    );
  });
});

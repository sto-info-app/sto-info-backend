import { ArgumentMetadata, ParseUUIDPipe } from '@nestjs/common';

import { describe, expect, it, jest } from '@jest/globals';
import { isUUID } from 'class-validator';
import { QueryRunner } from 'typeorm';

import {
  seededTags,
  toVersionFourId,
} from '../../../storytime/tags/testing/seeded-tag-ids';
import * as migrationModule from '../1799200000000-RekeySeededStorytimeTags';
import {
  RekeySeededStorytimeTags1799200000000,
  SEEDED_TAG_ID_NAMESPACE,
  TAG_ID_VERSION_CHECK,
  TAG_LINK_TABLES,
  VERSION_FOUR_UUID_PATTERN,
} from '../1799200000000-RekeySeededStorytimeTags';

const SEEDED = seededTags();

/** The test the migration uses to recognise a row the seed inserted. */
const IS_SEEDED_ROW = `"tag"."id" = md5('${SEEDED_TAG_ID_NAMESPACE}' || "tag"."slug")::uuid`;

/**
 * Runs a direction of the migration and keeps what it sends.
 *
 * @param direction - Which.
 * @returns Every statement, in order, with whitespace collapsed.
 */
async function capture(direction: 'up' | 'down'): Promise<string[]> {
  const statements: string[] = [];
  const queryRunner = {
    query: jest.fn((sql: string) => {
      statements.push(sql.replaceAll(/\s+/g, ' ').trim());

      return Promise.resolve();
    }),
  } as unknown as QueryRunner;

  await new RekeySeededStorytimeTags1799200000000()[direction](queryRunner);

  return statements;
}

const PARAM: ArgumentMetadata = { type: 'param', data: 'tagId' };

/**
 * Every seeded tag had an MD5-derived id that no UUID validator accepted, so
 * none could be saved on a Story or Arc (sc-1517). The SQL was rehearsed
 * against a real database; this holds the ids it produces and the order it
 * works in.
 */
describe('RekeySeededStorytimeTags1799200000000', () => {
  it('exports only the migration class as a function', () => {
    // TypeORM instantiates every exported function in a migration file.
    const functions = Object.entries(migrationModule)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name);

    expect(functions).toEqual(['RekeySeededStorytimeTags1799200000000']);
  });

  it('reads the whole seeded vocabulary', () => {
    expect(SEEDED).toHaveLength(124);
  });

  it('starts from ids that the tag validator refuses', () => {
    for (const { seededId } of SEEDED) {
      expect(isUUID(seededId, '4')).toBe(false);
    }
  });

  it('gives every seeded tag a version 4 id that both validators accept', async () => {
    const pipe = new ParseUUIDPipe();

    for (const { liveId } of SEEDED) {
      expect(isUUID(liveId, '4')).toBe(true);
      expect(new RegExp(VERSION_FOUR_UUID_PATTERN).test(liveId)).toBe(true);
      await expect(pipe.transform(liveId, PARAM)).resolves.toBe(liveId);
    }
  });

  it('changes only the version and variant digits', () => {
    for (const { seededId, liveId } of SEEDED) {
      const changed = [...seededId]
        .map((digit, index) => (digit === liveId[index] ? -1 : index))
        .filter(index => index >= 0);

      expect(changed.every(index => index === 14 || index === 19)).toBe(true);
    }
  });

  it('keeps every new id distinct', () => {
    expect(new Set(SEEDED.map(tag => tag.liveId)).size).toBe(SEEDED.length);
  });

  it('leaves an id that is already version 4 as it was', () => {
    const id = '6f3d2a1b-8c4e-4f5a-9b6c-7d8e9f0a1b2c';

    expect(toVersionFourId(id)).toBe(id);
  });

  it('re-keys links and tags with their foreign keys lifted, then adds the check', async () => {
    const statements = await capture('up');
    const count = TAG_LINK_TABLES.length;

    expect(statements).toHaveLength(count * 3 + 2);
    TAG_LINK_TABLES.forEach((table, index) => {
      expect(statements[index]).toBe(
        `ALTER TABLE "sto_info_app"."${table}" DROP CONSTRAINT "FK_${table}_tag"`,
      );
      expect(statements[count + index]).toContain(
        `UPDATE "sto_info_app"."${table}" AS "link"`,
      );
      expect(statements[count * 2 + 1 + index]).toBe(
        `ALTER TABLE "sto_info_app"."${table}" ADD CONSTRAINT "FK_${table}_tag" FOREIGN KEY ("tagId") REFERENCES "sto_info_app"."storytime_tag" ("id") ON DELETE CASCADE`,
      );
    });
    expect(statements[count * 2]).toContain(
      `UPDATE "sto_info_app"."storytime_tag" AS "tag"`,
    );
    expect(statements[statements.length - 1]).toBe(
      `ALTER TABLE "sto_info_app"."storytime_tag" ADD CONSTRAINT "${TAG_ID_VERSION_CHECK}" CHECK ("id"::text ~ '${VERSION_FOUR_UUID_PATTERN}')`,
    );
  });

  it('touches only rows that still carry the id the seed gave them', async () => {
    const updates = (await capture('up')).filter(sql =>
      sql.startsWith('UPDATE'),
    );

    expect(updates).toHaveLength(TAG_LINK_TABLES.length + 1);
    for (const update of updates) {
      expect(update).toContain(IS_SEEDED_ROW);
    }
  });

  it('re-keys with the same digits as the TypeScript twin', async () => {
    const [, , , , , , tagUpdate] = await capture('up');

    expect(tagUpdate).toContain(`substr(("tag"."id")::text, 1, 14) || '4'`);
    expect(tagUpdate).toContain(`substr(("tag"."id")::text, 16, 4)`);
    expect(tagUpdate).toContain(
      `substr('89ab', (('x' || substr(("tag"."id")::text, 20, 1))::bit(4)::int & 3) + 1, 1)`,
    );
    expect(tagUpdate).toContain(`substr(("tag"."id")::text, 21)`);
  });

  it('drops the check and restores the seeded ids on the way down', async () => {
    const statements = await capture('down');
    const updates = statements.filter(sql => sql.startsWith('UPDATE'));

    expect(statements[0]).toBe(
      `ALTER TABLE "sto_info_app"."storytime_tag" DROP CONSTRAINT "${TAG_ID_VERSION_CHECK}"`,
    );
    expect(updates).toHaveLength(TAG_LINK_TABLES.length + 1);
    for (const update of updates) {
      expect(update).toContain(
        `= md5('${SEEDED_TAG_ID_NAMESPACE}' || "tag"."slug")::uuid`,
      );
    }
    expect(statements[statements.length - 1]).toContain('ADD CONSTRAINT "FK_');
  });
});

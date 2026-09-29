import { createHmac } from 'node:crypto';

import { ServiceUnavailableException } from '@nestjs/common';

import { describe, expect, it } from '@jest/globals';

import { InMemoryManager } from '../../../test/in-memory-manager';
import { ROSTER_ALLOWED_COLUMNS } from '../imports/constants/roster-csv.constants';
import { ERASED_MEMBER_NAME, pseudonymFor } from './roster-erasure.constants';
import { RosterErasureEntity } from './roster-erasure.entity';
import {
  erasedRow,
  RosterSuppressionService,
} from './roster-suppression.service';

const KEY = 'test-erasure-key';

/**
 * A sanitised row naming somebody.
 *
 * @param name - The Character name.
 * @param handle - The @handle.
 * @returns The row.
 */
const rowOf = (name: string, handle: string): string[] =>
  ROSTER_ALLOWED_COLUMNS.map((column, index) =>
    index === 0
      ? name
      : index === 1
        ? handle
        : column === 'Public Comment'
          ? 'Ask me about warp cores'
          : `value-${index}`,
  );

/**
 * A service over a list.
 *
 * @param db - The database.
 * @param key - The key, or null.
 * @returns It.
 */
const serviceOver = (
  db: InMemoryManager,
  key: string | null = KEY,
): RosterSuppressionService =>
  new RosterSuppressionService(db.asDataSource(), { value: key });

describe('RosterSuppressionService (FC-038)', () => {
  it('hashes a pair, keyed, as its normalised form', () => {
    const service = serviceOver(new InMemoryManager());
    const expected = createHmac('sha256', KEY)
      .update(JSON.stringify(['kira', '@nerys']))
      .digest('hex');

    expect(service.hashOf('Kira', ' @Nerys ')).toBe(expected);
    expect(service.hashOfNormalised('kira', '@nerys')).toBe(expected);
    expect(
      serviceOver(new InMemoryManager(), 'other').hashOf('Kira', '@nerys'),
    ).not.toBe(expected);
  });

  it('keeps a leading space, which tells two Characters apart', () => {
    const service = serviceOver(new InMemoryManager());

    expect(service.hashOf(' Kira', '@nerys')).not.toBe(
      service.hashOf('Kira', '@nerys'),
    );
  });

  it('refuses to hash without a key', () => {
    expect(() =>
      serviceOver(new InMemoryManager(), null).hashOf('Kira', '@nerys'),
    ).toThrow(ServiceUnavailableException);
  });

  it('passes every row through when nobody is erased, key or no key', async () => {
    const scrub = await serviceOver(new InMemoryManager(), null).scrubber();
    const row = rowOf('Kira', '@nerys');

    expect(scrub(row)).toEqual(row);
    expect(scrub(row)).not.toBe(row);
  });

  it('rewrites a row naming somebody erased, and nobody else’s', async () => {
    const db = new InMemoryManager();
    const service = serviceOver(db);
    const pseudonym = pseudonymFor('4f8a2c1e-0000-4000-8000-000000000001');

    db.seed(RosterErasureEntity, [
      { pairHash: service.hashOf('Kira', '@nerys'), pseudonym },
    ]);

    const scrub = await service.scrubber();
    const erased = scrub(rowOf('KIRA', '@Nerys'));

    expect(erased[0]).toBe(ERASED_MEMBER_NAME);
    expect(erased[1]).toBe(pseudonym);
    expect(erased[ROSTER_ALLOWED_COLUMNS.indexOf('Public Comment')]).toBe('');
    expect(erased[2]).toBe('value-2');
    expect(scrub(rowOf('Odo', '@constable'))).toEqual(
      rowOf('Odo', '@constable'),
    );
  });

  it('refuses to scrub, and so to import, with erasures and no key', async () => {
    const db = new InMemoryManager().seed(RosterErasureEntity, [
      { pairHash: 'a'.repeat(64), pseudonym: '@erased-000000000001' },
    ]);

    await expect(serviceOver(db, null).scrubber()).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('gives each erasure a handle of its own', () => {
    expect(pseudonymFor('4f8a2c1e-9b3d-4000-8000-000000000001')).toBe(
      '@erased-4f8a2c1e9b3d',
    );
    expect(erasedRow(rowOf('Kira', '@nerys'), '@erased-x')[1]).toBe(
      '@erased-x',
    );
  });
});

import { describe, expect, it } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ActivityQueryDto } from './activity.dto';

describe('ActivityQueryDto', () => {
  /**
   * Lists the properties a query fails on.
   *
   * @param query - What was sent.
   * @returns The failing properties.
   */
  const failures = async (query: object): Promise<string[]> =>
    (await validate(plainToInstance(ActivityQueryDto, query))).map(
      error => error.property,
    );

  it.each([
    ['no cursor', {}],
    [
      'a cursor',
      {
        before: '2026-09-28T12:00:00.000Z_29000000-0000-4000-8000-000000000001',
      },
    ],
    [
      'a cursor without milliseconds',
      { before: '2026-09-28T12:00:00Z_29000000-0000-4000-8000-000000000001' },
    ],
  ])('accepts %s', async (_label, query) => {
    await expect(failures(query)).resolves.toEqual([]);
  });

  it.each([
    ['a bare instant', '2026-09-28T12:00:00.000Z'],
    ['a bare ID', '29000000-0000-4000-8000-000000000001'],
    ['anything else', 'yesterday'],
  ])('refuses %s', async (_label, before) => {
    await expect(failures({ before })).resolves.toEqual(['before']);
  });
});

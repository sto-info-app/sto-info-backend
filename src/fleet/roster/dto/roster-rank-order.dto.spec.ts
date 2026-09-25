import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';

import {
  ROSTER_RANK_ORDER_MAX_LABELS,
  ROSTER_RANK_ORDER_REASON_MAX_LENGTH,
  UpdateRosterRankOrderDto,
} from './roster-rank-order.dto';

const VALID = {
  tiers: [['Officer'], ['Member', 'Recruit']],
  expected: [],
  reason: 'Officers outrank members',
};

/**
 * Validates a body as the global pipe would.
 *
 * @param body - The body as sent.
 * @returns What failed.
 */
async function errors(
  body: Record<string, unknown>,
): Promise<ValidationError[]> {
  return validate(plainToInstance(UpdateRosterRankOrderDto, body));
}

/**
 * Lists every message a body earns.
 *
 * @param body - The body as sent.
 * @returns Each failing property's messages.
 */
async function messages(body: Record<string, unknown>): Promise<string[]> {
  return (await errors(body)).flatMap(error =>
    Object.values(error.constraints ?? {}),
  );
}

describe('UpdateRosterRankOrderDto', () => {
  it('accepts an order, the order as loaded and a reason, trimmed', async () => {
    const dto = plainToInstance(UpdateRosterRankOrderDto, {
      ...VALID,
      reason: '  Officers outrank members  ',
    });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.reason).toBe('Officers outrank members');
  });

  it('accepts an empty order, which clears it', async () => {
    await expect(errors({ ...VALID, tiers: [] })).resolves.toEqual([]);
  });

  it.each([
    ['something that is not a list', 'Officer', 'an order is a list of tiers.'],
    [
      'an empty tier',
      [['Officer'], []],
      'each tier is a list of one or more rank labels.',
    ],
    [
      'a tier that is not a list',
      ['Officer'],
      'each tier is a list of one or more rank labels.',
    ],
    [
      'an empty label',
      [['']],
      'each rank label is text of 1 to 255 characters.',
    ],
    [
      'a label that is not text',
      [[7]],
      'each rank label is text of 1 to 255 characters.',
    ],
    [
      'a label too long for an export to have listed',
      [['x'.repeat(256)]],
      'each rank label is text of 1 to 255 characters.',
    ],
    [
      'a label placed twice',
      [['Officer'], ['Member', 'Officer']],
      '"Officer" is placed more than once.',
    ],
    [
      'more labels than a Fleet may place',
      Array.from({ length: ROSTER_RANK_ORDER_MAX_LABELS + 1 }, (_, index) => [
        `Rank ${index}`,
      ]),
      'an order places at most 255 labels.',
    ],
  ])('refuses %s, saying so once', async (_, tiers, message) => {
    await expect(messages({ ...VALID, tiers })).resolves.toEqual([
      `tiers: ${message}`,
    ]);
  });

  it('holds the order as loaded to the same rules', async () => {
    await expect(messages({ ...VALID, expected: [[]] })).resolves.toEqual([
      'expected: each tier is a list of one or more rank labels.',
    ]);
  });

  it.each([
    ['no reason', undefined, 'Say why the rank order is being changed.'],
    [
      'a reason of only spaces',
      '   ',
      'Say why the rank order is being changed.',
    ],
    ['a reason that is not text', 7, 'A reason has to be text.'],
    [
      'a reason too long',
      'x'.repeat(ROSTER_RANK_ORDER_REASON_MAX_LENGTH + 1),
      'A reason can be at most 500 characters.',
    ],
  ])('refuses %s, saying so once', async (_, reason, message) => {
    await expect(messages({ ...VALID, reason })).resolves.toEqual([message]);
  });
});

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ROSTER_CSV_LIMITS } from '../constants/roster-csv.constants';
import {
  ExcludeRosterRowsDto,
  MarkRosterImportPartialDto,
  ROSTER_IMPORT_REASON_MAX_LENGTH,
  RosterImportReasonDto,
} from './correct-roster-import.dto';

/**
 * Validates a body as the global pipe would.
 *
 * @param type - The DTO.
 * @param body - The body as sent.
 * @returns The properties that failed.
 */
async function failures<T extends object>(
  type: new () => T,
  body: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(type, body));

  return errors.map(error => error.property);
}

describe('Roster import correction DTOs', () => {
  describe('the reason every correction gives', () => {
    it('accepts a reason, trimmed', async () => {
      const dto = plainToInstance(RosterImportReasonDto, {
        reason: '  Wrong Fleet  ',
      });

      await expect(validate(dto)).resolves.toEqual([]);
      expect(dto.reason).toBe('Wrong Fleet');
    });

    it.each([
      ['no reason', {}],
      ['an empty reason', { reason: '' }],
      ['a reason of only spaces', { reason: '   ' }],
      ['a reason that is not text', { reason: 7 }],
      [
        'a reason too long',
        { reason: 'x'.repeat(ROSTER_IMPORT_REASON_MAX_LENGTH + 1) },
      ],
    ])('refuses %s', async (_case, body) => {
      await expect(failures(RosterImportReasonDto, body)).resolves.toEqual([
        'reason',
      ]);
    });

    it('tells a blank reason only that it is missing', async () => {
      const errors = await validate(
        plainToInstance(RosterImportReasonDto, { reason: '  ' }),
      );

      expect(errors.map(error => error.constraints)).toEqual([
        { isRosterImportReason: 'Say why the import is being corrected.' },
      ]);
    });

    it.each([
      [
        'x'.repeat(ROSTER_IMPORT_REASON_MAX_LENGTH + 1),
        `A reason can be at most ${ROSTER_IMPORT_REASON_MAX_LENGTH} characters.`,
      ],
      [7, 'A reason has to be text.'],
      [null, 'Say why the import is being corrected.'],
    ])('tells a reason of %p one thing', async (reason, message) => {
      const errors = await validate(
        plainToInstance(RosterImportReasonDto, { reason }),
      );

      expect(errors.map(error => error.constraints)).toEqual([
        { isRosterImportReason: message },
      ]);
    });

    it('accepts a reason at the limit', async () => {
      await expect(
        failures(RosterImportReasonDto, {
          reason: 'x'.repeat(ROSTER_IMPORT_REASON_MAX_LENGTH),
        }),
      ).resolves.toEqual([]);
    });
  });

  describe('the partial mark', () => {
    it.each([true, false])(
      'accepts partial %s with a reason',
      async partial => {
        await expect(
          failures(MarkRosterImportPartialDto, { partial, reason: 'Cut off' }),
        ).resolves.toEqual([]);
      },
    );

    it.each([
      ['missing', {}],
      ['not a boolean', { partial: 'yes' }],
    ])('refuses a mark %s', async (_case, body) => {
      await expect(
        failures(MarkRosterImportPartialDto, { reason: 'Cut off', ...body }),
      ).resolves.toEqual(['partial']);
    });

    it('still requires a reason', async () => {
      await expect(
        failures(MarkRosterImportPartialDto, { partial: true }),
      ).resolves.toEqual(['reason']);
    });
  });

  describe('row exclusion', () => {
    const valid = { lines: [2, 5], excluded: true, reason: 'Duplicated' };

    it('accepts data lines, and which way', async () => {
      await expect(failures(ExcludeRosterRowsDto, valid)).resolves.toEqual([]);
    });

    it.each([
      ['no lines', { lines: [] }],
      ['the header line', { lines: [1] }],
      ['a line twice', { lines: [2, 2] }],
      ['a line that is not a whole number', { lines: [2.5] }],
      ['lines that are not a list', { lines: 2 }],
      [
        'more lines than an export can hold',
        {
          lines: Array.from(
            { length: ROSTER_CSV_LIMITS.maxRows + 1 },
            (_value, index) => index + 2,
          ),
        },
      ],
    ])('refuses %s', async (_case, body) => {
      await expect(
        failures(ExcludeRosterRowsDto, { ...valid, ...body }),
      ).resolves.toEqual(['lines']);
    });

    it('refuses a request that does not say which way', async () => {
      await expect(
        failures(ExcludeRosterRowsDto, { lines: [2], reason: 'Duplicated' }),
      ).resolves.toEqual(['excluded']);
    });
  });
});

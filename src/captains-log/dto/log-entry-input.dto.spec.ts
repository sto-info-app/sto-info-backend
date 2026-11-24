import { describe, expect, it } from '@jest/globals';

import { validateDto } from 'src/utils/testing/dto-validation.util';

import { LogEntryType } from '../captains-log.constants';
import {
  CreateLogEntryDto,
  LogEntryQueryDto,
  RemoveLogEntryDto,
  UpdateLogEntryDto,
} from './log-entry-input.dto';

/**
 * Names the properties a validation failed on.
 *
 * @param errors - The failures.
 * @returns Their properties.
 */
const failed = (errors: { property: string }[]): string[] =>
  errors.map(error => error.property);

describe('Captain’s Log input (sc-1450)', () => {
  it('takes a new entry, trimmed, with or without a headline', async () => {
    const { dto, errors } = await validateDto(CreateLogEntryDto, {
      type: LogEntryType.CAPTAIN,
      headline: '  First contact  ',
      body: '  Hailing frequencies open.  ',
    });

    expect(errors).toEqual([]);
    expect(dto.headline).toBe('First contact');
    expect(dto.body).toBe('Hailing frequencies open.');
    expect(
      (
        await validateDto(CreateLogEntryDto, {
          type: LogEntryType.PERSONAL,
          body: 'A quiet watch.',
        })
      ).errors,
    ).toEqual([]);
  });

  it('refuses a new entry with no words, an unknown type or text too long', async () => {
    const { errors } = await validateDto(CreateLogEntryDto, {
      type: 'DIARY',
      headline: 'h'.repeat(121),
      body: '   ',
    });

    expect(failed(errors).sort()).toEqual(['body', 'headline', 'type']);
    expect(
      failed(
        (
          await validateDto(CreateLogEntryDto, {
            type: LogEntryType.CAPTAIN,
            body: 'b'.repeat(10001),
          })
        ).errors,
      ),
    ).toEqual(['body']);
  });

  it('takes a change to any part of an entry, and none at all', async () => {
    expect((await validateDto(UpdateLogEntryDto, {})).errors).toEqual([]);
    expect(
      (
        await validateDto(UpdateLogEntryDto, {
          type: LogEntryType.PERSONAL,
          headline: '',
          body: 'Revised.',
        })
      ).errors,
    ).toEqual([]);
    expect(
      failed((await validateDto(UpdateLogEntryDto, { body: ' ' })).errors),
    ).toEqual(['body']);
  });

  it('pages a list, and filters it by type', async () => {
    const { dto, errors } = await validateDto(LogEntryQueryDto, {
      type: LogEntryType.CAPTAIN,
      page: '2',
    });

    expect(errors).toEqual([]);
    expect(dto.page).toBe(2);
    expect(
      failed((await validateDto(LogEntryQueryDto, { type: 'X' })).errors),
    ).toEqual(['type']);
  });

  it('wants a reason for a removal', async () => {
    expect(
      (await validateDto(RemoveLogEntryDto, { reason: 'Spoilers' })).errors,
    ).toEqual([]);
    expect(
      failed((await validateDto(RemoveLogEntryDto, { reason: ' ' })).errors),
    ).toEqual(['reason']);
    expect(
      failed(
        (await validateDto(RemoveLogEntryDto, { reason: 'r'.repeat(501) }))
          .errors,
      ),
    ).toEqual(['reason']);
  });
});

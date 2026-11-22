import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  FLEET_FORMER_NAME_REASON_MAX_LENGTH,
  RecordFleetFormerNameDto,
  RemoveFleetFormerNameDto,
} from './fleet-former-name.dto';

const BODY = {
  exactName: ' Old Name',
  validFrom: '2025-01-01T00:00:00Z',
  validTo: '2026-01-01T00:00:00Z',
  reason: 'Renamed in game in January',
};

/**
 * Validates a body as the global pipe would.
 *
 * @param type - The DTO.
 * @param body - The body as sent.
 * @returns The properties that failed.
 */
async function failures(
  type: typeof RecordFleetFormerNameDto | typeof RemoveFleetFormerNameDto,
  body: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(type, body));

  return errors.map(error => error.property);
}

describe('RecordFleetFormerNameDto', () => {
  it('accepts a name, its interval and a reason', async () => {
    await expect(failures(RecordFleetFormerNameDto, BODY)).resolves.toEqual([]);
  });

  // Compared with filenames character for character (ADR-0003).
  it('keeps the name’s edge spaces', () => {
    expect(plainToInstance(RecordFleetFormerNameDto, BODY).exactName).toBe(
      ' Old Name',
    );
  });

  it('reads the interval as instants', () => {
    const dto = plainToInstance(RecordFleetFormerNameDto, BODY);

    expect(dto.validFrom).toEqual(new Date('2025-01-01T00:00:00Z'));
    expect(dto.validTo).toEqual(new Date('2026-01-01T00:00:00Z'));
  });

  it.each([
    ['exactName', { exactName: '' }],
    ['validFrom', { validFrom: 'not a date' }],
    ['validTo', { validTo: undefined }],
    ['reason', { reason: '   ' }],
    ['reason', { reason: 'x'.repeat(FLEET_FORMER_NAME_REASON_MAX_LENGTH + 1) }],
  ])('refuses a bad %s', async (property, change) => {
    await expect(
      failures(RecordFleetFormerNameDto, { ...BODY, ...change }),
    ).resolves.toEqual([property]);
  });
});

describe('RemoveFleetFormerNameDto', () => {
  it('accepts a reason, trimmed', async () => {
    await expect(
      failures(RemoveFleetFormerNameDto, { reason: ' Typo ' }),
    ).resolves.toEqual([]);
    expect(
      plainToInstance(RemoveFleetFormerNameDto, { reason: ' Typo ' }).reason,
    ).toBe('Typo');
  });

  it('refuses a blank one', async () => {
    await expect(
      failures(RemoveFleetFormerNameDto, { reason: ' ' }),
    ).resolves.toEqual(['reason']);
  });
});

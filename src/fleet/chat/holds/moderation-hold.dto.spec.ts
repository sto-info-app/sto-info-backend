import { describe, expect, it } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { FleetInvestigationRequestDto } from '../../governance/dto/fleet-investigation.dto';
import {
  ModerationHoldExtendDto,
  ModerationHoldPlaceDto,
  ModerationHoldReadDto,
  ModerationHoldReleaseDto,
  ModerationHoldsQueryDto,
} from './moderation-hold.dto';
import { ModerationHoldKind } from './moderation-hold.enums';

const ID = '31000000-0000-4000-8000-000000000001';

/**
 * Lists the properties a body fails on.
 *
 * @param type - The DTO.
 * @param body - What was sent.
 * @returns The failing properties.
 */
async function failures(
  type: new () => object,
  body: object,
): Promise<string[]> {
  return (await validate(plainToInstance(type, body))).map(
    error => error.property,
  );
}

describe('hold and investigation DTOs (FC-036)', () => {
  describe('ModerationHoldPlaceDto', () => {
    it('takes a report for a report hold, and a member for a member hold', async () => {
      await expect(
        failures(ModerationHoldPlaceDto, {
          kind: ModerationHoldKind.CHAT_REPORT,
          chatReportId: ID,
          reason: ' Keep it ',
        }),
      ).resolves.toEqual([]);
      await expect(
        failures(ModerationHoldPlaceDto, {
          kind: ModerationHoldKind.MEMBER_MESSAGES,
          subjectUserId: ID,
          reason: 'Keep it',
          reviewAt: '2026-12-01T00:00:00Z',
        }),
      ).resolves.toEqual([]);
    });

    it.each([
      ['no kind', { reason: 'x' }, ['kind']],
      [
        'a report hold with no report',
        { kind: ModerationHoldKind.CHAT_REPORT, reason: 'x' },
        ['chatReportId'],
      ],
      [
        'a member hold with no member',
        { kind: ModerationHoldKind.MEMBER_MESSAGES, reason: 'x' },
        ['subjectUserId'],
      ],
      [
        'a blank reason and a date that is not one',
        {
          kind: ModerationHoldKind.MEMBER_MESSAGES,
          subjectUserId: ID,
          reason: '   ',
          reviewAt: 'soon',
        },
        ['reason', 'reviewAt'],
      ],
    ])('refuses %s', async (_case, body, properties) => {
      await expect(failures(ModerationHoldPlaceDto, body)).resolves.toEqual(
        properties,
      );
    });
  });

  it('needs a date and a reason to extend, and a reason to release', async () => {
    await expect(
      failures(ModerationHoldExtendDto, {
        reviewAt: '2026-12-01T00:00:00Z',
        reason: 'More time',
      }),
    ).resolves.toEqual([]);
    await expect(failures(ModerationHoldExtendDto, {})).resolves.toEqual([
      'reviewAt',
      'reason',
    ]);
    await expect(
      failures(ModerationHoldReleaseDto, { reason: 12 }),
    ).resolves.toEqual(['reason']);
  });

  it('needs a purpose of ten characters to read, and a real cursor', async () => {
    await expect(
      failures(ModerationHoldReadDto, {
        purpose: 'Reviewing the case',
        before: `2026-09-28T12:00:00.000Z_${ID}`,
      }),
    ).resolves.toEqual([]);
    await expect(
      failures(ModerationHoldReadDto, { purpose: ' Too short ', before: 'x' }),
    ).resolves.toEqual(['purpose', 'before']);
  });

  it('reads the active filter as a boolean', async () => {
    expect(
      plainToInstance(ModerationHoldsQueryDto, { active: 'true' }).active,
    ).toBe(true);
    expect(
      plainToInstance(ModerationHoldsQueryDto, { active: 'false' }).active,
    ).toBe(false);
    await expect(
      failures(ModerationHoldsQueryDto, { active: 'maybe' }),
    ).resolves.toEqual(['active']);
  });

  it('needs a purpose of 10 to 500 characters to look into a Fleet', async () => {
    const dto = plainToInstance(FleetInvestigationRequestDto, {
      purpose: '  Checking an import  ',
    });

    expect(dto.purpose).toBe('Checking an import');
    await expect(validate(dto)).resolves.toEqual([]);
    await expect(
      failures(FleetInvestigationRequestDto, { purpose: 'Short' }),
    ).resolves.toEqual(['purpose']);
    await expect(
      failures(FleetInvestigationRequestDto, { purpose: 42 }),
    ).resolves.toEqual(['purpose']);
  });
});

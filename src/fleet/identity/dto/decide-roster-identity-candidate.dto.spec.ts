import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { RosterIdentityDecisionAction } from '../enums/roster-identity-decision-action.enum';
import {
  DecideRosterIdentityCandidateDto,
  ROSTER_IDENTITY_REASON_MAX_LENGTH,
} from './decide-roster-identity-candidate.dto';

/**
 * Validates a body as the global pipe would.
 *
 * @param body - The body as sent.
 * @returns The properties that failed.
 */
async function failures(body: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(
    plainToInstance(DecideRosterIdentityCandidateDto, body),
  );

  return errors.map(error => error.property);
}

describe('DecideRosterIdentityCandidateDto', () => {
  it.each([
    RosterIdentityDecisionAction.CONFIRM,
    RosterIdentityDecisionAction.REJECT,
  ])('accepts %s without a reason', async action => {
    await expect(failures({ action, revision: 0 })).resolves.toEqual([]);
  });

  it('accepts a reason given with a confirmation', async () => {
    await expect(
      failures({
        action: RosterIdentityDecisionAction.CONFIRM,
        revision: 0,
        reason: 'Same class, same join, same account',
      }),
    ).resolves.toEqual([]);
  });

  // Undoing overturns somebody's decision, so it has to say why.
  it.each([
    ['no reason', undefined],
    ['an empty reason', ''],
    ['a reason that is only spaces', '   '],
  ])('refuses an undo with %s', async (_case, reason) => {
    await expect(
      failures({
        action: RosterIdentityDecisionAction.UNDO,
        revision: 1,
        reason,
      }),
    ).resolves.toEqual(['reason']);
  });

  it('accepts an undo that says why, trimmed', async () => {
    const dto = plainToInstance(DecideRosterIdentityCandidateDto, {
      action: RosterIdentityDecisionAction.UNDO,
      revision: 1,
      reason: '  Two different people  ',
    });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.reason).toBe('Two different people');
  });

  it('treats a blank reason on a confirmation as none', async () => {
    const dto = plainToInstance(DecideRosterIdentityCandidateDto, {
      action: RosterIdentityDecisionAction.CONFIRM,
      revision: 0,
      reason: '   ',
    });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.reason).toBeUndefined();
  });

  it('refuses a reason longer than the column holds', async () => {
    await expect(
      failures({
        action: RosterIdentityDecisionAction.CONFIRM,
        revision: 0,
        reason: 'x'.repeat(ROSTER_IDENTITY_REASON_MAX_LENGTH + 1),
      }),
    ).resolves.toEqual(['reason']);
  });

  it.each([
    ['an unknown action', { action: 'MERGE', revision: 0 }, 'action'],
    [
      'no revision',
      { action: RosterIdentityDecisionAction.CONFIRM },
      'revision',
    ],
    [
      'a negative revision',
      { action: RosterIdentityDecisionAction.CONFIRM, revision: -1 },
      'revision',
    ],
    [
      'a fractional revision',
      { action: RosterIdentityDecisionAction.CONFIRM, revision: 1.5 },
      'revision',
    ],
    [
      'a reason that is not text',
      { action: RosterIdentityDecisionAction.CONFIRM, revision: 0, reason: 7 },
      'reason',
    ],
  ])('refuses %s', async (_case, body, property) => {
    await expect(failures(body)).resolves.toEqual([property]);
  });
});

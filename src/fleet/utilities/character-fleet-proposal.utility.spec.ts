import {
  CharacterFleetProposalState,
  CharacterFleetProposalStatus,
} from '../enums/character-fleet-proposal-status.enum';
import { toProposalState } from './character-fleet-proposal.utility';

describe('toProposalState', () => {
  const expiresAt = new Date('2026-06-01T12:00:00.000Z');

  it.each([
    [
      CharacterFleetProposalStatus.ACCEPTED,
      CharacterFleetProposalState.ACCEPTED,
    ],
    [
      CharacterFleetProposalStatus.DECLINED,
      CharacterFleetProposalState.DECLINED,
    ],
  ])('reports %s as answered whatever the clock says', (status, state) => {
    expect(
      toProposalState({ status, expiresAt }, new Date('2030-01-01Z')),
    ).toBe(state);
  });

  it('is pending while there is time left', () => {
    expect(
      toProposalState(
        { status: CharacterFleetProposalStatus.PENDING, expiresAt },
        new Date('2026-05-31T12:00:00.000Z'),
      ),
    ).toBe(CharacterFleetProposalState.PENDING);
  });

  it('is expired once the deadline has passed', () => {
    expect(
      toProposalState(
        { status: CharacterFleetProposalStatus.PENDING, expiresAt },
        new Date('2026-06-02T12:00:00.000Z'),
      ),
    ).toBe(CharacterFleetProposalState.EXPIRED);
  });

  /**
   * The deadline itself counts as expired. Telling somebody they have until
   * noon and then accepting an answer at noon exactly is the kind of
   * difference nobody should have to hold in their head.
   */
  it('is expired at the deadline rather than after it', () => {
    expect(
      toProposalState(
        { status: CharacterFleetProposalStatus.PENDING, expiresAt },
        new Date(expiresAt),
      ),
    ).toBe(CharacterFleetProposalState.EXPIRED);
  });
});

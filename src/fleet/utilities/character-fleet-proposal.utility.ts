import { CharacterFleetProposalEntity } from '../entities/character-fleet-proposal.entity';
import {
  CharacterFleetProposalState,
  CharacterFleetProposalStatus,
} from '../enums/character-fleet-proposal-status.enum';

/**
 * What a proposal is, once the clock has had its say.
 *
 * The stored status records what a person did and nothing else, so the one
 * outcome nobody chose — running out of time — is worked out on every read
 * instead of being written by a job. A single place does the working out, so
 * that the route which refuses a late answer and the DTO which explains why
 * cannot disagree about whether a given proposal is still open.
 *
 * The boundary is inclusive of the deadline: a proposal is expired at
 * `expiresAt`, not after it. Saying "you have until noon" and accepting one at
 * noon and a millisecond is the sort of difference nobody should have to think
 * about.
 *
 * @param proposal - The proposal to read.
 * @param now - The instant to judge it at.
 * @returns What a client should be told it is.
 */
export function toProposalState(
  proposal: Pick<CharacterFleetProposalEntity, 'status' | 'expiresAt'>,
  now: Date,
): CharacterFleetProposalState {
  if (proposal.status === CharacterFleetProposalStatus.ACCEPTED) {
    return CharacterFleetProposalState.ACCEPTED;
  }

  if (proposal.status === CharacterFleetProposalStatus.DECLINED) {
    return CharacterFleetProposalState.DECLINED;
  }

  return proposal.expiresAt.getTime() <= now.getTime()
    ? CharacterFleetProposalState.EXPIRED
    : CharacterFleetProposalState.PENDING;
}

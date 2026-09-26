import { Injectable } from '@nestjs/common';

import {
  CharacterFleetMembershipDto,
  CharacterFleetProposalDto,
  CharacterFleetSummaryDto,
} from '../dto/character-fleet.dto';
import { CharacterFleetMembershipEntity } from '../entities/character-fleet-membership.entity';
import { CharacterFleetProposalEntity } from '../entities/character-fleet-proposal.entity';
import { StoFleetEntity } from '../entities/sto-fleet.entity';
import { toProposalState } from '../utilities/character-fleet-proposal.utility';
import { toPlatformSegment } from '../utilities/platform-segment.utility';

/**
 * Turns a Character's own Fleet records into the shapes a client is given.
 *
 * Every field is listed rather than spread, for the reason the Fleet mapper
 * lists its own: this shape is returned to the Character's owner, and a column
 * added to either entity later should stay private until somebody has decided
 * it is not. That matters more here than elsewhere, because the tables behind
 * these shapes hold the owner's history and the evidence somebody else's
 * roster produced about them.
 */
@Injectable()
export class CharacterFleetMapper {
  /**
   * Maps the Fleet a membership or proposal names.
   *
   * @param fleet - The Fleet, with its platform and Community loaded.
   * @returns Enough of it to recognise and to link to.
   */
  toSummaryDto(fleet: StoFleetEntity): CharacterFleetSummaryDto {
    return {
      id: fleet.id,
      exactGameName: fleet.exactGameName,
      slug: fleet.slug,
      platformName: fleet.platform.name,
      platformSegment: toPlatformSegment(fleet.platform.name),
      communityName: fleet.community?.name ?? null,
      communitySlug: fleet.community?.slug ?? null,
    };
  }

  /**
   * Maps one entry of a Character's Fleet history.
   *
   * @param membership - The membership, with its Fleet loaded.
   * @returns The membership as its owner sees it.
   */
  toMembershipDto(
    membership: CharacterFleetMembershipEntity,
  ): CharacterFleetMembershipDto {
    return {
      id: membership.id,
      characterId: membership.characterId,
      fleet: this.toSummaryDto(membership.fleet),
      validFrom: membership.validFrom,
      validTo: membership.validTo,
      source: membership.source,
      visibility: membership.visibility,
      proposalId: membership.proposalId,
      recordedAt: membership.recordedAt,
    };
  }

  /**
   * Maps a proposal, with the clock's answer rather than the stored status.
   *
   * @param proposal - The proposal, with its Fleet loaded.
   * @param now - The instant to judge the deadline at.
   * @returns The proposal as the Character's owner sees it.
   */
  toProposalDto(
    proposal: CharacterFleetProposalEntity,
    now: Date = new Date(),
  ): CharacterFleetProposalDto {
    return {
      id: proposal.id,
      characterId: proposal.characterId,
      fleet: this.toSummaryDto(proposal.fleet),
      state: toProposalState(proposal, now),
      observedAt: proposal.observedAt,
      raisedAt: proposal.raisedAt,
      expiresAt: proposal.expiresAt,
      answeredAt: proposal.answeredAt,
      fromApplication: Boolean(proposal.applicationId),
    };
  }
}

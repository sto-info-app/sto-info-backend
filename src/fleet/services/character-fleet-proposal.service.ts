import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, EntityManager } from 'typeorm';

import { CHARACTER_FLEET_PROPOSAL_EXPIRY_DAYS } from '../constants/fleet-policy.constants';
import { CharacterFleetMembershipEntity } from '../entities/character-fleet-membership.entity';
import { CharacterFleetProposalEntity } from '../entities/character-fleet-proposal.entity';
import { CharacterFleetMembershipSource } from '../enums/character-fleet-membership-source.enum';
import {
  CharacterFleetProposalState,
  CharacterFleetProposalStatus,
} from '../enums/character-fleet-proposal-status.enum';
import { FleetAudience } from '../enums/fleet-audience.enum';
import { toProposalState } from '../utilities/character-fleet-proposal.utility';
import { CharacterFleetMembershipService } from './character-fleet-membership.service';

/** Milliseconds in a day, for turning the published window into a deadline. */
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** What a Fleet is suggesting about somebody's Character. */
export interface RaiseProposalInput {
  /** The Fleet the evidence came from. */
  readonly fleetId: string;
  /** When the evidence says the association was true. */
  readonly observedAt?: Date | null;
  /** Who raised it, where a person did rather than an import. */
  readonly proposedByUserId?: string | null;
}

/** What accepting a proposal is allowed to settle. */
export interface AcceptProposalInput {
  /** Who may see the membership it opens. Private unless stated. */
  readonly visibility?: FleetAudience;
}

/**
 * Suggestions that a Character is in a Fleet, and the owner's answer.
 *
 * ADR-0002 keeps evidence, personal record and access apart, and this is the
 * door between the first two. A proposal is the only way a roster import ever
 * reaches somebody's personal history, and it only gets through when they say
 * so: {@link accept} is the sole caller that writes a membership with
 * `CONFIRMED_IMPORT`, and the database refuses that source without a proposal
 * to cite.
 *
 * ## Answering one leaves the others alone
 *
 * Two Fleets may be asking about the same Character at once. Accepting one
 * does not decline the rest, because a Character may genuinely have been in
 * both at different times and a site that tidied the others away would be
 * choosing the current Fleet on the owner's behalf — the thing FC-014's third
 * acceptance criterion exists to prevent. Each is answered on its own.
 *
 * ## The deadline is read, never swept
 *
 * A proposal past `expiresAt` is expired everywhere at once, because every
 * reader asks {@link toProposalState} rather than a column. Nothing has to run
 * for that to be true, so an outage cannot leave a lapsed proposal answerable.
 */
@Injectable()
export class CharacterFleetProposalService {
  /**
   * Creates an instance of CharacterFleetProposalService.
   *
   * @param _dataSource - The connection every answer takes its transaction on.
   * @param _membershipService - Opens the membership an acceptance produces.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _membershipService: CharacterFleetMembershipService,
  ) {}

  /**
   * Reads the proposals raised about one of the caller's Characters.
   *
   * Everything ever raised, answered or not. A declined proposal is worth
   * seeing: it explains why a Fleet the owner recognises is absent from their
   * history, and without it the only evidence of the question is its absence.
   *
   * @param characterId - The Character the proposals are about.
   * @param userId - The user asking, who must own it.
   * @returns Every live proposal, newest first.
   */
  async listForOwner(
    characterId: string,
    userId: string,
  ): Promise<CharacterFleetProposalEntity[]> {
    await this._membershipService.requireOwnedCharacter(
      this._dataSource.manager,
      characterId,
      userId,
    );

    return this._dataSource.manager.find(CharacterFleetProposalEntity, {
      where: { characterId },
      relations: { fleet: { platform: true, community: true } },
      order: { raisedAt: 'DESC' },
    });
  }

  /**
   * Raises a proposal, or returns the one already open.
   *
   * Nothing in FC-014 calls this yet. The producer is FC-018, which has the
   * identity work needed to decide when a roster row is worth asking about;
   * what is settled here is the shape of the question, so that the answer
   * built alongside it has something to be an answer to.
   *
   * Re-raising is idempotent by design rather than by catching the unique
   * index: a Fleet importing its roster weekly would otherwise ask the same
   * question every week, and fifty copies of one question is a way of making
   * sure none of them is read.
   *
   * @param characterId - The Character being asked about.
   * @param input - The Fleet, what the evidence says and who raised it.
   * @param now - The instant it is raised at.
   * @returns The pending proposal, new or already there.
   */
  async raise(
    characterId: string,
    input: RaiseProposalInput,
    now: Date = new Date(),
  ): Promise<CharacterFleetProposalEntity> {
    return this._dataSource.transaction(async manager => {
      const open = await manager.findOne(CharacterFleetProposalEntity, {
        where: {
          characterId,
          fleetId: input.fleetId,
          status: CharacterFleetProposalStatus.PENDING,
        },
      });

      if (open !== null) {
        return open;
      }

      const proposal = manager.create(CharacterFleetProposalEntity, {
        characterId,
        fleetId: input.fleetId,
        status: CharacterFleetProposalStatus.PENDING,
        observedAt: input.observedAt ?? null,
        raisedAt: now,
        expiresAt: new Date(
          now.getTime() +
            CHARACTER_FLEET_PROPOSAL_EXPIRY_DAYS * MILLISECONDS_PER_DAY,
        ),
        proposedByUserId: input.proposedByUserId ?? null,
      });

      return manager.save(CharacterFleetProposalEntity, proposal);
    });
  }

  /**
   * Accepts a proposal and records the membership it was proposing.
   *
   * Both in one transaction, over the locked Character. A proposal marked
   * accepted with no membership behind it is the worst of the failures
   * available here — the owner has answered, the question has gone, and
   * nothing in their history shows for it.
   *
   * The membership begins when the evidence says the association was true
   * rather than when the proposal was answered. An export taken in March,
   * imported in April and confirmed in May describes a Fleet somebody was in
   * from March, and dating it from the confirmation would record a join that
   * did not happen.
   *
   * @param characterId - The Character the proposal is about.
   * @param proposalId - The proposal being accepted.
   * @param userId - The user accepting, who must own the Character.
   * @param input - What the acceptance settles, such as the audience.
   * @param now - The instant it is answered at.
   * @returns The membership the acceptance opened.
   */
  async accept(
    characterId: string,
    proposalId: string,
    userId: string,
    input: AcceptProposalInput = {},
    now: Date = new Date(),
  ): Promise<CharacterFleetMembershipEntity> {
    return this._dataSource.transaction(async manager => {
      await this._membershipService.requireOwnedCharacter(
        manager,
        characterId,
        userId,
        { lock: true },
      );

      const proposal = await this._requireAnswerable(
        manager,
        characterId,
        proposalId,
        now,
      );

      proposal.status = CharacterFleetProposalStatus.ACCEPTED;
      proposal.answeredAt = now;
      proposal.answeredByUserId = userId;
      await manager.save(CharacterFleetProposalEntity, proposal);

      return this._membershipService.openWithin(
        manager,
        characterId,
        {
          fleetId: proposal.fleetId,
          validFrom: proposal.observedAt ?? now,
          visibility: input.visibility,
        },
        {
          source: CharacterFleetMembershipSource.CONFIRMED_IMPORT,
          proposalId: proposal.id,
          actorUserId: userId,
        },
      );
    });
  }

  /**
   * Declines a proposal, and only that proposal.
   *
   * @param characterId - The Character the proposal is about.
   * @param proposalId - The proposal being declined.
   * @param userId - The user declining, who must own the Character.
   * @param now - The instant it is answered at.
   * @returns The proposal as it now stands.
   */
  async decline(
    characterId: string,
    proposalId: string,
    userId: string,
    now: Date = new Date(),
  ): Promise<CharacterFleetProposalEntity> {
    return this._dataSource.transaction(async manager => {
      await this._membershipService.requireOwnedCharacter(
        manager,
        characterId,
        userId,
        { lock: true },
      );

      const proposal = await this._requireAnswerable(
        manager,
        characterId,
        proposalId,
        now,
      );

      proposal.status = CharacterFleetProposalStatus.DECLINED;
      proposal.answeredAt = now;
      proposal.answeredByUserId = userId;

      return manager.save(CharacterFleetProposalEntity, proposal);
    });
  }

  /**
   * Reads a proposal that may still be answered, or says why it may not.
   *
   * An expired one is refused with its deadline rather than reported missing,
   * because it is not missing: somebody is looking at it, and "not found"
   * would send them hunting for a bug instead of telling them what happened.
   *
   * @param manager - The transaction to read through.
   * @param characterId - The Character it must be about.
   * @param proposalId - The proposal to read.
   * @param now - The instant to judge the deadline at.
   * @returns The proposal.
   */
  private async _requireAnswerable(
    manager: EntityManager,
    characterId: string,
    proposalId: string,
    now: Date,
  ): Promise<CharacterFleetProposalEntity> {
    const proposal = await manager.findOne(CharacterFleetProposalEntity, {
      where: { id: proposalId, characterId },
      relations: { fleet: { platform: true, community: true } },
    });

    if (proposal === null) {
      throw new NotFoundException(`Proposal with ID "${proposalId}" not found`);
    }

    const state = toProposalState(proposal, now);

    if (state === CharacterFleetProposalState.EXPIRED) {
      throw new ConflictException(
        `This proposal expired on ${proposal.expiresAt.toISOString()} and ` +
          'can no longer be answered.',
      );
    }

    if (state !== CharacterFleetProposalState.PENDING) {
      throw new ConflictException(
        `This proposal has already been ${state.toLowerCase()}.`,
      );
    }

    return proposal;
  }
}

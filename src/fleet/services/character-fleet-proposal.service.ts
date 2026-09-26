import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, EntityManager } from 'typeorm';

import { AccountEntity } from 'src/sto/account/entities/account.entity';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';

import { FleetAudienceService } from '../authorisation/fleet-audience.service';
import { CHARACTER_FLEET_PROPOSAL_EXPIRY_DAYS } from '../constants/fleet-policy.constants';
import { CharacterFleetMembershipEntity } from '../entities/character-fleet-membership.entity';
import { CharacterFleetProposalEntity } from '../entities/character-fleet-proposal.entity';
import { CharacterFleetMembershipSource } from '../enums/character-fleet-membership-source.enum';
import {
  CharacterFleetProposalState,
  CharacterFleetProposalStatus,
} from '../enums/character-fleet-proposal-status.enum';
import { FleetAudience } from '../enums/fleet-audience.enum';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
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
  /** The import whose roster listed the Character, where one did. */
  readonly evidenceImportId?: string | null;
  /** The accepted application that raised it, where one did (FC-021). */
  readonly applicationId?: string | null;
}

/** What a roster import says about somebody's Character. */
export interface EvidenceProposalInput {
  /** The Fleet whose latest in-force import listed the Character. */
  readonly fleetId: string;
  /** That import. */
  readonly evidenceImportId: string;
  /** The instant its export was taken. */
  readonly observedAt: Date;
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
 * Asking again after one expired lapses it, in the same transaction as the
 * new one is raised, which is the only time the site writes a status itself.
 *
 * ## Only about a Fleet the owner could see anyway
 *
 * Anybody can register a Character under any name, so a proposal would
 * otherwise tell whoever claimed somebody else's Character that a hidden
 * Fleet lists it. Steve decided on 24 September 2026 that a proposal is
 * raised only when its owner may already view the Fleet, and that an
 * unanswered one is hidden, and cannot be answered, for as long as they
 * cannot — so a Fleet or Community narrowing its audience later hides the
 * question as well. Its deadline does not move while it is hidden.
 */
@Injectable()
export class CharacterFleetProposalService {
  /**
   * Creates an instance of CharacterFleetProposalService.
   *
   * @param _dataSource - The connection every answer takes its transaction on.
   * @param _membershipService - Opens the membership an acceptance produces.
   * @param _audienceService - Says whether an owner may see the Fleet asking.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _membershipService: CharacterFleetMembershipService,
    private readonly _audienceService: FleetAudienceService,
  ) {}

  /**
   * Reads the proposals raised about one of the caller's Characters.
   *
   * Everything ever raised, answered or not. A declined proposal is worth
   * seeing: it explains why a Fleet the owner recognises is absent from their
   * history, and without it the only evidence of the question is its absence.
   *
   * Except an unanswered one from a Fleet the owner cannot now see, which is
   * left out until they can. An answered one stays: the owner answered it
   * knowing which Fleet was asking, so showing it tells them nothing new.
   *
   * @param characterId - The Character the proposals are about.
   * @param userId - The user asking, who must own it.
   * @returns Every live proposal they may see, newest first.
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

    const proposals = await this._dataSource.manager.find(
      CharacterFleetProposalEntity,
      {
        where: { characterId },
        relations: { fleet: { platform: true, community: true } },
        order: { raisedAt: 'DESC' },
      },
    );

    // One question per Fleet, however many proposals it has raised.
    const visibility = new Map<string, Promise<boolean>>();
    const shown = await Promise.all(
      proposals.map(proposal => {
        if (!this._isUnanswered(proposal)) {
          return true;
        }

        let visible = visibility.get(proposal.fleetId);

        if (visible === undefined) {
          visible = this._canSeeFleet(proposal.fleetId, userId);
          visibility.set(proposal.fleetId, visible);
        }

        return visible;
      }),
    );

    return proposals.filter((_proposal, index) => shown[index]);
  }

  /**
   * Raises a proposal, or returns the one already open.
   *
   * Re-raising is idempotent by design rather than by catching the unique
   * index: a Fleet importing its roster weekly would otherwise ask the same
   * question every week, and fifty copies of one question is a way of making
   * sure none of them is read. An open one past its deadline is lapsed and
   * asked again — see {@link _openOrReplace}.
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
    return this._dataSource.transaction(manager =>
      this._openOrReplace(manager, characterId, input, now),
    );
  }

  /**
   * Raises a proposal inside a transaction somebody else opened.
   *
   * For an accepted application (FC-021), whose grant of membership and
   * question about the Character have to commit or fail together.
   *
   * @param manager - The transaction.
   * @param characterId - The Character being asked about.
   * @param input - The Fleet, and the application raising it.
   * @param now - The instant it is raised at.
   * @returns The pending proposal, new or already there.
   */
  async raiseWithin(
    manager: EntityManager,
    characterId: string,
    input: RaiseProposalInput,
    now: Date = new Date(),
  ): Promise<CharacterFleetProposalEntity> {
    return this._openOrReplace(manager, characterId, input, now);
  }

  /**
   * Raises a proposal from a roster import, unless there is a reason not to.
   *
   * The producer FC-018 adds. Called for each registered Character whose
   * exact name and handle the Fleet's latest in-force import lists, and
   * silent — returning null — wherever Steve decided on 24 September 2026
   * that the import should not ask:
   *
   * - the Character or its account is gone;
   * - its owner could not see the Fleet anyway;
   * - its owner has declined a proposal from this Fleet before; or
   * - its owner has recorded a membership of this Fleet, current or ended.
   *   That is their own statement about it, and once they end it an import
   *   treats it like a decline.
   *
   * Otherwise it is {@link raise}.
   *
   * The Character is locked for the checks and the write together, as an
   * answer locks it, so a decline arriving at the same moment is either seen
   * or waits.
   *
   * @param characterId - The registered Character the roster names.
   * @param input - The Fleet, the import and when its export was taken.
   * @param now - The instant it is raised at.
   * @returns The pending proposal, or null where none should be asked.
   */
  async raiseFromEvidence(
    characterId: string,
    input: EvidenceProposalInput,
    now: Date = new Date(),
  ): Promise<CharacterFleetProposalEntity | null> {
    return this._dataSource.transaction(async manager => {
      const character = await manager.findOne(CharacterEntity, {
        where: { id: characterId },
        lock: { mode: 'pessimistic_write' },
      });

      if (character === null) {
        return null;
      }

      const account = await manager.findOne(AccountEntity, {
        where: { id: character.accountId },
      });

      if (
        account === null ||
        !(await this._canSeeFleet(input.fleetId, account.userId))
      ) {
        return null;
      }

      const declined = await manager.exists(CharacterFleetProposalEntity, {
        where: {
          characterId,
          fleetId: input.fleetId,
          status: CharacterFleetProposalStatus.DECLINED,
        },
      });

      if (declined) {
        return null;
      }

      const recorded = await manager.exists(CharacterFleetMembershipEntity, {
        where: { characterId, fleetId: input.fleetId },
        withDeleted: true,
      });

      if (recorded) {
        return null;
      }

      return this._openOrReplace(
        manager,
        characterId,
        {
          fleetId: input.fleetId,
          observedAt: input.observedAt,
          evidenceImportId: input.evidenceImportId,
        },
        now,
      );
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
        userId,
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
          source: proposal.applicationId
            ? CharacterFleetMembershipSource.APPLICATION
            : CharacterFleetMembershipSource.CONFIRMED_IMPORT,
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
        userId,
        now,
      );

      proposal.status = CharacterFleetProposalStatus.DECLINED;
      proposal.answeredAt = now;
      proposal.answeredByUserId = userId;

      return manager.save(CharacterFleetProposalEntity, proposal);
    });
  }

  /**
   * Returns the open proposal, or raises one — lapsing an expired one first.
   *
   * An open proposal past its deadline was never answered, so it is marked
   * `LAPSED` and the new one names it in `replacesProposalId`, both in the
   * caller's transaction. The unique index counts only `PENDING` rows, so
   * writing the lapse first is what lets the replacement exist.
   *
   * @param manager - The transaction to write through.
   * @param characterId - The Character being asked about.
   * @param input - The Fleet, what the evidence says and who raised it.
   * @param now - The instant it is raised at.
   * @returns The pending proposal, new or already there.
   */
  private async _openOrReplace(
    manager: EntityManager,
    characterId: string,
    input: RaiseProposalInput,
    now: Date,
  ): Promise<CharacterFleetProposalEntity> {
    const open = await manager.findOne(CharacterFleetProposalEntity, {
      where: {
        characterId,
        fleetId: input.fleetId,
        status: CharacterFleetProposalStatus.PENDING,
      },
    });

    if (
      open !== null &&
      toProposalState(open, now) === CharacterFleetProposalState.PENDING
    ) {
      // An acceptance landing on a question the roster already asked makes
      // it the application's question too, so confirming it records the
      // membership as coming from the application — the stronger of the two.
      if (input.applicationId && !open.applicationId) {
        open.applicationId = input.applicationId;

        return manager.save(CharacterFleetProposalEntity, open);
      }

      return open;
    }

    if (open !== null) {
      open.status = CharacterFleetProposalStatus.LAPSED;
      await manager.save(CharacterFleetProposalEntity, open);
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
      evidenceImportId: input.evidenceImportId ?? null,
      applicationId: input.applicationId ?? null,
      replacesProposalId: open?.id ?? null,
    });

    return manager.save(CharacterFleetProposalEntity, proposal);
  }

  /**
   * Whether a proposal is still waiting on its owner, answerable or not.
   *
   * @param proposal - The proposal.
   * @returns True for a pending or lapsed one.
   */
  private _isUnanswered(proposal: CharacterFleetProposalEntity): boolean {
    return (
      proposal.status === CharacterFleetProposalStatus.PENDING ||
      proposal.status === CharacterFleetProposalStatus.LAPSED
    );
  }

  /**
   * Whether somebody may see a Fleet, by the checks its page makes.
   *
   * @param fleetId - The Fleet.
   * @param userId - Who is asking.
   * @returns True if the Fleet is visible to them.
   */
  private _canSeeFleet(fleetId: string, userId: string): Promise<boolean> {
    return this._audienceService.canViewScope(
      { kind: FleetScopeKind.FLEET, id: fleetId },
      userId,
    );
  }

  /**
   * Reads a proposal that may still be answered, or says why it may not.
   *
   * An expired one is refused with its deadline rather than reported missing,
   * because it is not missing: somebody is looking at it, and "not found"
   * would send them hunting for a bug instead of telling them what happened.
   *
   * One from a Fleet the owner cannot now see is reported missing, the same
   * as one that does not exist, so that answering cannot be used to learn
   * which Fleet it came from.
   *
   * @param manager - The transaction to read through.
   * @param characterId - The Character it must be about.
   * @param proposalId - The proposal to read.
   * @param userId - The owner answering it.
   * @param now - The instant to judge the deadline at.
   * @returns The proposal.
   */
  private async _requireAnswerable(
    manager: EntityManager,
    characterId: string,
    proposalId: string,
    userId: string,
    now: Date,
  ): Promise<CharacterFleetProposalEntity> {
    const proposal = await manager.findOne(CharacterFleetProposalEntity, {
      where: { id: proposalId, characterId },
      relations: { fleet: { platform: true, community: true } },
    });

    if (
      proposal === null ||
      (this._isUnanswered(proposal) &&
        !(await this._canSeeFleet(proposal.fleetId, userId)))
    ) {
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

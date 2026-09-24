import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, EntityManager, IsNull } from 'typeorm';

import { AccountEntity } from 'src/sto/account/entities/account.entity';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';

import { CharacterFleetMembershipEntity } from '../entities/character-fleet-membership.entity';
import { StoFleetEntity } from '../entities/sto-fleet.entity';
import { CharacterFleetMembershipSource } from '../enums/character-fleet-membership-source.enum';
import { FleetAudience } from '../enums/fleet-audience.enum';

/** What the owner is saying about their Character. */
export interface RecordCharacterFleetInput {
  /** The Fleet record they are naming. */
  readonly fleetId: string;
  /** When the association began. */
  readonly validFrom: Date;
  /** When it ended, or absent for one that has not. */
  readonly validTo?: Date | null;
  /** Who may see it. Private unless they say otherwise. */
  readonly visibility?: FleetAudience;
}

/** How a membership came to be written, for the internal opener. */
interface OpenOptions {
  /** What established it. */
  readonly source: CharacterFleetMembershipSource;
  /** The proposal it confirms, where one does. */
  readonly proposalId: string | null;
  /** Who is writing it. */
  readonly actorUserId: string;
}

/**
 * The Fleets a user says their own Characters are in.
 *
 * The middle of ADR-0002's three facts, and the only one its subject controls
 * outright. A roster import is evidence and an approved `scope_membership` is
 * access; this is neither, and nothing in either of those may write here
 * without the owner having said so.
 *
 * ## Why every write is a transaction over a locked Character
 *
 * The table holds intervals, and "these intervals do not overlap" is a
 * property of a row against the rows it is not — which no constraint can
 * express. The partial unique index catches the one case that can be stated
 * about a single row (two open intervals at once) and the rest is enforced
 * here, under `FOR UPDATE` on the Character, so two requests arriving together
 * queue instead of both passing a read that neither has invalidated yet.
 *
 * Reading the Character is also what authorises the write, so the lock costs
 * nothing extra: it is the query that was going to happen anyway.
 *
 * ## Why the ownership check is not `CharacterOwnershipService`
 *
 * That service is the right one and this module may not have it. ADR-0015
 * fixes the module direction as imports → file-assets → fleet, and
 * `CharacterModule` reaches `FileAssetsModule`, which imports this module for
 * the audience rules — so importing `CharacterModule` here would close the
 * loop. The check is therefore made against the same two columns, in the
 * transaction that has to read the Character anyway.
 *
 * ## Removal is two different acts
 *
 * Leaving a Fleet and never having been in one are different facts, and a
 * single "remove" would make one of them unrecordable. {@link leave} closes
 * the interval, so the record stays in the owner's own history as something
 * that was true; {@link retract} soft-deletes the row, for the association
 * that should never have been written at all. Neither touches what a Fleet
 * observed on its own roster, which is a separate table and not the owner's
 * to edit.
 */
@Injectable()
export class CharacterFleetMembershipService {
  /**
   * Creates an instance of CharacterFleetMembershipService.
   *
   * @param _dataSource - The connection every write takes its transaction on.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
  ) {}

  /**
   * Reads a Character's own Fleet history, newest first.
   *
   * The whole of it, current and past, because the caller is the owner and
   * this is the one view in which their history is theirs. What a Fleet's
   * admins may see is a narrower question answered elsewhere, against
   * `visibility`.
   *
   * @param characterId - The Character to read.
   * @param userId - The user asking, who must own it.
   * @returns Every live membership, latest start first.
   */
  async listForOwner(
    characterId: string,
    userId: string,
  ): Promise<CharacterFleetMembershipEntity[]> {
    await this._requireOwned(this._dataSource.manager, characterId, userId);

    return this._dataSource.manager.find(CharacterFleetMembershipEntity, {
      where: { characterId },
      relations: { fleet: { platform: true, community: true } },
      order: { validFrom: 'DESC', createdAt: 'DESC' },
    });
  }

  /**
   * Records that a Character is, or was, in a Fleet.
   *
   * A current association closes whichever one was open, in the same
   * transaction, at the instant the new one begins — FC-014's first acceptance
   * criterion. The switch is one statement pair under one lock rather than a
   * close followed by an open, because a failure between the two would leave a
   * Character in no Fleet at all and look like a departure nobody made.
   *
   * @param characterId - The Character being recorded against.
   * @param userId - The user recording it, who must own the Character.
   * @param input - The Fleet, the interval and the audience.
   * @returns The membership that was written.
   */
  async record(
    characterId: string,
    userId: string,
    input: RecordCharacterFleetInput,
  ): Promise<CharacterFleetMembershipEntity> {
    return this._dataSource.transaction(async manager => {
      await this._requireOwned(manager, characterId, userId, { lock: true });

      return this.openWithin(manager, characterId, input, {
        source: CharacterFleetMembershipSource.MANUAL,
        proposalId: null,
        actorUserId: userId,
      });
    });
  }

  /**
   * Closes the open interval, because the Character has left the Fleet.
   *
   * The record stays. Leaving a Fleet is not a retraction of having been in
   * it, and the visibility it was given stands: a membership published to that
   * Fleet's members remains visible to them as something that was true, rather
   * than disappearing on the day it stopped being current.
   *
   * @param characterId - The Character leaving.
   * @param userId - The user recording it, who must own the Character.
   * @param validTo - When it ended.
   * @returns The membership as it now stands.
   */
  async leave(
    characterId: string,
    userId: string,
    validTo: Date,
  ): Promise<CharacterFleetMembershipEntity> {
    return this._dataSource.transaction(async manager => {
      await this._requireOwned(manager, characterId, userId, { lock: true });

      const open = await manager.findOne(CharacterFleetMembershipEntity, {
        where: { characterId, validTo: IsNull() },
        relations: { fleet: { platform: true, community: true } },
      });

      if (open === null) {
        throw new NotFoundException(
          'This Character is not recorded as being in a Fleet.',
        );
      }

      if (validTo.getTime() <= open.validFrom.getTime()) {
        throw new BadRequestException(
          'A Fleet cannot be left before it was joined.',
        );
      }

      open.validTo = validTo;

      return manager.save(CharacterFleetMembershipEntity, open);
    });
  }

  /**
   * Withdraws a membership that should never have been recorded.
   *
   * The other half of removal. This one takes the row out of the history
   * rather than closing it, because a mis-click against the wrong Fleet is not
   * a thing that happened and a timeline that insists otherwise is worse than
   * one with a gap.
   *
   * A withdrawn membership does not reopen the proposal it was accepted from,
   * where there was one. The owner answered that question, and un-answering it
   * on their behalf would put it back in front of them as though they had not.
   *
   * @param characterId - The Character it was recorded against.
   * @param membershipId - The membership to withdraw.
   * @param userId - The user withdrawing it, who must own the Character.
   * @returns A promise that resolves when it is gone.
   */
  async retract(
    characterId: string,
    membershipId: string,
    userId: string,
  ): Promise<void> {
    await this._dataSource.transaction(async manager => {
      await this._requireOwned(manager, characterId, userId, { lock: true });

      const membership = await this._requireMembership(
        manager,
        characterId,
        membershipId,
      );

      await manager.softRemove(CharacterFleetMembershipEntity, membership);
    });
  }

  /**
   * Changes who may see one membership.
   *
   * Per row rather than per Character, so somebody may publish the Fleet they
   * are in now while keeping the one before it to themselves.
   *
   * @param characterId - The Character it was recorded against.
   * @param membershipId - The membership to change.
   * @param userId - The user changing it, who must own the Character.
   * @param visibility - The audience it should have.
   * @returns The membership as it now stands.
   */
  async setVisibility(
    characterId: string,
    membershipId: string,
    userId: string,
    visibility: FleetAudience,
  ): Promise<CharacterFleetMembershipEntity> {
    return this._dataSource.transaction(async manager => {
      await this._requireOwned(manager, characterId, userId, { lock: true });

      const membership = await this._requireMembership(
        manager,
        characterId,
        membershipId,
      );

      membership.visibility = visibility;

      return manager.save(CharacterFleetMembershipEntity, membership);
    });
  }

  /**
   * Opens a membership inside a transaction whose caller already holds the
   * Character lock.
   *
   * Public for the proposal service, which accepts and records in one
   * transaction so that a proposal cannot end up answered with nothing to show
   * for it. Everything this method enforces — the Fleet exists, the interval
   * is the right way round, nothing overlaps, the open one is closed — holds
   * whichever way in it is called.
   *
   * @param manager - The transaction, with the Character locked.
   * @param characterId - The Character being recorded against.
   * @param input - The Fleet, the interval and the audience.
   * @param options - What established the membership and who wrote it.
   * @returns The membership that was written, with its Fleet's platform and
   *   Community loaded.
   */
  async openWithin(
    manager: EntityManager,
    characterId: string,
    input: RecordCharacterFleetInput,
    options: OpenOptions,
  ): Promise<CharacterFleetMembershipEntity> {
    const validTo = input.validTo ?? null;

    if (validTo !== null && validTo.getTime() <= input.validFrom.getTime()) {
      throw new BadRequestException('A membership cannot end before it began.');
    }

    // Read with what the answer names: every caller hands the membership
    // straight to the mapper, which shows the Fleet's platform and Community.
    const fleet = await manager.findOne(StoFleetEntity, {
      where: { id: input.fleetId },
      relations: { platform: true, community: true },
    });

    if (fleet === null) {
      throw new NotFoundException(`Fleet with ID "${input.fleetId}" not found`);
    }

    const existing = await manager.find(CharacterFleetMembershipEntity, {
      where: { characterId },
      order: { validFrom: 'ASC' },
    });

    const open = existing.find(candidate => candidate.validTo === null) ?? null;

    this._assertNoOverlap(existing, input.validFrom, validTo, open);

    // The close and the open go in together. Doing it the other way round
    // leaves a window in which the Character is in no Fleet, and a request
    // that failed between the two would have recorded a departure nobody made.
    if (open !== null && validTo === null) {
      open.validTo = input.validFrom;
      await manager.save(CharacterFleetMembershipEntity, open);
    }

    const membership = manager.create(CharacterFleetMembershipEntity, {
      characterId,
      fleetId: input.fleetId,
      validFrom: input.validFrom,
      validTo,
      source: options.source,
      proposalId: options.proposalId,
      visibility: input.visibility ?? FleetAudience.PRIVATE,
      actorUserId: options.actorUserId,
      recordedAt: new Date(),
    });

    const written = await manager.save(
      CharacterFleetMembershipEntity,
      membership,
    );

    written.fleet = fleet;

    return written;
  }

  /**
   * Reads a Character and proves the caller owns it, optionally locking it.
   *
   * @param manager - The manager to read through.
   * @param characterId - The Character to read.
   * @param userId - The user who must own it.
   * @param options - Whether to take the write lock, which needs a transaction.
   * @returns The Character.
   */
  async requireOwnedCharacter(
    manager: EntityManager,
    characterId: string,
    userId: string,
    options: { readonly lock?: boolean } = {},
  ): Promise<CharacterEntity> {
    return this._requireOwned(manager, characterId, userId, options);
  }

  /**
   * The ownership check itself.
   *
   * The Character is read alone rather than joined to its account, because
   * `FOR UPDATE` cannot be applied across the nullable side of an outer join
   * and the lock is the point of the read. The account follows as its own
   * query, which is not locked: who owns a Character is not what two competing
   * writes are racing over.
   *
   * @param manager - The manager to read through.
   * @param characterId - The Character to read.
   * @param userId - The user who must own it.
   * @param options - Whether to take the write lock.
   * @returns The Character.
   */
  private async _requireOwned(
    manager: EntityManager,
    characterId: string,
    userId: string,
    options: { readonly lock?: boolean } = {},
  ): Promise<CharacterEntity> {
    const character = await manager.findOne(CharacterEntity, {
      where: { id: characterId },
      ...(options.lock === true
        ? { lock: { mode: 'pessimistic_write' as const } }
        : {}),
    });

    if (character === null) {
      throw new NotFoundException(
        `Character with ID "${characterId}" not found`,
      );
    }

    const account = await manager.findOne(AccountEntity, {
      where: { id: character.accountId },
    });

    if (account?.userId !== userId) {
      throw new ForbiddenException('You do not have access to this character');
    }

    return character;
  }

  /**
   * Reads one of a Character's memberships, or says it is not there.
   *
   * Matched on the Character as well as the identifier, so a membership
   * belonging to somebody else's Character is not found rather than forbidden:
   * the caller has already proved what they own, and confirming the existence
   * of a row they may not read tells them something about it.
   *
   * @param manager - The transaction to read through.
   * @param characterId - The Character it must belong to.
   * @param membershipId - The membership to read.
   * @returns The membership.
   */
  private async _requireMembership(
    manager: EntityManager,
    characterId: string,
    membershipId: string,
  ): Promise<CharacterFleetMembershipEntity> {
    const membership = await manager.findOne(CharacterFleetMembershipEntity, {
      where: { id: membershipId, characterId },
      relations: { fleet: { platform: true, community: true } },
    });

    if (membership === null) {
      throw new NotFoundException(
        `Membership with ID "${membershipId}" not found`,
      );
    }

    return membership;
  }

  /**
   * Refuses an interval that would sit on top of one already recorded.
   *
   * A Character is in one Fleet at a time, so two intervals that share an
   * instant are a contradiction rather than a detail. The open interval is
   * treated as running to infinity for the comparison, which is why recording
   * a *closed* membership that reaches past its start is refused rather than
   * quietly truncating it — the owner has said two things that cannot both be
   * true, and choosing one for them would be a guess.
   *
   * @param existing - Every live membership for the Character.
   * @param from - When the new interval begins.
   * @param to - When it ends, or null.
   * @param open - The currently open membership, if there is one.
   */
  private _assertNoOverlap(
    existing: readonly CharacterFleetMembershipEntity[],
    from: Date,
    to: Date | null,
    open: CharacterFleetMembershipEntity | null,
  ): void {
    if (open !== null && to === null) {
      if (from.getTime() <= open.validFrom.getTime()) {
        throw new BadRequestException(
          'This Character is already recorded as being in a Fleet from that ' +
            'date or later. Record when they left it first.',
        );
      }
    }

    const ends = to?.getTime() ?? Number.POSITIVE_INFINITY;
    const starts = from.getTime();

    for (const candidate of existing) {
      // The open interval is closed at `from` by the caller when a current
      // membership is being opened, so it cannot clash with one; every other
      // comparison runs it to infinity, which is what it means.
      if (candidate === open && to === null) {
        continue;
      }

      const candidateStarts = candidate.validFrom.getTime();
      const candidateEnds =
        candidate.validTo?.getTime() ?? Number.POSITIVE_INFINITY;

      if (starts < candidateEnds && candidateStarts < ends) {
        throw new BadRequestException(
          'This Character is already recorded as being in a Fleet over part ' +
            'of that period.',
        );
      }
    }
  }
}

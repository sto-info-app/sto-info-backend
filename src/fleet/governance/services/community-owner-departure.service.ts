import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, Not } from 'typeorm';

import {
  AccountDeparture,
  OwnedCommunityOutcome,
} from 'src/user/account-departure';

import { FleetCommunityEntity } from '../../entities/fleet-community.entity';
import { FleetScopeStatus } from '../../enums/fleet-scope-status.enum';
import { usernamesFor } from '../../recruitment/utilities/recruitment-names.utility';
import { OwnershipTransferService } from './ownership-transfer.service';
import { ScopeClosureService } from './scope-closure.service';

/** Why ownership moved. */
export const DEPARTURE_TRANSFER_REASON =
  'The Owner closed their STO Info account.';

/** Why a Community with nobody to take it was closed. */
export const DEPARTURE_CLOSE_REASON =
  'The Owner closed their STO Info account, and no Admin could take it ' +
  'over.';

/**
 * What an Owner closing their account does to their Communities (FC-038).
 *
 * Steve's decision of 29 September 2026: closing the account says first
 * which Communities they own and what will happen, suggesting a transfer.
 * If they close anyway, each open Community goes to its longest-serving
 * Admin whose account is open and who may own one more; one with nobody to
 * take it is closed. It all happens at closure, and is logged. A closed
 * Community stays theirs until the account is erased, when it keeps no
 * Owner.
 */
@Injectable()
export class CommunityOwnerDepartureService implements AccountDeparture {
  /**
   * Creates an instance of CommunityOwnerDepartureService.
   *
   * @param _dataSource - The database.
   * @param _transfers - Hands a Community to an Admin.
   * @param _closure - Closes one nobody can take.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _transfers: OwnershipTransferService,
    private readonly _closure: ScopeClosureService,
  ) {}

  /**
   * What would become of each open Community somebody owns.
   *
   * @param userId - The Owner.
   * @returns Each, with its outcome.
   */
  async preview(userId: string): Promise<OwnedCommunityOutcome[]> {
    const manager = this._dataSource.manager;
    const outcomes: Array<Omit<OwnedCommunityOutcome, 'toUsername'>> = [];

    for (const community of await this.openOwnedBy(userId)) {
      const toUserId = await this._transfers.successorFor(
        manager,
        community.id,
        userId,
      );

      outcomes.push(outcomeOf(community, toUserId));
    }

    return this.named(outcomes);
  }

  /**
   * Hands each open Community somebody owns to an Admin, or closes it.
   *
   * @param userId - The Owner, closing their account.
   * @returns What became of each.
   */
  async depart(userId: string): Promise<OwnedCommunityOutcome[]> {
    const outcomes: Array<Omit<OwnedCommunityOutcome, 'toUsername'>> = [];

    for (const community of await this.openOwnedBy(userId)) {
      const toUserId = await this._transfers.handToSuccessor(
        community.id,
        userId,
        DEPARTURE_TRANSFER_REASON,
      );

      if (toUserId === null) {
        await this._closure.closeCommunity(community.id, {
          actorUserId: userId,
          reason: DEPARTURE_CLOSE_REASON,
        });
      }

      outcomes.push(outcomeOf(community, toUserId));
    }

    return this.named(outcomes);
  }

  /**
   * The Communities somebody owns that are not closed, oldest first.
   *
   * @param userId - The Owner.
   * @returns Each.
   */
  private openOwnedBy(userId: string): Promise<FleetCommunityEntity[]> {
    return this._dataSource.manager.find(FleetCommunityEntity, {
      where: { ownerUserId: userId, status: Not(FleetScopeStatus.CLOSED) },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }

  /**
   * Names the Admins in some outcomes.
   *
   * @param outcomes - The outcomes.
   * @returns Them, named.
   */
  private async named(
    outcomes: ReadonlyArray<Omit<OwnedCommunityOutcome, 'toUsername'>>,
  ): Promise<OwnedCommunityOutcome[]> {
    const names = await usernamesFor(
      this._dataSource.manager,
      outcomes.map(outcome => outcome.toUserId),
    );

    return outcomes.map(outcome => ({
      ...outcome,
      toUsername:
        outcome.toUserId === null
          ? null
          : (names.get(outcome.toUserId) ?? null),
    }));
  }
}

/**
 * An outcome, before its Admin is named.
 *
 * @param community - The Community.
 * @param toUserId - The Admin it goes to, or null.
 * @returns The outcome.
 */
function outcomeOf(
  community: FleetCommunityEntity,
  toUserId: string | null,
): Omit<OwnedCommunityOutcome, 'toUsername'> {
  return {
    communityId: community.id,
    name: community.name,
    outcome: toUserId === null ? 'CLOSE' : 'TRANSFER',
    toUserId,
  };
}

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, EntityManager, IsNull, QueryFailedError } from 'typeorm';

import { NotificationSeverity } from 'src/notification/enums/notification-severity.enum';
import { NotificationTarget } from 'src/notification/enums/notification-target.enum';
import { NotificationService } from 'src/notification/notification.service';

import { FleetAuthorisationRevisionService } from '../../authorisation/fleet-authorisation-revision.service';
import { MAX_FLEET_COMMUNITIES_PER_OWNER } from '../../constants/fleet-policy.constants';
import { FleetCommunityEntity } from '../../entities/fleet-community.entity';
import { ScopeCapabilityGrantEntity } from '../../entities/scope-capability-grant.entity';
import { ScopeRoleAssignmentEntity } from '../../entities/scope-role-assignment.entity';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import { FleetScopeStatus } from '../../enums/fleet-scope-status.enum';
import { usernamesFor } from '../../recruitment/utilities/recruitment-names.utility';
import {
  CommunityDisputeViewDto,
  OwnershipStandingDto,
  OwnershipTransferDto,
} from '../dto/ownership-transfer.dto';
import { GovernancePersonDto } from '../dto/scope-governance.dto';
import { OwnershipTransferEntity } from '../entities/ownership-transfer.entity';
import {
  OwnershipTransferState,
  OwnershipTransferStatus,
} from '../enums/ownership-transfer-status.enum';
import { ScopeGovernanceActionKind } from '../enums/scope-governance-action-kind.enum';
import {
  atExactly,
  communityScope,
  requireReason,
} from '../utilities/governance-scope.utility';
import { ScopeGovernanceLogService } from './scope-governance-log.service';

/** How long an offer of ownership stays open. */
export const OWNERSHIP_OFFER_DAYS = 7;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** The trigger's wording when an owner would pass the limit. */
const OWNER_LIMIT_ERROR_FRAGMENT = 'live Fleet Communities';

/** What a former Owner's Admin role says it came from. */
export const FORMER_OWNER_REASON = 'Previously the Owner';

/**
 * Offers of a Community's ownership, and the site administrator's dispute
 * action (FC-022).
 *
 * Ownership is `fleet_community.ownerUserId`, one column, so a Community has
 * exactly one Owner before and after anything here, whatever runs at once.
 * Every change to it locks the Community row first; an acceptance and a
 * cancellation, or an acceptance and a dispute action, are therefore taken
 * one after the other, and the second sees what the first did.
 *
 * With Steve's decisions of 27 September 2026: the Owner offers it to one of
 * the Community's Admins, who accepts or declines within seven days, and the
 * former Owner becomes an Admin. A site administrator may instead move it to
 * any of its Admins with a reason and no acceptance, and the former Owner
 * then keeps no role.
 */
@Injectable()
export class OwnershipTransferService {
  private readonly _logger = new Logger(OwnershipTransferService.name);

  /**
   * Creates an instance of OwnershipTransferService.
   *
   * @param _dataSource - The database.
   * @param _revisionService - Advertises changes to access.
   * @param _log - Records each change.
   * @param _notificationService - Tells the Admin offered.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _revisionService: FleetAuthorisationRevisionService,
    private readonly _log: ScopeGovernanceLogService,
    private readonly _notificationService: NotificationService,
  ) {}

  /**
   * Where ownership stands, for the Owner or the Admin it is offered to.
   *
   * @param communityId - The Community.
   * @param userId - Who is asking.
   * @returns The open offer, if they are party to it, and whom the Owner may
   *   offer it to.
   */
  async standing(
    communityId: string,
    userId: string,
  ): Promise<OwnershipStandingDto> {
    const manager = this._dataSource.manager;
    const community = await this.findCommunity(manager, communityId);
    const open = await this.openOffer(manager, communityId);
    const isOwner = community.ownerUserId === userId;
    const shown =
      open !== null &&
      stateOf(open, new Date()) === OwnershipTransferState.PENDING &&
      (isOwner || open.toUserId === userId);

    return {
      offer: shown ? await this.toDto(manager, open) : null,
      eligible: isOwner ? await this.admins(manager, communityId) : [],
    };
  }

  /**
   * Offers the Community to one of its Admins.
   *
   * An expired offer still marked open is lapsed first, which frees the slot.
   *
   * @param communityId - The Community.
   * @param toUserId - The Admin.
   * @param actorUserId - The Owner.
   * @returns The offer.
   * @throws ForbiddenException when the caller is not the Owner.
   * @throws BadRequestException when the person is not an Admin here.
   * @throws ConflictException when an offer is already open.
   */
  async offer(
    communityId: string,
    toUserId: string,
    actorUserId: string,
  ): Promise<OwnershipTransferDto> {
    const now = new Date();
    const { offer, community } = await this._dataSource.transaction(
      async manager => {
        const community = await this.lockCommunity(manager, communityId);

        if (community.ownerUserId !== actorUserId) {
          throw new ForbiddenException('Only the Owner can offer ownership.');
        }

        this.assertActive(community);

        if (!(await this.isAdmin(manager, communityId, toUserId))) {
          throw new BadRequestException(
            'Ownership can only be offered to one of the Community’s Admins.',
          );
        }

        const open = await this.openOffer(manager, communityId);

        if (
          open !== null &&
          stateOf(open, now) === OwnershipTransferState.PENDING
        ) {
          throw new ConflictException(
            'An offer is already open. Cancel it before making another.',
          );
        }

        if (open !== null) {
          open.status = OwnershipTransferStatus.LAPSED;
          open.answeredAt = now;
          await manager.save(OwnershipTransferEntity, open);
        }

        const offer = await manager.save(
          OwnershipTransferEntity,
          manager.create(OwnershipTransferEntity, {
            communityId,
            fromUserId: actorUserId,
            toUserId,
            status: OwnershipTransferStatus.PENDING,
            offeredAt: now,
            expiresAt: new Date(
              now.getTime() + OWNERSHIP_OFFER_DAYS * MILLISECONDS_PER_DAY,
            ),
            answeredAt: null,
          }),
        );

        await this._log.record(manager, {
          scope: communityScope(communityId),
          action: ScopeGovernanceActionKind.OWNERSHIP_OFFERED,
          actorUserId,
          subjectUserId: toUserId,
          transferId: offer.id,
        });

        return { offer, community };
      },
    );

    this._logger.log(
      `[offer] Ownership offered - CommunityId: ${communityId}, ` +
        `TransferId: ${offer.id}`,
    );
    await this.notifyOffered(offer, community, actorUserId);

    return this.toDto(this._dataSource.manager, offer);
  }

  /**
   * Takes an open offer back.
   *
   * @param communityId - The Community.
   * @param transferId - The offer.
   * @param actorUserId - The Owner.
   * @throws NotFoundException when there is no such open offer.
   * @throws ForbiddenException when the caller is not the Owner.
   */
  async cancel(
    communityId: string,
    transferId: string,
    actorUserId: string,
  ): Promise<void> {
    await this._dataSource.transaction(async manager => {
      const community = await this.lockCommunity(manager, communityId);
      const offer = await this.requireOpen(manager, communityId, transferId);

      if (community.ownerUserId !== actorUserId) {
        throw new ForbiddenException('Only the Owner can cancel the offer.');
      }

      await this.close(manager, offer, OwnershipTransferStatus.CANCELLED, {
        action: ScopeGovernanceActionKind.OWNERSHIP_CANCELLED,
        actorUserId,
      });
    });
  }

  /**
   * Declines an offer made to the caller.
   *
   * @param communityId - The Community.
   * @param transferId - The offer.
   * @param actorUserId - The Admin offered it.
   * @throws NotFoundException when there is no such open offer to them.
   */
  async decline(
    communityId: string,
    transferId: string,
    actorUserId: string,
  ): Promise<void> {
    await this._dataSource.transaction(async manager => {
      await this.lockCommunity(manager, communityId);
      const offer = await this.requireOpen(
        manager,
        communityId,
        transferId,
        actorUserId,
      );

      await this.close(manager, offer, OwnershipTransferStatus.DECLINED, {
        action: ScopeGovernanceActionKind.OWNERSHIP_DECLINED,
        actorUserId,
      });
    });
  }

  /**
   * Accepts an offer made to the caller, who becomes the Owner.
   *
   * The former Owner becomes an Admin. Whatever roles and personal grants or
   * denials the new Owner held anywhere in the Community end, because an
   * Owner holds everything and a denial left behind would still take a
   * power from them.
   *
   * @param communityId - The Community.
   * @param transferId - The offer.
   * @param actorUserId - The Admin offered it.
   * @throws NotFoundException when there is no such open offer to them.
   * @throws ConflictException when the Community closed, its ownership moved,
   *   they are no longer an Admin, or they own the most Communities allowed.
   */
  async accept(
    communityId: string,
    transferId: string,
    actorUserId: string,
  ): Promise<void> {
    await this._dataSource.transaction(async manager => {
      const community = await this.lockCommunity(manager, communityId);
      const offer = await this.requireOpen(
        manager,
        communityId,
        transferId,
        actorUserId,
      );
      const now = new Date();

      this.assertActive(community);

      if (community.ownerUserId !== offer.fromUserId) {
        throw new ConflictException(
          'Ownership has changed since this was offered.',
        );
      }

      if (!(await this.isAdmin(manager, communityId, actorUserId))) {
        throw new ConflictException(
          'You are no longer an Admin here, so the offer cannot be accepted.',
        );
      }

      const formerOwnerId = community.ownerUserId;

      await this.handOver(manager, community, actorUserId, now);

      await manager.save(
        ScopeRoleAssignmentEntity,
        manager.create(ScopeRoleAssignmentEntity, {
          communityId,
          fleetId: null,
          armadaId: null,
          userId: formerOwnerId,
          role: FleetScopeRole.ADMIN,
          validFrom: now,
          grantedByUserId: actorUserId,
          reason: FORMER_OWNER_REASON,
        }),
      );

      await this.close(manager, offer, OwnershipTransferStatus.ACCEPTED, {
        action: ScopeGovernanceActionKind.OWNERSHIP_ACCEPTED,
        actorUserId,
        subjectUserId: formerOwnerId,
      });
      await this._log.record(manager, {
        scope: communityScope(communityId),
        action: ScopeGovernanceActionKind.ROLE_ASSIGNED,
        actorUserId,
        subjectUserId: formerOwnerId,
        role: FleetScopeRole.ADMIN,
        reason: FORMER_OWNER_REASON,
      });

      await this._revisionService.bump(
        FleetScopeKind.COMMUNITY,
        communityId,
        manager,
      );
    });

    this._logger.log(
      `[accept] Ownership transferred - CommunityId: ${communityId}, ` +
        `TransferId: ${transferId}`,
    );
  }

  /**
   * Cancels the open offer, if there is one, in somebody else's transaction.
   *
   * For a change that means it can no longer be kept: the Admin losing the
   * role, the Community closing, or a site administrator moving ownership.
   *
   * @param manager - The transaction.
   * @param communityId - The Community.
   * @param entry - Who is making the change, whether as a site
   *   administrator, and, when given, the only Admin whose offer to cancel.
   * @param entry.actorUserId - Who is making the change.
   * @param entry.asSiteAdmin - Whether a site administrator is.
   * @param entry.onlyTo - Cancel only an offer to this person.
   */
  async cancelOpenWithin(
    manager: EntityManager,
    communityId: string,
    entry: {
      readonly actorUserId: string;
      readonly asSiteAdmin?: boolean;
      readonly onlyTo?: string;
    },
  ): Promise<void> {
    const open = await this.openOffer(manager, communityId);

    if (
      open === null ||
      (entry.onlyTo !== undefined && open.toUserId !== entry.onlyTo)
    ) {
      return;
    }

    await this.close(manager, open, OwnershipTransferStatus.CANCELLED, {
      action: ScopeGovernanceActionKind.OWNERSHIP_CANCELLED,
      actorUserId: entry.actorUserId,
      asSiteAdmin: entry.asSiteAdmin,
    });
  }

  /**
   * Describes a Community for a site administrator's dispute action.
   *
   * @param communityId - The Community.
   * @returns Its Owner, its Admins and any open offer.
   */
  async disputeView(communityId: string): Promise<CommunityDisputeViewDto> {
    const manager = this._dataSource.manager;
    const community = await this.findCommunity(manager, communityId);
    const open = await this.openOffer(manager, communityId);
    const names = await usernamesFor(manager, [community.ownerUserId]);

    return {
      communityId: community.id,
      name: community.name,
      status: community.status,
      owner: {
        userId: community.ownerUserId,
        username: names.get(community.ownerUserId) ?? null,
      },
      admins: await this.admins(manager, communityId),
      offer:
        open !== null &&
        stateOf(open, new Date()) === OwnershipTransferState.PENDING
          ? await this.toDto(manager, open)
          : null,
    };
  }

  /**
   * Moves ownership in a dispute, with a reason and no acceptance.
   *
   * The former Owner keeps no role; the new Owner may appoint them later.
   *
   * @param communityId - The Community.
   * @param toUserId - The Admin who becomes the Owner.
   * @param reason - Why.
   * @param siteAdminUserId - The site administrator.
   * @throws BadRequestException when there is no reason, or the person is not
   *   an Admin here.
   * @throws ConflictException when they own the most Communities allowed.
   */
  async reassign(
    communityId: string,
    toUserId: string,
    reason: string,
    siteAdminUserId: string,
  ): Promise<void> {
    const why = requireReason(reason, 'Say why ownership is being moved.');

    await this._dataSource.transaction(async manager => {
      const community = await this.lockCommunity(manager, communityId);

      if (!(await this.isAdmin(manager, communityId, toUserId))) {
        throw new BadRequestException(
          'Ownership can only be moved to one of the Community’s Admins.',
        );
      }

      await this.cancelOpenWithin(manager, communityId, {
        actorUserId: siteAdminUserId,
        asSiteAdmin: true,
      });
      await this.handOver(manager, community, toUserId, new Date());
      await this._log.record(manager, {
        scope: communityScope(communityId),
        action: ScopeGovernanceActionKind.OWNERSHIP_REASSIGNED,
        actorUserId: siteAdminUserId,
        asSiteAdmin: true,
        subjectUserId: toUserId,
        reason: why,
      });
      await this._revisionService.bump(
        FleetScopeKind.COMMUNITY,
        communityId,
        manager,
      );
    });

    this._logger.log(
      `[reassign] Ownership moved by a site administrator - ` +
        `CommunityId: ${communityId}`,
    );
  }

  /**
   * Makes somebody the Owner, ending what they held before.
   *
   * @param manager - The transaction.
   * @param community - The Community, locked.
   * @param newOwnerId - Who becomes the Owner.
   * @param now - When.
   * @throws ConflictException when they own the most Communities allowed.
   */
  private async handOver(
    manager: EntityManager,
    community: FleetCommunityEntity,
    newOwnerId: string,
    now: Date,
  ): Promise<void> {
    await manager.update(
      ScopeRoleAssignmentEntity,
      { communityId: community.id, userId: newOwnerId, validTo: IsNull() },
      { validTo: now },
    );
    await manager.update(
      ScopeCapabilityGrantEntity,
      {
        communityId: community.id,
        subjectUserId: newOwnerId,
        validTo: IsNull(),
      },
      { validTo: now },
    );

    community.ownerUserId = newOwnerId;

    try {
      await manager.save(FleetCommunityEntity, community);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        error.message.includes(OWNER_LIMIT_ERROR_FRAGMENT)
      ) {
        throw new ConflictException(
          `They already own ${MAX_FLEET_COMMUNITIES_PER_OWNER} Fleet Communities, the most anybody may.`,
        );
      }

      throw error;
    }
  }

  /**
   * Answers an open offer and records it.
   *
   * @param manager - The transaction.
   * @param offer - The offer.
   * @param status - The answer.
   * @param entry - What to record.
   * @param entry.action - The logged action.
   * @param entry.actorUserId - Who.
   * @param entry.asSiteAdmin - Whether a site administrator.
   * @param entry.subjectUserId - Who it was about, when not the Admin offered.
   */
  private async close(
    manager: EntityManager,
    offer: OwnershipTransferEntity,
    status: OwnershipTransferStatus,
    entry: {
      readonly action: ScopeGovernanceActionKind;
      readonly actorUserId: string;
      readonly asSiteAdmin?: boolean;
      readonly subjectUserId?: string | null;
    },
  ): Promise<void> {
    offer.status = status;
    offer.answeredAt = new Date();
    await manager.save(OwnershipTransferEntity, offer);

    await this._log.record(manager, {
      scope: communityScope(offer.communityId),
      action: entry.action,
      actorUserId: entry.actorUserId,
      asSiteAdmin: entry.asSiteAdmin,
      subjectUserId: entry.subjectUserId ?? offer.toUserId,
      transferId: offer.id,
    });
  }

  /**
   * Reads an offer that may still be answered.
   *
   * @param manager - The transaction.
   * @param communityId - The Community it must be for.
   * @param transferId - The offer.
   * @param toUserId - The Admin it must be to, when the caller is them.
   * @returns The offer, locked.
   * @throws NotFoundException when there is no such offer, or not to them.
   * @throws ConflictException when it has been answered or has expired.
   */
  private async requireOpen(
    manager: EntityManager,
    communityId: string,
    transferId: string,
    toUserId?: string,
  ): Promise<OwnershipTransferEntity> {
    const offer = await manager.findOne(OwnershipTransferEntity, {
      where: { id: transferId, communityId },
      lock: { mode: 'pessimistic_write' },
    });

    if (
      offer === null ||
      (toUserId !== undefined && offer.toUserId !== toUserId)
    ) {
      throw new NotFoundException('Not found');
    }

    const state = stateOf(offer, new Date());

    if (state === OwnershipTransferState.EXPIRED) {
      throw new ConflictException('This offer has expired.');
    }

    if (state !== OwnershipTransferState.PENDING) {
      throw new ConflictException(
        `This offer has already been ${state.toLowerCase()}.`,
      );
    }

    return offer;
  }

  /**
   * Refuses a change to a Community that is not open.
   *
   * @param community - The Community.
   * @throws ConflictException when it is suspended or closed.
   */
  private assertActive(community: FleetCommunityEntity): void {
    if (community.status !== FleetScopeStatus.ACTIVE) {
      throw new ConflictException(
        'Ownership of a closed or suspended Community cannot change hands.',
      );
    }
  }

  /**
   * Whether somebody holds Admin at the Community itself.
   *
   * @param manager - The manager.
   * @param communityId - The Community.
   * @param userId - Who.
   * @returns True when they do.
   */
  private isAdmin(
    manager: EntityManager,
    communityId: string,
    userId: string,
  ): Promise<boolean> {
    return manager.exists(ScopeRoleAssignmentEntity, {
      where: {
        ...atExactly<ScopeRoleAssignmentEntity>(communityScope(communityId)),
        userId,
        role: FleetScopeRole.ADMIN,
        validTo: IsNull(),
      },
    });
  }

  /**
   * The Community's own Admins.
   *
   * @param manager - The manager.
   * @param communityId - The Community.
   * @returns Each, by username.
   */
  private async admins(
    manager: EntityManager,
    communityId: string,
  ): Promise<GovernancePersonDto[]> {
    const rows = await manager.find(ScopeRoleAssignmentEntity, {
      where: {
        ...atExactly<ScopeRoleAssignmentEntity>(communityScope(communityId)),
        role: FleetScopeRole.ADMIN,
        validTo: IsNull(),
      },
      order: { validFrom: 'ASC' },
    });
    const names = await usernamesFor(
      manager,
      rows.map(row => row.userId),
    );

    return rows.map(row => ({
      userId: row.userId,
      username: names.get(row.userId) ?? null,
    }));
  }

  /**
   * The offer marked open, which may have expired.
   *
   * @param manager - The manager.
   * @param communityId - The Community.
   * @returns The offer, or null.
   */
  private openOffer(
    manager: EntityManager,
    communityId: string,
  ): Promise<OwnershipTransferEntity | null> {
    return manager.findOne(OwnershipTransferEntity, {
      where: { communityId, status: OwnershipTransferStatus.PENDING },
    });
  }

  /**
   * Reads a Community.
   *
   * @param manager - The manager.
   * @param communityId - The Community.
   * @returns It.
   * @throws NotFoundException when there is none.
   */
  private async findCommunity(
    manager: EntityManager,
    communityId: string,
  ): Promise<FleetCommunityEntity> {
    const community = await manager.findOne(FleetCommunityEntity, {
      where: { id: communityId },
    });

    if (community === null) {
      throw new NotFoundException('Not found');
    }

    return community;
  }

  /**
   * Reads a Community and locks it for the rest of the transaction.
   *
   * @param manager - The transaction.
   * @param communityId - The Community.
   * @returns It.
   * @throws NotFoundException when there is none.
   */
  private async lockCommunity(
    manager: EntityManager,
    communityId: string,
  ): Promise<FleetCommunityEntity> {
    const community = await manager.findOne(FleetCommunityEntity, {
      where: { id: communityId },
      lock: { mode: 'pessimistic_write' },
    });

    if (community === null) {
      throw new NotFoundException('Not found');
    }

    return community;
  }

  /**
   * Describes an offer.
   *
   * @param manager - The manager.
   * @param offer - The offer.
   * @returns It, with both parties named.
   */
  private async toDto(
    manager: EntityManager,
    offer: OwnershipTransferEntity,
  ): Promise<OwnershipTransferDto> {
    const names = await usernamesFor(manager, [
      offer.fromUserId,
      offer.toUserId,
    ]);
    const person = (userId: string | null): GovernancePersonDto => ({
      userId: userId ?? '',
      username: userId === null ? null : (names.get(userId) ?? null),
    });

    return {
      id: offer.id,
      from: person(offer.fromUserId),
      to: person(offer.toUserId),
      state: stateOf(offer, new Date()),
      offeredAt: offer.offeredAt,
      expiresAt: offer.expiresAt,
      answeredAt: offer.answeredAt,
    };
  }

  /**
   * Tells the Admin offered, after the offer is committed.
   *
   * A notification that fails to send does not undo the offer: it is on the
   * Community's page either way.
   *
   * @param offer - The offer.
   * @param community - The Community.
   * @param ownerUserId - The Owner who made it.
   */
  private async notifyOffered(
    offer: OwnershipTransferEntity,
    community: FleetCommunityEntity,
    ownerUserId: string,
  ): Promise<void> {
    const frontendUrl = process.env.APP_FRONTEND_URL;
    const names = await usernamesFor(this._dataSource.manager, [ownerUserId]);
    const from = names.get(ownerUserId) ?? 'Its Owner';

    try {
      await this._notificationService.createNotification({
        target: NotificationTarget.USER,
        userId: offer.toUserId as string,
        severity: NotificationSeverity.INFO,
        title: `Ownership of ${community.name} offered to you`,
        body:
          `${from} has offered you ownership of ${community.name}. Accept ` +
          `or decline it on the Community’s page within ` +
          `${OWNERSHIP_OFFER_DAYS} days.`,
        ...(frontendUrl
          ? { linkUrl: `${frontendUrl}/fleets/communities/${community.slug}` }
          : {}),
      });
    } catch (error) {
      this._logger.warn(
        `[notifyOffered] The notification was not sent - TransferId: ` +
          `${offer.id}, Reason: ${(error as Error).name}`,
      );
    }
  }
}

/**
 * Where an offer stands, the clock included.
 *
 * @param offer - The offer.
 * @param now - When.
 * @returns Its state.
 */
export function stateOf(
  offer: Pick<OwnershipTransferEntity, 'status' | 'expiresAt'>,
  now: Date,
): OwnershipTransferState {
  switch (offer.status) {
    case OwnershipTransferStatus.PENDING:
      return offer.expiresAt.getTime() <= now.getTime()
        ? OwnershipTransferState.EXPIRED
        : OwnershipTransferState.PENDING;
    case OwnershipTransferStatus.LAPSED:
      return OwnershipTransferState.EXPIRED;
    case OwnershipTransferStatus.ACCEPTED:
      return OwnershipTransferState.ACCEPTED;
    case OwnershipTransferStatus.DECLINED:
      return OwnershipTransferState.DECLINED;
    case OwnershipTransferStatus.CANCELLED:
      return OwnershipTransferState.CANCELLED;
  }
}

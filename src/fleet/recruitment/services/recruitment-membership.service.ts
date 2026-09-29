import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, EntityManager, In, IsNull } from 'typeorm';

import { NotificationSeverity } from 'src/notification/enums/notification-severity.enum';
import { NotificationTarget } from 'src/notification/enums/notification-target.enum';
import { NotificationService } from 'src/notification/notification.service';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';

import { ActivityType } from '../../activity/enums/activity.enums';
import { recordActivity } from '../../activity/utilities/record-activity.utility';
import {
  endIneligibleArmadaRoles,
  openPlacementOf,
} from '../../armadas/utilities/armada-arrangement.utility';
import { FleetAuthorisationRevisionService } from '../../authorisation/fleet-authorisation-revision.service';
import { CharacterFleetMembershipEntity } from '../../entities/character-fleet-membership.entity';
import { ScopeMembershipEntity } from '../../entities/scope-membership.entity';
import { ScopeRoleAssignmentEntity } from '../../entities/scope-role-assignment.entity';
import { StoArmadaEntity } from '../../entities/sto-armada.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { ScopeMembershipStatus } from '../../enums/scope-membership-status.enum';
import { endAndLog } from '../../governance/utilities/governance-endings.utility';
import { CharacterFleetProposalService } from '../../services/character-fleet-proposal.service';
import { FleetMemberDto } from '../dto/fleet-member.dto';
import { FleetApplicationEntity } from '../entities/fleet-application.entity';
import { ScopeMembershipActionEntity } from '../entities/scope-membership-action.entity';
import { ScopeMembershipActionKind } from '../enums/scope-membership-action-kind.enum';
import { usernamesFor } from '../utilities/recruitment-names.utility';

/** What granting a membership needs to know. */
export interface GrantMembershipInput {
  /** The Fleet. */
  readonly fleet: StoFleetEntity;
  /** Who becomes a member. */
  readonly userId: string;
  /** The Character they came in with, which is asked about afterwards. */
  readonly characterId: string;
  /** The application that records how. */
  readonly applicationId: string;
  /** Who granted it, or null for an OPEN Fleet's join. */
  readonly actorUserId: string | null;
  /** When. */
  readonly now: Date;
}

/**
 * The Fleet memberships recruitment grants, and their ends (FC-021).
 *
 * A membership is the access grant itself (ADR-0002). Granting one also asks
 * the member, by a proposal, to confirm their Character's Fleet once the
 * in-game invitation has happened, which STO Info cannot do for them; ending
 * the membership before they answer takes that question back. Every
 * grant, departure, removal, suspension and reinstatement is logged in
 * `scope_membership_action` and advances the Fleet's authorisation revision
 * in the same transaction.
 *
 * Suspension (FC-036, Steve's decision of 29 September 2026) keeps the
 * membership but takes every right it gives, as if they were not a member,
 * until reinstated. Its admins see why; the member is told, never why.
 */
/** Why a member's roles and grants ended as they left (FC-039). */
export const ENDED_BY_LEAVING = 'Ended when they left the Fleet.';

/** Why a member's roles and grants ended as they were removed (FC-039). */
export const ENDED_BY_REMOVAL = 'Ended when they were removed from the Fleet.';

@Injectable()
export class RecruitmentMembershipService {
  private readonly _logger = new Logger(RecruitmentMembershipService.name);

  /**
   * Creates an instance of RecruitmentMembershipService.
   *
   * @param _dataSource - The database.
   * @param _revisionService - Advertises changes to access.
   * @param _proposalService - Asks the member about their Character.
   * @param _notifications - Tells a member they were suspended or
   *   reinstated.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _revisionService: FleetAuthorisationRevisionService,
    private readonly _proposalService: CharacterFleetProposalService,
    private readonly _notifications: NotificationService,
  ) {}

  /**
   * Refuses somebody who may not become a member now.
   *
   * @param manager - The transaction to read in.
   * @param fleetId - The Fleet.
   * @param userId - Who wants to join.
   * @throws ConflictException when they are a member already.
   * @throws ForbiddenException when their membership is suspended.
   */
  async assertMayJoin(
    manager: EntityManager,
    fleetId: string,
    userId: string,
  ): Promise<void> {
    const existing = await manager.findOne(ScopeMembershipEntity, {
      where: { fleetId, userId },
    });

    assertJoinable(existing);
  }

  /**
   * Grants membership, in the caller's transaction.
   *
   * @param manager - The transaction the application is written in.
   * @param input - Who, where, how and by whom.
   * @returns The membership.
   * @throws ConflictException when they are a member already.
   * @throws ForbiddenException when their membership is suspended.
   */
  async grantWithin(
    manager: EntityManager,
    input: GrantMembershipInput,
  ): Promise<ScopeMembershipEntity> {
    const existing = await manager.findOne(ScopeMembershipEntity, {
      where: { fleetId: input.fleet.id, userId: input.userId },
      lock: { mode: 'pessimistic_write' },
    });

    assertJoinable(existing);

    const membership = await manager.save(
      ScopeMembershipEntity,
      existing === null
        ? manager.create(ScopeMembershipEntity, {
            communityId: input.fleet.communityId as string,
            fleetId: input.fleet.id,
            userId: input.userId,
            status: ScopeMembershipStatus.APPROVED,
            requestedAt: input.now,
            decidedAt: input.now,
            decidedByUserId: input.actorUserId,
          })
        : Object.assign(existing, {
            status: ScopeMembershipStatus.APPROVED,
            decidedAt: input.now,
            decidedByUserId: input.actorUserId,
            decisionReason: null,
          }),
    );

    const approved = await manager.save(
      ScopeMembershipActionEntity,
      manager.create(ScopeMembershipActionEntity, {
        membershipId: membership.id,
        action: ScopeMembershipActionKind.APPROVED,
        actorUserId: input.actorUserId,
        applicationId: input.applicationId,
      }),
    );

    await recordMembership(
      manager,
      membership,
      approved,
      ActivityType.MEMBER_JOINED,
      input.now,
    );

    await this._revisionService.bump(
      FleetScopeKind.FLEET,
      input.fleet.id,
      manager,
    );

    const recorded = await manager.exists(CharacterFleetMembershipEntity, {
      where: {
        characterId: input.characterId,
        fleetId: input.fleet.id,
        validTo: IsNull(),
      },
    });

    if (!recorded) {
      await this._proposalService.raiseWithin(
        manager,
        input.characterId,
        {
          fleetId: input.fleet.id,
          proposedByUserId: input.actorUserId,
          applicationId: input.applicationId,
        },
        input.now,
      );
    }

    this._logger.log(
      `[grantWithin] Membership granted - FleetId: ${input.fleet.id}, ` +
        `MembershipId: ${membership.id}, ApplicationId: ${input.applicationId}`,
    );

    return membership;
  }

  /**
   * Lets a member leave.
   *
   * @param communityId - The Community holding the Fleet.
   * @param fleetId - The Fleet.
   * @param userId - The member.
   * @throws NotFoundException when they are not a member.
   */
  async leave(
    communityId: string,
    fleetId: string,
    userId: string,
  ): Promise<void> {
    await this._dataSource.transaction(async manager => {
      const membership = await manager.findOne(ScopeMembershipEntity, {
        where: { communityId, fleetId, userId },
        lock: { mode: 'pessimistic_write' },
      });

      if (membership?.status !== ScopeMembershipStatus.APPROVED) {
        throw new NotFoundException('You are not a member of this Fleet.');
      }

      await this.end(manager, membership, {
        status: ScopeMembershipStatus.LEFT,
        action: ScopeMembershipActionKind.LEFT,
        actorUserId: userId,
        reason: null,
      });
    });
  }

  /**
   * Removes a member, with a reason.
   *
   * Somebody holding a role at the Fleet is not removed here: their role goes
   * first, so that a removal cannot quietly take an Admin's powers with it.
   *
   * @param communityId - The Community holding the Fleet.
   * @param fleetId - The Fleet.
   * @param membershipId - The membership.
   * @param reason - Why.
   * @param actorUserId - Who is removing them.
   * @throws NotFoundException when there is no such current member.
   * @throws BadRequestException when the remover names themselves.
   * @throws ConflictException when the member holds a role at the Fleet.
   */
  async remove(
    communityId: string,
    fleetId: string,
    membershipId: string,
    reason: string,
    actorUserId: string,
  ): Promise<void> {
    await this._dataSource.transaction(async manager => {
      const membership = await manager.findOne(ScopeMembershipEntity, {
        where: { id: membershipId, communityId, fleetId },
        lock: { mode: 'pessimistic_write' },
      });

      if (
        membership === null ||
        (membership.status !== ScopeMembershipStatus.APPROVED &&
          membership.status !== ScopeMembershipStatus.SUSPENDED)
      ) {
        throw new NotFoundException('Not found');
      }

      if (membership.userId === actorUserId) {
        throw new BadRequestException(
          'To leave the Fleet yourself, use Leave this Fleet.',
        );
      }

      const holdsRole = await manager.exists(ScopeRoleAssignmentEntity, {
        where: { fleetId, userId: membership.userId, validTo: IsNull() },
      });

      if (holdsRole) {
        throw new ConflictException(
          'This member holds a role in the Fleet. Remove the role first.',
        );
      }

      await this.end(manager, membership, {
        status: ScopeMembershipStatus.REVOKED,
        action: ScopeMembershipActionKind.REMOVED,
        actorUserId,
        reason: reason.trim(),
      });
    });
  }

  /**
   * Suspends a member, with a reason (FC-036). They keep the membership and
   * lose everything it gives until reinstated; they are told, never why.
   *
   * Somebody holding a role at the Fleet is not suspended here, as they are
   * not removed: the role goes first.
   *
   * @param communityId - The Community holding the Fleet.
   * @param fleetId - The Fleet.
   * @param membershipId - The membership.
   * @param reason - Why.
   * @param actorUserId - Who is suspending them.
   * @throws NotFoundException when there is no such current member.
   * @throws BadRequestException when the suspender names themselves.
   * @throws ConflictException when the member holds a role at the Fleet.
   */
  async suspend(
    communityId: string,
    fleetId: string,
    membershipId: string,
    reason: string,
    actorUserId: string,
  ): Promise<void> {
    const fleet = await this._dataSource.transaction(async manager => {
      const membership = await this.lockMember(
        manager,
        communityId,
        fleetId,
        membershipId,
        ScopeMembershipStatus.APPROVED,
      );

      if (membership.userId === actorUserId) {
        throw new BadRequestException('You cannot suspend yourself.');
      }

      if (
        await manager.exists(ScopeRoleAssignmentEntity, {
          where: { fleetId, userId: membership.userId, validTo: IsNull() },
        })
      ) {
        throw new ConflictException(
          'This member holds a role in the Fleet. Remove the role first.',
        );
      }

      await this.change(manager, membership, {
        status: ScopeMembershipStatus.SUSPENDED,
        action: ScopeMembershipActionKind.SUSPENDED,
        actorUserId,
        reason: reason.trim(),
      });

      return manager.findOneOrFail(StoFleetEntity, { where: { id: fleetId } });
    });

    await this.tell(membershipId, {
      title: 'Fleet membership suspended',
      body:
        `Your membership of ${fleet.exactGameName} has been suspended. ` +
        'Until it is lifted, you have no access to the Fleet.',
      severity: NotificationSeverity.WARNING,
    });
  }

  /**
   * Lifts a member's suspension, with a reason (FC-036). They are told.
   *
   * @param communityId - The Community holding the Fleet.
   * @param fleetId - The Fleet.
   * @param membershipId - The membership.
   * @param reason - Why.
   * @param actorUserId - Who is reinstating them.
   * @throws NotFoundException when there is no such suspended member.
   */
  async reinstate(
    communityId: string,
    fleetId: string,
    membershipId: string,
    reason: string,
    actorUserId: string,
  ): Promise<void> {
    const fleet = await this._dataSource.transaction(async manager => {
      const membership = await this.lockMember(
        manager,
        communityId,
        fleetId,
        membershipId,
        ScopeMembershipStatus.SUSPENDED,
      );

      await this.change(manager, membership, {
        status: ScopeMembershipStatus.APPROVED,
        action: ScopeMembershipActionKind.REINSTATED,
        actorUserId,
        reason: reason.trim(),
      });

      return manager.findOneOrFail(StoFleetEntity, { where: { id: fleetId } });
    });

    await this.tell(membershipId, {
      title: 'Fleet membership reinstated',
      body: `Your membership of ${fleet.exactGameName} has been reinstated.`,
      severity: NotificationSeverity.SUCCESS,
    });
  }

  /**
   * Lists a Fleet's current members, for the Recruitment tab.
   *
   * @param fleetId - The Fleet.
   * @returns Each member with the Character and way they came in, newest
   *   first.
   */
  async list(fleetId: string): Promise<FleetMemberDto[]> {
    const manager = this._dataSource.manager;
    const memberships = await manager.find(ScopeMembershipEntity, {
      where: {
        fleetId,
        status: In([
          ScopeMembershipStatus.APPROVED,
          ScopeMembershipStatus.SUSPENDED,
        ]),
      },
      order: { decidedAt: 'DESC' },
    });

    if (memberships.length === 0) {
      return [];
    }

    const [usernames, grants] = await Promise.all([
      usernamesFor(
        manager,
        memberships.map(membership => membership.userId),
      ),
      manager.find(ScopeMembershipActionEntity, {
        where: {
          membershipId: In(memberships.map(membership => membership.id)),
          action: ScopeMembershipActionKind.APPROVED,
        },
        order: { createdAt: 'DESC' },
      }),
    ]);

    const latestGrant = new Map<string, ScopeMembershipActionEntity>();
    for (const grant of grants) {
      if (!latestGrant.has(grant.membershipId)) {
        latestGrant.set(grant.membershipId, grant);
      }
    }

    const applicationIds = [...latestGrant.values()]
      .map(grant => grant.applicationId)
      .filter((id): id is string => id !== null);
    const applications =
      applicationIds.length === 0
        ? []
        : await manager.find(FleetApplicationEntity, {
            where: { id: In(applicationIds) },
          });
    const characters =
      applications.length === 0
        ? []
        : await manager.find(CharacterEntity, {
            where: {
              id: In(applications.map(application => application.characterId)),
            },
            withDeleted: true,
          });

    const applicationById = new Map(
      applications.map(application => [application.id, application]),
    );
    const characterById = new Map(
      characters.map(character => [character.id, character]),
    );

    return memberships.map(membership => {
      const grant = latestGrant.get(membership.id);
      const application =
        grant?.applicationId === null || grant === undefined
          ? undefined
          : applicationById.get(grant.applicationId);
      const character =
        application === undefined
          ? undefined
          : characterById.get(application.characterId);

      return {
        membershipId: membership.id,
        username: usernames.get(membership.userId) ?? null,
        status: membership.status,
        memberSince: grant?.createdAt ?? membership.decidedAt,
        route: application?.route ?? null,
        characterName: character?.fullHandle ?? null,
        suspensionReason:
          membership.status === ScopeMembershipStatus.SUSPENDED
            ? membership.decisionReason
            : null,
      };
    });
  }

  /**
   * Finds a Fleet's membership in a given state, locked.
   *
   * @param manager - The transaction.
   * @param communityId - The Community.
   * @param fleetId - The Fleet.
   * @param membershipId - The membership.
   * @param status - The state it must be in.
   * @returns It.
   * @throws NotFoundException when there is none in that state.
   */
  private async lockMember(
    manager: EntityManager,
    communityId: string,
    fleetId: string,
    membershipId: string,
    status: ScopeMembershipStatus,
  ): Promise<ScopeMembershipEntity> {
    const membership = await manager.findOne(ScopeMembershipEntity, {
      where: { id: membershipId, communityId, fleetId },
      lock: { mode: 'pessimistic_write' },
    });

    if (membership?.status !== status) {
      throw new NotFoundException('Not found');
    }

    return membership;
  }

  /**
   * Moves a membership between approved and suspended, logs it and
   * advertises the change. Nothing else it holds changes.
   *
   * @param manager - The transaction.
   * @param membership - The membership, locked.
   * @param change - To what, by whom and why.
   * @param change.status - The status it moves to.
   * @param change.action - What the log calls it.
   * @param change.actorUserId - Who.
   * @param change.reason - Why.
   */
  private async change(
    manager: EntityManager,
    membership: ScopeMembershipEntity,
    change: {
      readonly status: ScopeMembershipStatus;
      readonly action: ScopeMembershipActionKind;
      readonly actorUserId: string;
      readonly reason: string;
    },
  ): Promise<void> {
    membership.status = change.status;
    membership.decidedAt = new Date();
    membership.decidedByUserId = change.actorUserId;
    membership.decisionReason = change.reason;
    await manager.save(ScopeMembershipEntity, membership);
    await manager.save(
      ScopeMembershipActionEntity,
      manager.create(ScopeMembershipActionEntity, {
        membershipId: membership.id,
        action: change.action,
        actorUserId: change.actorUserId,
        reason: change.reason,
      }),
    );
    await this._revisionService.bump(
      FleetScopeKind.FLEET,
      membership.fleetId as string,
      manager,
    );

    this._logger.log(
      `[change] Membership changed - MembershipId: ${membership.id}, ` +
        `Action: ${change.action}`,
    );
  }

  /**
   * Tells a member what became of their membership. A notice that cannot be
   * sent is logged; the change stands.
   *
   * @param membershipId - The membership.
   * @param notice - What to say.
   * @param notice.title - Its title.
   * @param notice.body - Its text.
   * @param notice.severity - How it is shown.
   */
  private async tell(
    membershipId: string,
    notice: {
      readonly title: string;
      readonly body: string;
      readonly severity: NotificationSeverity;
    },
  ): Promise<void> {
    try {
      const { userId } = await this._dataSource.manager.findOneOrFail(
        ScopeMembershipEntity,
        { where: { id: membershipId } },
      );

      await this._notifications.createNotification({
        target: NotificationTarget.USER,
        userId,
        ...notice,
      });
    } catch (error) {
      this._logger.warn(
        `[tell] A membership notice was not sent - MembershipId: ` +
          `${membershipId}, Reason: ${(error as Error).name}`,
      );
    }
  }

  /**
   * Ends a membership, logs it, drops any role and personal grant held at
   * the Fleet, takes back any unanswered question about the member's
   * Character that it asked, and advertises the change.
   *
   * @param manager - The transaction.
   * @param membership - The membership, locked.
   * @param end - How it ends, by whom and why.
   * @param end.status - The status it ends in.
   * @param end.action - What the log calls it.
   * @param end.actorUserId - Who ended it.
   * @param end.reason - Why, for a removal.
   */
  private async end(
    manager: EntityManager,
    membership: ScopeMembershipEntity,
    end: {
      readonly status: ScopeMembershipStatus;
      readonly action: ScopeMembershipActionKind;
      readonly actorUserId: string;
      readonly reason: string | null;
    },
  ): Promise<void> {
    const now = new Date();

    membership.status = end.status;
    membership.decidedAt = now;
    membership.decidedByUserId = end.actorUserId;
    membership.decisionReason = end.reason;
    await manager.save(ScopeMembershipEntity, membership);

    const ended = await manager.save(
      ScopeMembershipActionEntity,
      manager.create(ScopeMembershipActionEntity, {
        membershipId: membership.id,
        action: end.action,
        actorUserId: end.actorUserId,
        reason: end.reason,
      }),
    );

    await recordMembership(
      manager,
      membership,
      ended,
      end.action === ScopeMembershipActionKind.LEFT
        ? ActivityType.MEMBER_LEFT
        : ActivityType.MEMBER_REMOVED,
      now,
    );

    // A capability granted or denied to them here goes with the role: the
    // Owner can say so again if they come back. Each is logged (FC-039).
    await endAndLog(
      manager,
      {
        roles: {
          fleetId: membership.fleetId as string,
          userId: membership.userId,
        },
        grants: {
          fleetId: membership.fleetId as string,
          subjectUserId: membership.userId,
        },
      },
      end.action === ScopeMembershipActionKind.LEFT
        ? ENDED_BY_LEAVING
        : ENDED_BY_REMOVAL,
      now,
    );

    await this._proposalService.withdrawRecruitedWithin(
      manager,
      membership.fleetId as string,
      membership.userId,
    );

    // An Armada role is for its Fleets' members, so leaving the Fleet it
    // came through ends it, unless another placed Fleet still counts them
    // (FC-025).
    const placement = await openPlacementOf(
      manager,
      membership.fleetId as string,
    );

    if (placement !== null) {
      await endIneligibleArmadaRoles(
        manager,
        { id: placement.armadaId, communityId: placement.communityId },
        end.actorUserId,
        now,
      );
      await manager.increment(
        StoArmadaEntity,
        { id: placement.armadaId },
        'revision',
        1,
      );
    }

    await this._revisionService.bump(
      FleetScopeKind.FLEET,
      membership.fleetId as string,
      manager,
    );

    this._logger.log(
      `[end] Membership ended - MembershipId: ${membership.id}, ` +
        `Action: ${end.action}`,
    );
  }
}

/**
 * Refuses a membership that already stands, or is suspended.
 *
 * @param existing - The user's membership of the Fleet, if any.
 * @throws ConflictException when they are a member already.
 * @throws ForbiddenException when their membership is suspended.
 */
function assertJoinable(existing: ScopeMembershipEntity | null): void {
  if (existing?.status === ScopeMembershipStatus.APPROVED) {
    throw new ConflictException('Already a member of this Fleet.');
  }

  if (existing?.status === ScopeMembershipStatus.SUSPENDED) {
    throw new ForbiddenException('Membership of this Fleet is suspended.');
  }
}

/**
 * Puts a change of membership on the Fleet's activity feed (FC-029), for
 * its members only. Never the reason for a removal: that stays in the log.
 *
 * @param manager - The transaction.
 * @param membership - The membership.
 * @param action - The log line recording the change.
 * @param type - What happened.
 * @param occurredAt - When.
 */
async function recordMembership(
  manager: EntityManager,
  membership: ScopeMembershipEntity,
  action: ScopeMembershipActionEntity,
  type: ActivityType,
  occurredAt: Date,
): Promise<void> {
  await recordActivity(manager, [
    {
      communityId: membership.communityId,
      fleetId: membership.fleetId,
      type,
      actorUserId: action.actorUserId,
      subjectUserId: membership.userId,
      sourceId: membership.id,
      idempotencyKey: `${type}:${action.id}`,
      occurredAt,
    },
  ]);
}

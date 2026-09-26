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

import { CharacterEntity } from 'src/sto/character/entities/character.entity';

import { FleetAuthorisationRevisionService } from '../../authorisation/fleet-authorisation-revision.service';
import { CharacterFleetMembershipEntity } from '../../entities/character-fleet-membership.entity';
import { ScopeMembershipEntity } from '../../entities/scope-membership.entity';
import { ScopeRoleAssignmentEntity } from '../../entities/scope-role-assignment.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { ScopeMembershipStatus } from '../../enums/scope-membership-status.enum';
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
 * in-game invitation has happened, which STO Info cannot do for them. Every
 * grant, departure and removal is logged in `scope_membership_action` and
 * advances the Fleet's authorisation revision in the same transaction.
 */
@Injectable()
export class RecruitmentMembershipService {
  private readonly _logger = new Logger(RecruitmentMembershipService.name);

  /**
   * Creates an instance of RecruitmentMembershipService.
   *
   * @param _dataSource - The database.
   * @param _revisionService - Advertises changes to access.
   * @param _proposalService - Asks the member about their Character.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _revisionService: FleetAuthorisationRevisionService,
    private readonly _proposalService: CharacterFleetProposalService,
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

    await manager.save(
      ScopeMembershipActionEntity,
      manager.create(ScopeMembershipActionEntity, {
        membershipId: membership.id,
        action: ScopeMembershipActionKind.APPROVED,
        actorUserId: input.actorUserId,
        applicationId: input.applicationId,
      }),
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
        memberSince: membership.decidedAt,
        route: application?.route ?? null,
        characterName: character?.fullHandle ?? null,
      };
    });
  }

  /**
   * Ends a membership, logs it, drops any role held at the Fleet and
   * advertises the change.
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

    await manager.save(
      ScopeMembershipActionEntity,
      manager.create(ScopeMembershipActionEntity, {
        membershipId: membership.id,
        action: end.action,
        actorUserId: end.actorUserId,
        reason: end.reason,
      }),
    );

    await manager.update(
      ScopeRoleAssignmentEntity,
      {
        fleetId: membership.fleetId as string,
        userId: membership.userId,
        validTo: IsNull(),
      },
      { validTo: now },
    );

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

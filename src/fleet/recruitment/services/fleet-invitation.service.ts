import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, EntityManager, MoreThan } from 'typeorm';

import { UserProfileEntity } from 'src/user/entities/user-profile.entity';

import { CharacterFleetMapper } from '../../mappers/character-fleet.mapper';
import { MyFleetApplicationDto } from '../dto/fleet-application.dto';
import {
  FleetInvitationDto,
  FleetInvitationState,
  MyFleetInvitationDto,
} from '../dto/fleet-invitation.dto';
import { FleetApplicationActionEntity } from '../entities/fleet-application-action.entity';
import { FleetApplicationEntity } from '../entities/fleet-application.entity';
import { FleetInvitationEntity } from '../entities/fleet-invitation.entity';
import { FleetApplicationActionKind } from '../enums/fleet-application-action-kind.enum';
import { FleetApplicationRoute } from '../enums/fleet-application-route.enum';
import { FleetApplicationStatus } from '../enums/fleet-application-status.enum';
import { FleetInvitationStatus } from '../enums/fleet-invitation-status.enum';
import { usernamesFor } from '../utilities/recruitment-names.utility';
import { RecruitmentEligibilityService } from './recruitment-eligibility.service';
import { RecruitmentMembershipService } from './recruitment-membership.service';
import { RecruitmentSettingsService } from './recruitment-settings.service';

/** How long an invitation stays open (Steve's decision of 26 September 2026). */
export const FLEET_INVITATION_LIFETIME_DAYS = 14;

/** Milliseconds in a day. */
const DAY_MS = 86_400_000;

/** The most invitations a Fleet's list shows. */
const INVITATION_LIST_LIMIT = 100;

/**
 * Invitations to join a Fleet (FC-021).
 *
 * An officer holding `applications.decide` invites a person by their
 * username, in any recruitment state: an invitation is the Fleet reaching out
 * on purpose. The invitee accepts with one of their own Characters on the
 * Fleet's platform, and the Fleet's requirements do not apply, since an
 * officer chose them. Accepting grants membership as an application does and
 * leaves the same record behind, with the route INVITATION.
 */
@Injectable()
export class FleetInvitationService {
  private readonly _logger = new Logger(FleetInvitationService.name);

  /**
   * Creates an instance of FleetInvitationService.
   *
   * @param _dataSource - The database.
   * @param _settings - How each Fleet recruits.
   * @param _eligibility - Who may come in, and with which Character.
   * @param _membership - Grants the membership an acceptance brings.
   * @param _fleetMapper - Names a Fleet enough to link to it.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _settings: RecruitmentSettingsService,
    private readonly _eligibility: RecruitmentEligibilityService,
    private readonly _membership: RecruitmentMembershipService,
    private readonly _fleetMapper: CharacterFleetMapper,
  ) {}

  /**
   * Invites a person to a Fleet.
   *
   * An invitation of theirs that lapsed unanswered is replaced; an open one
   * is not duplicated.
   *
   * @param communityId - The Community holding the Fleet.
   * @param fleetId - The Fleet.
   * @param username - The invitee's STO Info username.
   * @param actorUserId - The officer inviting them.
   * @returns The invitation, as officers see it.
   */
  async invite(
    communityId: string,
    fleetId: string,
    username: string,
    actorUserId: string,
  ): Promise<FleetInvitationDto> {
    const saved = await this._dataSource.transaction(async manager => {
      const fleet = await this._eligibility.loadFleet(
        manager,
        communityId,
        fleetId,
      );
      const profile = await manager
        .createQueryBuilder(UserProfileEntity, 'profile')
        .where('LOWER(profile.username) = LOWER(:username)', {
          username: username.trim(),
        })
        .getOne();

      if (profile === null) {
        throw new NotFoundException('Nobody has that username.');
      }

      if (profile.userId === actorUserId) {
        throw new BadRequestException('You cannot invite yourself.');
      }

      if (fleet.community?.ownerUserId === profile.userId) {
        throw new ConflictException(
          'They own this Fleet’s Community, so they have its access already.',
        );
      }

      await this._membership.assertMayJoin(manager, fleet.id, profile.userId);

      const now = new Date();
      const open = await manager.findOne(FleetInvitationEntity, {
        where: {
          fleetId: fleet.id,
          invitedUserId: profile.userId,
          status: FleetInvitationStatus.PENDING,
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (open !== null && open.expiresAt > now) {
        throw new ConflictException('They already have an open invitation.');
      }

      if (open !== null) {
        open.status = FleetInvitationStatus.LAPSED;
        open.answeredAt = now;
        await manager.save(FleetInvitationEntity, open);
      }

      return manager.save(
        FleetInvitationEntity,
        manager.create(FleetInvitationEntity, {
          communityId,
          fleetId: fleet.id,
          invitedUserId: profile.userId,
          invitedByUserId: actorUserId,
          status: FleetInvitationStatus.PENDING,
          expiresAt: new Date(
            now.getTime() + FLEET_INVITATION_LIFETIME_DAYS * DAY_MS,
          ),
        }),
      );
    });

    this._logger.log(
      `[invite] Invitation sent - FleetId: ${fleetId}, InvitationId: ${saved.id}`,
    );

    const [invitation] = await this.toOfficerDtos(this._dataSource.manager, [
      saved,
    ]);

    return invitation;
  }

  /**
   * Takes back an open invitation.
   *
   * @param communityId - The Community holding the Fleet.
   * @param fleetId - The Fleet.
   * @param invitationId - The invitation.
   * @returns The invitation, as officers now see it.
   */
  async withdraw(
    communityId: string,
    fleetId: string,
    invitationId: string,
  ): Promise<FleetInvitationDto> {
    const saved = await this._dataSource.transaction(async manager => {
      const invitation = await manager.findOne(FleetInvitationEntity, {
        where: { id: invitationId, fleetId, communityId },
        lock: { mode: 'pessimistic_write' },
      });

      if (invitation === null) {
        throw new NotFoundException('Not found');
      }

      assertOpen(invitation, new Date());
      invitation.status = FleetInvitationStatus.WITHDRAWN;
      invitation.answeredAt = new Date();

      return manager.save(FleetInvitationEntity, invitation);
    });

    const [invitation] = await this.toOfficerDtos(this._dataSource.manager, [
      saved,
    ]);

    return invitation;
  }

  /**
   * Lists a Fleet's invitations, newest first.
   *
   * @param fleetId - The Fleet.
   * @returns Each, with who sent it and where it stands.
   */
  async list(fleetId: string): Promise<FleetInvitationDto[]> {
    const invitations = await this._dataSource.manager.find(
      FleetInvitationEntity,
      {
        where: { fleetId },
        order: { createdAt: 'DESC', id: 'DESC' },
        take: INVITATION_LIST_LIMIT,
      },
    );

    return this.toOfficerDtos(this._dataSource.manager, invitations);
  }

  /**
   * Lists somebody's open invitations.
   *
   * @param userId - Whose.
   * @returns Each, with the Fleet named and linked.
   */
  async listMine(userId: string): Promise<MyFleetInvitationDto[]> {
    const manager = this._dataSource.manager;
    const invitations = await manager.find(FleetInvitationEntity, {
      where: {
        invitedUserId: userId,
        status: FleetInvitationStatus.PENDING,
        expiresAt: MoreThan(new Date()),
      },
      order: { createdAt: 'DESC' },
      relations: { fleet: { platform: true, community: true } },
    });
    const names = await usernamesFor(
      manager,
      invitations.map(invitation => invitation.invitedByUserId),
    );

    return invitations.map(invitation => ({
      id: invitation.id,
      fleet: this._fleetMapper.toSummaryDto(invitation.fleet),
      invitedByUsername:
        invitation.invitedByUserId === null
          ? null
          : (names.get(invitation.invitedByUserId) ?? null),
      sentAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
    }));
  }

  /**
   * Accepts an invitation with one of the invitee's Characters.
   *
   * @param invitationId - The invitation.
   * @param userId - The invitee.
   * @param characterId - The Character they come in with.
   * @returns The record of how they came in, as they see it.
   */
  async accept(
    invitationId: string,
    userId: string,
    characterId: string,
  ): Promise<MyFleetApplicationDto> {
    const applicationId = await this._dataSource.transaction(async manager => {
      const invitation = await this.lockOwn(manager, invitationId, userId);
      const now = new Date();

      assertOpen(invitation, now);

      const fleet = await this._eligibility.loadFleet(
        manager,
        invitation.communityId,
        invitation.fleetId,
      );
      await this._membership.assertMayJoin(manager, fleet.id, userId);
      const character = await this._eligibility.requireCharacter(
        manager,
        fleet,
        characterId,
        userId,
        null,
      );
      const current = await this._settings.current(fleet, manager);

      const application = await manager.save(
        FleetApplicationEntity,
        manager.create(FleetApplicationEntity, {
          communityId: invitation.communityId,
          fleetId: fleet.id,
          applicantUserId: userId,
          characterId: character.id,
          route: FleetApplicationRoute.INVITATION,
          status: FleetApplicationStatus.ACCEPTED,
          settingsId: current.settings?.id ?? null,
          answers: [],
          invitationId: invitation.id,
          submittedAt: now,
          decidedAt: now,
          decidedByUserId: invitation.invitedByUserId,
        }),
      );

      await manager.save(
        FleetApplicationActionEntity,
        manager.create(FleetApplicationActionEntity, {
          applicationId: application.id,
          action: FleetApplicationActionKind.ACCEPTED,
          actorUserId: userId,
        }),
      );

      invitation.status = FleetInvitationStatus.ACCEPTED;
      invitation.answeredAt = now;
      await manager.save(FleetInvitationEntity, invitation);

      await this._membership.grantWithin(manager, {
        fleet,
        userId,
        characterId: character.id,
        applicationId: application.id,
        actorUserId: invitation.invitedByUserId,
        now,
      });

      return application.id;
    });

    this._logger.log(
      `[accept] Invitation accepted - InvitationId: ${invitationId}, ApplicationId: ${applicationId}`,
    );

    const application = await this._dataSource.manager.findOneOrFail(
      FleetApplicationEntity,
      {
        where: { id: applicationId },
        relations: {
          fleet: { platform: true, community: true },
          character: true,
        },
      },
    );

    return {
      id: application.id,
      fleet: this._fleetMapper.toSummaryDto(application.fleet),
      status: application.status,
      route: application.route,
      characterName: application.character.fullHandle,
      submittedAt: application.submittedAt,
      decidedAt: application.decidedAt,
      decisionNote: application.decisionNote,
    };
  }

  /**
   * Declines an invitation.
   *
   * @param invitationId - The invitation.
   * @param userId - The invitee.
   */
  async decline(invitationId: string, userId: string): Promise<void> {
    await this._dataSource.transaction(async manager => {
      const invitation = await this.lockOwn(manager, invitationId, userId);
      const now = new Date();

      assertOpen(invitation, now);
      invitation.status = FleetInvitationStatus.DECLINED;
      invitation.answeredAt = now;
      await manager.save(FleetInvitationEntity, invitation);
    });
  }

  /**
   * Reads and locks one of somebody's own invitations.
   *
   * @param manager - The transaction.
   * @param invitationId - The invitation.
   * @param userId - The invitee.
   * @returns The invitation.
   * @throws NotFoundException when it is not theirs or does not exist.
   */
  private async lockOwn(
    manager: EntityManager,
    invitationId: string,
    userId: string,
  ): Promise<FleetInvitationEntity> {
    const invitation = await manager.findOne(FleetInvitationEntity, {
      where: { id: invitationId, invitedUserId: userId },
      lock: { mode: 'pessimistic_write' },
    });

    if (invitation === null) {
      throw new NotFoundException('Not found');
    }

    return invitation;
  }

  /**
   * Maps invitations for the Fleet's officers, reading names in bulk.
   *
   * @param manager - The manager to read through.
   * @param invitations - The invitations.
   * @returns One each, in the same order.
   */
  private async toOfficerDtos(
    manager: EntityManager,
    invitations: readonly FleetInvitationEntity[],
  ): Promise<FleetInvitationDto[]> {
    const names = await usernamesFor(
      manager,
      invitations.flatMap(invitation => [
        invitation.invitedUserId,
        invitation.invitedByUserId,
      ]),
    );
    const now = new Date();

    return invitations.map(invitation => ({
      id: invitation.id,
      invitedUsername: names.get(invitation.invitedUserId) ?? null,
      invitedByUsername:
        invitation.invitedByUserId === null
          ? null
          : (names.get(invitation.invitedByUserId) ?? null),
      state: stateOf(invitation, now),
      sentAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
      answeredAt: invitation.answeredAt,
    }));
  }
}

/**
 * Where an invitation stands now, reading its expiry.
 *
 * @param invitation - The invitation.
 * @param now - The instant to judge at.
 * @returns Its state.
 */
export function stateOf(
  invitation: FleetInvitationEntity,
  now: Date,
): FleetInvitationState {
  if (invitation.status === FleetInvitationStatus.PENDING) {
    return invitation.expiresAt > now
      ? FleetInvitationState.PENDING
      : FleetInvitationState.LAPSED;
  }

  return invitation.status as unknown as FleetInvitationState;
}

/**
 * Refuses an invitation that is no longer open.
 *
 * @param invitation - The invitation.
 * @param now - The instant to judge at.
 * @throws ConflictException when it lapsed or was answered.
 */
function assertOpen(invitation: FleetInvitationEntity, now: Date): void {
  if (stateOf(invitation, now) !== FleetInvitationState.PENDING) {
    throw new ConflictException(
      'This invitation has lapsed or has already been answered.',
    );
  }
}

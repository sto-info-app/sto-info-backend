import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, In, MoreThan } from 'typeorm';

import { CharacterEntity } from 'src/sto/character/entities/character.entity';

import { FleetAuthorisationService } from '../../authorisation/fleet-authorisation.service';
import {
  FLEET_CAPABILITIES,
  FleetCapability,
} from '../../authorisation/fleet-capability.constants';
import { FleetCommunityEntity } from '../../entities/fleet-community.entity';
import { ScopeMembershipEntity } from '../../entities/scope-membership.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import {
  FleetRecruitmentViewDto,
  RecruitmentViewerDto,
} from '../dto/fleet-recruitment-view.dto';
import { FleetApplicationEntity } from '../entities/fleet-application.entity';
import { FleetInvitationEntity } from '../entities/fleet-invitation.entity';
import { FleetApplicationStatus } from '../enums/fleet-application-status.enum';
import { FleetInvitationStatus } from '../enums/fleet-invitation-status.enum';
import { RecruitmentSettingsService } from './recruitment-settings.service';

/**
 * What a Fleet's page shows about recruitment (FC-021).
 *
 * How the Fleet recruits is shown to whoever may see the Fleet. Where the
 * viewer stands — a member already, an application waiting, an invitation
 * open, and which recruitment tools they may use — is shown to them alone.
 */
@Injectable()
export class FleetRecruitmentViewService {
  /**
   * Creates an instance of FleetRecruitmentViewService.
   *
   * @param _dataSource - The database.
   * @param _settings - How each Fleet recruits.
   * @param _authorisation - Which capabilities the viewer holds.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _settings: RecruitmentSettingsService,
    private readonly _authorisation: FleetAuthorisationService,
  ) {}

  /**
   * Describes a Fleet's recruitment for one viewer.
   *
   * @param fleet - The Fleet.
   * @param userId - The viewer, or null when signed out.
   * @returns How it recruits, and where they stand.
   */
  async view(
    fleet: StoFleetEntity,
    userId: string | null,
  ): Promise<FleetRecruitmentViewDto> {
    const settings = await this._settings.describe(fleet);

    return {
      settings,
      viewer: userId === null ? null : await this.viewer(fleet, userId),
    };
  }

  /**
   * Works out where a signed-in viewer stands.
   *
   * @param fleet - The Fleet, with its Community when it was loaded.
   * @param userId - The viewer.
   * @returns Their standing.
   */
  private async viewer(
    fleet: StoFleetEntity,
    userId: string,
  ): Promise<RecruitmentViewerDto> {
    const manager = this._dataSource.manager;
    const community =
      fleet.community ??
      (await manager.findOne(FleetCommunityEntity, {
        where: { id: fleet.communityId as string },
      }));
    const [membership, pending, invitation] = await Promise.all([
      manager.findOne(ScopeMembershipEntity, {
        where: { fleetId: fleet.id, userId },
      }),
      manager.find(FleetApplicationEntity, {
        where: {
          fleetId: fleet.id,
          applicantUserId: userId,
          status: FleetApplicationStatus.PENDING,
        },
        order: { submittedAt: 'ASC' },
      }),
      manager.findOne(FleetInvitationEntity, {
        where: {
          fleetId: fleet.id,
          invitedUserId: userId,
          status: FleetInvitationStatus.PENDING,
          expiresAt: MoreThan(new Date()),
        },
      }),
    ]);
    const characters =
      pending.length === 0
        ? []
        : await manager.find(CharacterEntity, {
            where: {
              id: In(pending.map(application => application.characterId)),
            },
          });
    const characterNames = new Map(
      characters.map(character => [character.id, character.fullHandle]),
    );

    const holds = (capability: FleetCapability): Promise<boolean> =>
      this._authorisation.hasCapability(
        userId,
        { kind: FleetScopeKind.FLEET, id: fleet.id },
        capability,
      );
    const [view, decide, manage, members] = await Promise.all([
      holds(FLEET_CAPABILITIES.APPLICATIONS_VIEW),
      holds(FLEET_CAPABILITIES.APPLICATIONS_DECIDE),
      holds(FLEET_CAPABILITIES.RECRUITMENT_MANAGE),
      holds(FLEET_CAPABILITIES.MEMBERS_MANAGE),
    ]);

    return {
      isOwner: community?.ownerUserId === userId,
      membershipStatus: membership?.status ?? null,
      pendingApplications: pending.map(application => ({
        id: application.id,
        characterName:
          characterNames.get(application.characterId) ?? 'A deleted Character',
        submittedAt: application.submittedAt,
      })),
      openInvitation:
        invitation === null
          ? null
          : { id: invitation.id, expiresAt: invitation.expiresAt },
      canViewApplications: view,
      canDecideApplications: decide,
      canManageRecruitment: manage,
      canManageMembers: members,
    };
  }
}

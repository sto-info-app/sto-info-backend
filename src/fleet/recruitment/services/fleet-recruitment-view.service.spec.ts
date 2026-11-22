import { DataSource } from 'typeorm';

import { CharacterEntity } from 'src/sto/character/entities/character.entity';

import { FleetAuthorisationService } from '../../authorisation/fleet-authorisation.service';
import { FLEET_CAPABILITIES } from '../../authorisation/fleet-capability.constants';
import { FleetCommunityEntity } from '../../entities/fleet-community.entity';
import { ScopeMembershipEntity } from '../../entities/scope-membership.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetRecruitmentState } from '../../enums/fleet-recruitment-state.enum';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { ScopeMembershipStatus } from '../../enums/scope-membership-status.enum';
import { FleetApplicationEntity } from '../entities/fleet-application.entity';
import { FleetInvitationEntity } from '../entities/fleet-invitation.entity';
import { FleetRecruitmentViewService } from './fleet-recruitment-view.service';
import { RecruitmentSettingsService } from './recruitment-settings.service';

const SETTINGS = {
  version: 1,
  recruitmentState: FleetRecruitmentState.APPLICATION,
  requirementsText: null,
  minimumLevel: null,
  factions: [],
  questions: [],
  savedAt: null,
};
const FLEET = {
  id: 'fleet-1',
  communityId: 'community-1',
  community: { ownerUserId: 'owner-1' },
} as StoFleetEntity;
const SUBMITTED = new Date('2026-09-25T09:00:00Z');
const EXPIRES = new Date('2026-10-09T09:00:00Z');

describe('FleetRecruitmentViewService', () => {
  let membership: Partial<ScopeMembershipEntity> | null;
  let invitation: Partial<FleetInvitationEntity> | null;
  let pending: Partial<FleetApplicationEntity>[];
  let held: Set<string>;
  let manager: { findOne: jest.Mock; find: jest.Mock };
  let hasCapability: jest.Mock;
  let service: FleetRecruitmentViewService;

  beforeEach(() => {
    membership = null;
    invitation = null;
    pending = [];
    held = new Set();
    manager = {
      findOne: jest.fn((entity: unknown) => {
        switch (entity) {
          case ScopeMembershipEntity:
            return Promise.resolve(membership);
          case FleetInvitationEntity:
            return Promise.resolve(invitation);
          case FleetCommunityEntity:
            return Promise.resolve({ ownerUserId: 'owner-2' });
          default:
            return Promise.resolve(null);
        }
      }),
      find: jest.fn((entity: unknown) =>
        Promise.resolve(
          entity === FleetApplicationEntity
            ? pending
            : entity === CharacterEntity
              ? [{ id: 'character-1', fullHandle: 'Kell Marr@kell' }]
              : [],
        ),
      ),
    };
    hasCapability = jest.fn(
      (_user: string, _ref: unknown, capability: string) =>
        Promise.resolve(held.has(capability)),
    );
    service = new FleetRecruitmentViewService(
      { manager } as unknown as DataSource,
      {
        describe: jest.fn(() => Promise.resolve(SETTINGS)),
      } as unknown as RecruitmentSettingsService,
      { hasCapability } as unknown as FleetAuthorisationService,
    );
  });

  it('shows somebody signed out how the Fleet recruits, and nothing else', async () => {
    await expect(service.view(FLEET, null)).resolves.toEqual({
      settings: SETTINGS,
      viewer: null,
    });
    expect(manager.findOne).not.toHaveBeenCalled();
  });

  it('shows somebody with no standing that they have none', async () => {
    const view = await service.view(FLEET, 'user-1');

    expect(view.viewer).toEqual({
      isOwner: false,
      membershipStatus: null,
      pendingApplications: [],
      openInvitation: null,
      canViewApplications: false,
      canDecideApplications: false,
      canManageRecruitment: false,
      canManageMembers: false,
    });
    expect(manager.find).toHaveBeenCalledTimes(1);
  });

  it('shows the viewer their membership, waiting applications and open invitation', async () => {
    membership = { status: ScopeMembershipStatus.SUSPENDED };
    invitation = { id: 'invitation-1', expiresAt: EXPIRES };
    pending = [
      {
        id: 'application-1',
        characterId: 'character-1',
        submittedAt: SUBMITTED,
      },
      {
        id: 'application-2',
        characterId: 'character-9',
        submittedAt: SUBMITTED,
      },
    ];

    const view = await service.view(FLEET, 'user-1');

    expect(view.viewer).toEqual(
      expect.objectContaining({
        membershipStatus: ScopeMembershipStatus.SUSPENDED,
        pendingApplications: [
          {
            id: 'application-1',
            characterName: 'Kell Marr@kell',
            submittedAt: SUBMITTED,
          },
          {
            id: 'application-2',
            characterName: 'A deleted Character',
            submittedAt: SUBMITTED,
          },
        ],
        openInvitation: { id: 'invitation-1', expiresAt: EXPIRES },
      }),
    );
  });

  it('says which recruitment tools the viewer may use', async () => {
    held = new Set([
      FLEET_CAPABILITIES.APPLICATIONS_VIEW,
      FLEET_CAPABILITIES.MEMBERS_MANAGE,
    ]);

    const view = await service.view(FLEET, 'owner-1');

    expect(view.viewer).toEqual(
      expect.objectContaining({
        isOwner: true,
        canViewApplications: true,
        canDecideApplications: false,
        canManageRecruitment: false,
        canManageMembers: true,
      }),
    );
    expect(hasCapability).toHaveBeenCalledWith(
      'owner-1',
      { kind: FleetScopeKind.FLEET, id: 'fleet-1' },
      FLEET_CAPABILITIES.APPLICATIONS_DECIDE,
    );
  });

  it('reads the Community when the Fleet came without it', async () => {
    const view = await service.view(
      { ...FLEET, community: null } as StoFleetEntity,
      'owner-2',
    );

    expect(view.viewer?.isOwner).toBe(true);
    expect(manager.findOne).toHaveBeenCalledWith(FleetCommunityEntity, {
      where: { id: 'community-1' },
    });
  });

  it('names no owner when the Community cannot be read', async () => {
    manager.findOne.mockImplementation(() => Promise.resolve(null));

    const view = await service.view(
      { ...FLEET, community: null } as StoFleetEntity,
      'owner-1',
    );

    expect(view.viewer?.isOwner).toBe(false);
  });
});

import { FleetAudienceService } from '../authorisation/fleet-audience.service';
import { FLEET_CAPABILITIES } from '../authorisation/fleet-capability.constants';
import { REQUIRES_SCOPE_CAPABILITY_KEY } from '../authorisation/requires-scope-capability.decorator';
import { StoFleetEntity } from '../entities/sto-fleet.entity';
import { FleetAudience } from '../enums/fleet-audience.enum';
import { FleetRecruitmentState } from '../enums/fleet-recruitment-state.enum';
import { FleetScopeKind } from '../enums/fleet-scope-kind.enum';
import { FleetFeatureService } from '../fleet-feature.service';
import { StoFleetService } from '../services/sto-fleet.service';
import { FleetRecruitmentController } from './fleet-recruitment.controller';
import { FleetApplicationService } from './services/fleet-application.service';
import { FleetInvitationService } from './services/fleet-invitation.service';
import { FleetRecruitmentViewService } from './services/fleet-recruitment-view.service';
import { RecruitmentMembershipService } from './services/recruitment-membership.service';
import { RecruitmentSettingsService } from './services/recruitment-settings.service';

const FLEET = {
  id: 'fleet-1',
  visibility: FleetAudience.COMMUNITY,
} as StoFleetEntity;
const SOURCE = {
  kind: FleetScopeKind.FLEET,
  param: 'fleetId',
  communityParam: 'communityId',
};

describe('FleetRecruitmentController', () => {
  let feature: { assertEnabled: jest.Mock };
  let fleets: { findByIdOrFail: jest.Mock };
  let audience: { assertCanView: jest.Mock };
  let view: { view: jest.Mock };
  let settings: { save: jest.Mock; describe: jest.Mock };
  let applications: Record<string, jest.Mock>;
  let invitations: Record<string, jest.Mock>;
  let membership: Record<string, jest.Mock>;
  let controller: FleetRecruitmentController;

  beforeEach(() => {
    feature = { assertEnabled: jest.fn(() => Promise.resolve()) };
    fleets = { findByIdOrFail: jest.fn(() => Promise.resolve(FLEET)) };
    audience = { assertCanView: jest.fn(() => Promise.resolve()) };
    view = { view: jest.fn(() => Promise.resolve({ viewer: null })) };
    settings = {
      save: jest.fn(() => Promise.resolve({ version: 3 })),
      describe: jest.fn(() => Promise.resolve({ version: 3 })),
    };
    applications = {
      join: jest.fn(() => Promise.resolve({ id: 'join-1' })),
      submit: jest.fn(() => Promise.resolve({ id: 'application-1' })),
      page: jest.fn(() => Promise.resolve({ items: [] })),
      detail: jest.fn(() => Promise.resolve({ id: 'application-1' })),
      decide: jest.fn(() => Promise.resolve({ id: 'application-1' })),
    };
    invitations = {
      list: jest.fn(() => Promise.resolve([])),
      invite: jest.fn(() => Promise.resolve({ id: 'invitation-1' })),
      withdraw: jest.fn(() => Promise.resolve({ id: 'invitation-1' })),
    };
    membership = {
      leave: jest.fn(() => Promise.resolve()),
      list: jest.fn(() => Promise.resolve([])),
      remove: jest.fn(() => Promise.resolve()),
    };
    controller = new FleetRecruitmentController(
      feature as unknown as FleetFeatureService,
      fleets as unknown as StoFleetService,
      audience as unknown as FleetAudienceService,
      view as unknown as FleetRecruitmentViewService,
      settings as unknown as RecruitmentSettingsService,
      applications as unknown as FleetApplicationService,
      invitations as unknown as FleetInvitationService,
      membership as unknown as RecruitmentMembershipService,
    );
  });

  it.each([
    ['saveSettings', FLEET_CAPABILITIES.RECRUITMENT_MANAGE],
    ['applications', FLEET_CAPABILITIES.APPLICATIONS_VIEW],
    ['application', FLEET_CAPABILITIES.APPLICATIONS_VIEW],
    ['decide', FLEET_CAPABILITIES.APPLICATIONS_DECIDE],
    ['invitations', FLEET_CAPABILITIES.APPLICATIONS_VIEW],
    ['invite', FLEET_CAPABILITIES.APPLICATIONS_DECIDE],
    ['withdrawInvitation', FLEET_CAPABILITIES.APPLICATIONS_DECIDE],
    ['members', FLEET_CAPABILITIES.MEMBERS_MANAGE],
    ['removeMember', FLEET_CAPABILITIES.MEMBERS_MANAGE],
  ] as const)('keeps %s to holders of %s at the Fleet', (route, capability) => {
    expect(
      Reflect.getMetadata(
        REQUIRES_SCOPE_CAPABILITY_KEY,
        FleetRecruitmentController.prototype[route],
      ),
    ).toEqual({ capability, source: SOURCE });
  });

  it.each(['view', 'join', 'leave', 'submit'] as const)(
    'asks no capability of %s, whose service checks the person',
    route => {
      expect(
        Reflect.getMetadata(
          REQUIRES_SCOPE_CAPABILITY_KEY,
          FleetRecruitmentController.prototype[route],
        ),
      ).toBeUndefined();
    },
  );

  it('shows how a visible Fleet recruits', async () => {
    await expect(
      controller.view('community-1', 'fleet-1', 'user-1'),
    ).resolves.toEqual({ viewer: null });
    expect(audience.assertCanView).toHaveBeenCalledWith(
      FleetAudience.COMMUNITY,
      { kind: FleetScopeKind.FLEET, id: 'fleet-1' },
      'user-1',
    );
    expect(view.view).toHaveBeenCalledWith(FLEET, 'user-1');
  });

  it('refuses everything while the Fleet feature is off', async () => {
    feature.assertEnabled.mockImplementation(() =>
      Promise.reject(new Error('Fleet Community is not enabled')),
    );

    await expect(
      controller.view('community-1', 'fleet-1', null),
    ).rejects.toThrow('not enabled');
    expect(fleets.findByIdOrFail).not.toHaveBeenCalled();
  });

  it('saves settings and answers with the new version', async () => {
    const dto = {
      expectedVersion: 2,
      recruitmentState: FleetRecruitmentState.OPEN,
      factionIds: [],
      questions: [],
    };

    await expect(
      controller.saveSettings('community-1', 'fleet-1', 'officer-1', dto),
    ).resolves.toEqual({ version: 3 });
    expect(settings.save).toHaveBeenCalledWith(
      'community-1',
      'fleet-1',
      dto,
      'officer-1',
    );
    expect(settings.describe).toHaveBeenCalledWith(FLEET);
  });

  it('passes a join, an application and a departure to their services', async () => {
    await controller.join('community-1', 'fleet-1', 'user-1', {
      characterId: 'character-1',
    });
    await controller.submit('community-1', 'fleet-1', 'user-1', {
      characterId: 'character-1',
      settingsVersion: 1,
      answers: [],
    });
    await controller.leave('community-1', 'fleet-1', 'user-1');

    expect(applications.join).toHaveBeenCalledWith(
      'community-1',
      'fleet-1',
      'user-1',
      { characterId: 'character-1' },
    );
    expect(applications.submit).toHaveBeenCalledWith(
      'community-1',
      'fleet-1',
      'user-1',
      expect.objectContaining({ settingsVersion: 1 }),
    );
    expect(membership.leave).toHaveBeenCalledWith(
      'community-1',
      'fleet-1',
      'user-1',
    );
  });

  it('reads and decides applications', async () => {
    await controller.applications('fleet-1', { page: 2 });
    await controller.application('fleet-1', 'application-1');
    await controller.decide(
      'community-1',
      'fleet-1',
      'application-1',
      'officer-1',
      {
        decision: 'REJECT',
        note: 'Not now',
        revision: 1,
      },
    );

    expect(applications.page).toHaveBeenCalledWith('fleet-1', { page: 2 });
    expect(applications.detail).toHaveBeenCalledWith(
      'fleet-1',
      'application-1',
    );
    expect(applications.decide).toHaveBeenCalledWith(
      'community-1',
      'fleet-1',
      'application-1',
      'officer-1',
      { decision: 'REJECT', note: 'Not now', revision: 1 },
    );
  });

  it('lists, sends and withdraws invitations', async () => {
    await controller.invitations('fleet-1');
    await controller.invite('community-1', 'fleet-1', 'officer-1', {
      username: 'Kell',
    });
    await controller.withdrawInvitation(
      'community-1',
      'fleet-1',
      'invitation-1',
    );

    expect(invitations.list).toHaveBeenCalledWith('fleet-1');
    expect(invitations.invite).toHaveBeenCalledWith(
      'community-1',
      'fleet-1',
      'Kell',
      'officer-1',
    );
    expect(invitations.withdraw).toHaveBeenCalledWith(
      'community-1',
      'fleet-1',
      'invitation-1',
    );
  });

  it('lists and removes members', async () => {
    await controller.members('fleet-1');
    await controller.removeMember(
      'community-1',
      'fleet-1',
      'membership-1',
      'officer-1',
      { reason: 'Inactive' },
    );

    expect(membership.list).toHaveBeenCalledWith('fleet-1');
    expect(membership.remove).toHaveBeenCalledWith(
      'community-1',
      'fleet-1',
      'membership-1',
      'Inactive',
      'officer-1',
    );
  });
});

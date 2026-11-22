import { FleetFeatureService } from '../fleet-feature.service';
import { MyFleetRecruitmentController } from './my-fleet-recruitment.controller';
import { FleetApplicationService } from './services/fleet-application.service';
import { FleetInvitationService } from './services/fleet-invitation.service';

describe('MyFleetRecruitmentController', () => {
  let feature: { assertEnabled: jest.Mock };
  let applications: { listMine: jest.Mock; withdraw: jest.Mock };
  let invitations: Record<string, jest.Mock>;
  let controller: MyFleetRecruitmentController;

  beforeEach(() => {
    feature = { assertEnabled: jest.fn(() => Promise.resolve()) };
    applications = {
      listMine: jest.fn(() => Promise.resolve([{ id: 'application-1' }])),
      withdraw: jest.fn(() => Promise.resolve({ id: 'application-1' })),
    };
    invitations = {
      listMine: jest.fn(() => Promise.resolve([{ id: 'invitation-1' }])),
      accept: jest.fn(() => Promise.resolve({ id: 'application-2' })),
      decline: jest.fn(() => Promise.resolve()),
    };
    controller = new MyFleetRecruitmentController(
      feature as unknown as FleetFeatureService,
      applications as unknown as FleetApplicationService,
      invitations as unknown as FleetInvitationService,
    );
  });

  it('lists and withdraws the caller’s own applications', async () => {
    await expect(controller.applications('user-1')).resolves.toEqual([
      { id: 'application-1' },
    ]);
    await controller.withdraw('application-1', 'user-1');

    expect(applications.listMine).toHaveBeenCalledWith('user-1');
    expect(applications.withdraw).toHaveBeenCalledWith(
      'application-1',
      'user-1',
    );
  });

  it('lists, accepts and declines the caller’s own invitations', async () => {
    await expect(controller.invitations('user-1')).resolves.toEqual([
      { id: 'invitation-1' },
    ]);
    await controller.accept('invitation-1', 'user-1', {
      characterId: 'character-1',
    });
    await controller.decline('invitation-1', 'user-1');

    expect(invitations.accept).toHaveBeenCalledWith(
      'invitation-1',
      'user-1',
      'character-1',
    );
    expect(invitations.decline).toHaveBeenCalledWith('invitation-1', 'user-1');
  });

  it('refuses everything while the Fleet feature is off', async () => {
    feature.assertEnabled.mockImplementation(() =>
      Promise.reject(new Error('Fleet Community is not enabled')),
    );

    await expect(controller.applications('user-1')).rejects.toThrow(
      'not enabled',
    );
    expect(applications.listMine).not.toHaveBeenCalled();
  });
});

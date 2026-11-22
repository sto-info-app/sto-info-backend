import { NotificationSeverity } from 'src/notification/enums/notification-severity.enum';
import { NotificationTarget } from 'src/notification/enums/notification-target.enum';
import { NotificationService } from 'src/notification/notification.service';

import { InMemoryManager } from '../../../../test/in-memory-manager';
import { FleetCommunityEntity } from '../../entities/fleet-community.entity';
import { ScopeRoleAssignmentEntity } from '../../entities/scope-role-assignment.entity';
import { StoArmadaEntity } from '../../entities/sto-armada.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { ArmadaPosition } from '../../enums/armada-position.enum';
import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import { ArmadaJoinRequestEntity } from '../entities/armada-join-request.entity';
import { ArmadaNotifierService } from './armada-notifier.service';

const FLEET_LINK =
  'https://sto.test/fleets/communities/fixture-community/fleets/windows/ninth-fleet';

describe('ArmadaNotifierService', () => {
  let db: InMemoryManager;
  let createNotification: jest.Mock;
  let service: ArmadaNotifierService;
  const originalUrl = process.env.APP_FRONTEND_URL;

  const request = (overrides: Partial<ArmadaJoinRequestEntity> = {}) =>
    ({
      id: 'request-1',
      armadaId: 'armada-1',
      fleetId: 'fleet-1',
      requestedByUserId: 'requester-1',
      reason: 'Full for now',
      ...overrides,
    }) as ArmadaJoinRequestEntity;

  beforeEach(() => {
    process.env.APP_FRONTEND_URL = 'https://sto.test';
    db = new InMemoryManager()
      .seed(FleetCommunityEntity, [
        {
          id: 'community-1',
          slug: 'fixture-community',
          ownerUserId: 'owner-1',
        },
      ])
      .seed(StoFleetEntity, [
        {
          id: 'fleet-1',
          communityId: 'community-1',
          exactGameName: 'Ninth Fleet',
          slug: 'ninth-fleet',
          platform: { name: 'Windows' },
        },
        { id: 'loose-fleet', communityId: null, exactGameName: 'Loose' },
      ])
      .seed(StoArmadaEntity, [{ id: 'armada-1', exactGameName: 'Sol Armada' }])
      .seed(ScopeRoleAssignmentEntity, [
        {
          communityId: 'community-1',
          fleetId: 'fleet-1',
          armadaId: null,
          userId: 'fleet-admin',
          role: FleetScopeRole.ADMIN,
          validTo: null,
          deletedAt: null,
        },
        {
          communityId: 'community-1',
          fleetId: null,
          armadaId: null,
          userId: 'community-admin',
          role: FleetScopeRole.ADMIN,
          validTo: null,
          deletedAt: null,
        },
        {
          communityId: 'community-1',
          fleetId: null,
          armadaId: null,
          userId: 'manager-1',
          role: FleetScopeRole.ADMIN,
          validTo: null,
          deletedAt: null,
        },
      ]);
    createNotification = jest.fn(() => Promise.resolve({}));
    service = new ArmadaNotifierService(db.asDataSource(), {
      createNotification,
    } as unknown as NotificationService);
  });

  afterEach(() => {
    process.env.APP_FRONTEND_URL = originalUrl;
  });

  it('tells the requester of an approval, and where the Fleet went', async () => {
    await service.approved(request(), ArmadaPosition.BETA);

    expect(createNotification).toHaveBeenCalledWith({
      target: NotificationTarget.USER,
      userId: 'requester-1',
      severity: NotificationSeverity.SUCCESS,
      title: 'Ninth Fleet joined Sol Armada',
      body: 'Your request for Ninth Fleet to join Sol Armada was approved. It is a Beta there.',
      linkUrl: FLEET_LINK,
    });
  });

  it('tells the requester of a rejection, with the reason', async () => {
    await service.rejected(request());

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Sol Armada did not take Ninth Fleet',
        body: 'Your request for Ninth Fleet to join Sol Armada was rejected. Reason: Full for now',
      }),
    );
  });

  it('says nothing of a reason a rejection somehow lacks', async () => {
    await service.rejected(request({ reason: null }));

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'Your request for Ninth Fleet to join Sol Armada was rejected. Reason: ',
      }),
    );
  });

  it('tells the requester of a lapse', async () => {
    await service.lapsed(request());

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Your request to join Sol Armada lapsed',
      }),
    );
  });

  it.each([
    ['a requester whose account has gone', { requestedByUserId: null }],
    ['a Fleet that has gone', { fleetId: 'missing' }],
    ['a Fleet no Community holds', { fleetId: 'loose-fleet' }],
    ['an Armada that has gone', { armadaId: 'missing' }],
  ])('tells nobody for %s', async (_what, overrides) => {
    await service.lapsed(request(overrides));

    expect(createNotification).not.toHaveBeenCalled();
  });

  it('sends no link when it does not know where the site is', async () => {
    delete process.env.APP_FRONTEND_URL;

    await service.lapsed(request());

    expect(createNotification.mock.calls[0][0]).not.toHaveProperty('linkUrl');
  });

  it('tells a removed Fleet’s Owner and Admins, but not the remover', async () => {
    await service.removed('armada-1', ['fleet-1'], 'Inactive', 'manager-1');

    expect(
      createNotification.mock.calls.map(
        ([call]: [{ userId: string }]) => call.userId,
      ),
    ).toEqual(['owner-1', 'fleet-admin', 'community-admin']);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: NotificationSeverity.WARNING,
        title: 'Ninth Fleet was taken out of Sol Armada',
        body: 'Ninth Fleet is no longer in Sol Armada. Reason: Inactive',
      }),
    );
  });

  it('tells only the Admins of a closed Community whose Owner was erased (FC-038)', async () => {
    db.rows(FleetCommunityEntity)[0].ownerUserId = null;

    await service.removed('armada-1', ['fleet-1'], 'Inactive', 'manager-1');

    expect(
      createNotification.mock.calls.map(
        ([call]: [{ userId: string }]) => call.userId,
      ),
    ).toEqual(['fleet-admin', 'community-admin']);
  });

  it('tells nobody of a removal from an Armada or of a Fleet that has gone', async () => {
    await service.removed('missing', ['fleet-1'], 'Inactive', 'manager-1');
    await service.removed('armada-1', ['missing'], 'Inactive', 'manager-1');

    expect(createNotification).not.toHaveBeenCalled();
  });

  it('logs a notification that fails, and carries on', async () => {
    createNotification.mockRejectedValue(new Error('mail down'));

    await expect(
      service.removed('armada-1', ['fleet-1'], 'Inactive', 'manager-1'),
    ).resolves.toBeUndefined();
    expect(createNotification).toHaveBeenCalledTimes(3);
  });
});

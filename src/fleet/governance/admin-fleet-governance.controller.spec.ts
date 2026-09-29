import { ROLES_KEY } from 'src/auth/roles.decorator';
import { UserRole } from 'src/user/enums/user-role.enum';

import { FleetFeatureService } from '../fleet-feature.service';
import {
  AdminFleetGovernanceController,
  AdminFleetInvestigationsController,
} from './admin-fleet-governance.controller';
import { DisputeRegistrationsService } from './services/dispute-registrations.service';
import { FleetInvestigationService } from './services/fleet-investigation.service';
import { OwnershipTransferService } from './services/ownership-transfer.service';
import { ScopeClosureService } from './services/scope-closure.service';
import { ScopeSuspensionService } from './services/scope-suspension.service';
import {
  armadaScope,
  communityScope,
  fleetScope,
} from './utilities/governance-scope.utility';

const COMMUNITY_ID = '27000000-0000-4000-8000-000000000001';
const ADMIN_ID = '27000000-0000-4000-8000-000000000002';
const NEW_OWNER_ID = '27000000-0000-4000-8000-000000000003';
const FLEET_ID = '27000000-0000-4000-8000-000000000004';
const ARMADA_ID = '27000000-0000-4000-8000-000000000005';
const WHY = { reason: 'Reported' };

describe('AdminFleetGovernanceController', () => {
  let assertEnabled: jest.Mock;
  let transfers: Record<string, jest.Mock>;
  let closure: Record<string, jest.Mock>;
  let suspension: Record<string, jest.Mock>;
  let registrations: Record<string, jest.Mock>;
  let investigations: Record<string, jest.Mock>;
  let controller: AdminFleetGovernanceController;

  beforeEach(() => {
    assertEnabled = jest.fn(() => Promise.resolve());
    transfers = {
      disputeView: jest.fn(() => Promise.resolve({ name: 'view' })),
      reassign: jest.fn(() => Promise.resolve()),
    };
    closure = {
      closeCommunity: jest.fn(() => Promise.resolve()),
      closeFleet: jest.fn(() => Promise.resolve()),
      closeArmadaAsSiteAdmin: jest.fn(() => Promise.resolve()),
    };
    suspension = {
      suspend: jest.fn(() => Promise.resolve()),
      reinstate: jest.fn(() => Promise.resolve()),
    };
    registrations = { scopesOf: jest.fn(() => Promise.resolve(['scope'])) };
    investigations = { open: jest.fn(() => Promise.resolve('look')) };
    controller = new AdminFleetGovernanceController(
      { assertEnabled } as unknown as FleetFeatureService,
      transfers as unknown as OwnershipTransferService,
      closure as unknown as ScopeClosureService,
      suspension as unknown as ScopeSuspensionService,
      registrations as unknown as DisputeRegistrationsService,
      investigations as unknown as FleetInvestigationService,
    );
  });

  it('is for site administrators only', () => {
    for (const type of [
      AdminFleetGovernanceController,
      AdminFleetInvestigationsController,
    ]) {
      expect(Reflect.getMetadata(ROLES_KEY, type)).toEqual([UserRole.ADMIN]);
    }
  });

  it('reads a Community for a dispute, with every registration of its names', async () => {
    await expect(controller.dispute(COMMUNITY_ID)).resolves.toEqual({
      name: 'view',
      scopes: ['scope'],
    });
    expect(transfers.disputeView).toHaveBeenCalledWith(COMMUNITY_ID);
    expect(registrations.scopesOf).toHaveBeenCalledWith(COMMUNITY_ID);
  });

  it('moves ownership with the reason given', async () => {
    await controller.reassign(
      COMMUNITY_ID,
      { toUserId: NEW_OWNER_ID, reason: 'Owner vanished' },
      ADMIN_ID,
    );

    expect(transfers.reassign).toHaveBeenCalledWith(
      COMMUNITY_ID,
      NEW_OWNER_ID,
      'Owner vanished',
      ADMIN_ID,
    );
  });

  // Recorded as a site administrator's, not as the Owner's.
  it('closes as a site administrator', async () => {
    await controller.close(COMMUNITY_ID, WHY, ADMIN_ID);
    await controller.closeFleet(COMMUNITY_ID, FLEET_ID, WHY, ADMIN_ID);
    await controller.closeArmada(COMMUNITY_ID, ARMADA_ID, WHY, ADMIN_ID);

    const request = { reason: 'Reported', actorUserId: ADMIN_ID };

    expect(closure.closeCommunity).toHaveBeenCalledWith(COMMUNITY_ID, {
      ...request,
      asSiteAdmin: true,
    });
    expect(closure.closeFleet).toHaveBeenCalledWith(COMMUNITY_ID, FLEET_ID, {
      ...request,
      asSiteAdmin: true,
    });
    expect(closure.closeArmadaAsSiteAdmin).toHaveBeenCalledWith(
      COMMUNITY_ID,
      ARMADA_ID,
      request,
    );
    expect(assertEnabled).toHaveBeenCalledTimes(3);
  });

  it('suspends and reinstates a Community, a Fleet or an Armada (FC-036)', async () => {
    await controller.suspend(COMMUNITY_ID, WHY, ADMIN_ID);
    await controller.reinstate(COMMUNITY_ID, WHY, ADMIN_ID);
    await controller.suspendFleet(COMMUNITY_ID, FLEET_ID, WHY, ADMIN_ID);
    await controller.reinstateFleet(COMMUNITY_ID, FLEET_ID, WHY, ADMIN_ID);
    await controller.suspendArmada(COMMUNITY_ID, ARMADA_ID, WHY, ADMIN_ID);
    await controller.reinstateArmada(COMMUNITY_ID, ARMADA_ID, WHY, ADMIN_ID);

    for (const scope of [
      communityScope(COMMUNITY_ID),
      fleetScope(COMMUNITY_ID, FLEET_ID),
      armadaScope(COMMUNITY_ID, ARMADA_ID),
    ]) {
      expect(suspension.suspend).toHaveBeenCalledWith(
        scope,
        'Reported',
        ADMIN_ID,
      );
      expect(suspension.reinstate).toHaveBeenCalledWith(
        scope,
        'Reported',
        ADMIN_ID,
      );
    }

    expect(assertEnabled).toHaveBeenCalledTimes(6);
  });

  it('opens a look into a Fleet with a purpose (FC-036)', async () => {
    await expect(
      controller.investigate(
        COMMUNITY_ID,
        FLEET_ID,
        { purpose: 'Checking an import' },
        ADMIN_ID,
      ),
    ).resolves.toBe('look');
    expect(investigations.open).toHaveBeenCalledWith(
      COMMUNITY_ID,
      FLEET_ID,
      ADMIN_ID,
      'Checking an import',
    );
  });
});

describe('AdminFleetInvestigationsController', () => {
  it('lists the caller’s open looks, and everybody’s', async () => {
    const investigations = {
      mine: jest.fn(() => Promise.resolve(['mine'])),
      log: jest.fn(() => Promise.resolve('page')),
    };
    const controller = new AdminFleetInvestigationsController(
      investigations as unknown as FleetInvestigationService,
    );

    await expect(controller.mine(ADMIN_ID)).resolves.toEqual(['mine']);
    await expect(controller.log({ page: 2, pageSize: 5 })).resolves.toBe(
      'page',
    );
    expect(investigations.mine).toHaveBeenCalledWith(ADMIN_ID);
    expect(investigations.log).toHaveBeenCalledWith(2, 5);
  });
});

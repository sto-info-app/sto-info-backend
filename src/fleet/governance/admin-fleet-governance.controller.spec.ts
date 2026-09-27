import { ROLES_KEY } from 'src/auth/roles.decorator';
import { UserRole } from 'src/user/enums/user-role.enum';

import { FleetFeatureService } from '../fleet-feature.service';
import { AdminFleetGovernanceController } from './admin-fleet-governance.controller';
import { OwnershipTransferService } from './services/ownership-transfer.service';
import { ScopeClosureService } from './services/scope-closure.service';

const COMMUNITY_ID = '27000000-0000-4000-8000-000000000001';
const ADMIN_ID = '27000000-0000-4000-8000-000000000002';
const NEW_OWNER_ID = '27000000-0000-4000-8000-000000000003';

describe('AdminFleetGovernanceController', () => {
  let assertEnabled: jest.Mock;
  let transfers: Record<string, jest.Mock>;
  let closure: Record<string, jest.Mock>;
  let controller: AdminFleetGovernanceController;

  beforeEach(() => {
    assertEnabled = jest.fn(() => Promise.resolve());
    transfers = {
      disputeView: jest.fn(() => Promise.resolve('view')),
      reassign: jest.fn(() => Promise.resolve()),
    };
    closure = { closeCommunity: jest.fn(() => Promise.resolve()) };
    controller = new AdminFleetGovernanceController(
      { assertEnabled } as unknown as FleetFeatureService,
      transfers as unknown as OwnershipTransferService,
      closure as unknown as ScopeClosureService,
    );
  });

  it('is for site administrators only', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, AdminFleetGovernanceController),
    ).toEqual([UserRole.ADMIN]);
  });

  it('reads a Community for a dispute', async () => {
    await expect(controller.dispute(COMMUNITY_ID)).resolves.toBe('view');
    expect(transfers.disputeView).toHaveBeenCalledWith(COMMUNITY_ID);
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
    await controller.close(COMMUNITY_ID, { reason: 'Reported' }, ADMIN_ID);

    expect(closure.closeCommunity).toHaveBeenCalledWith(COMMUNITY_ID, {
      reason: 'Reported',
      actorUserId: ADMIN_ID,
      asSiteAdmin: true,
    });
    expect(assertEnabled).toHaveBeenCalledTimes(1);
  });
});

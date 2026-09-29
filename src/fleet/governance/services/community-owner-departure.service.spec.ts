import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { UserProfileEntity } from 'src/user/entities/user-profile.entity';

import { InMemoryManager } from '../../../../test/in-memory-manager';
import { FleetCommunityEntity } from '../../entities/fleet-community.entity';
import { FleetScopeStatus } from '../../enums/fleet-scope-status.enum';
import {
  CommunityOwnerDepartureService,
  DEPARTURE_CLOSE_REASON,
  DEPARTURE_TRANSFER_REASON,
} from './community-owner-departure.service';
import { OwnershipTransferService } from './ownership-transfer.service';
import { ScopeClosureService } from './scope-closure.service';

const OWNER_ID = 'owner-1';
const ADMIN_ID = 'admin-1';

describe('CommunityOwnerDepartureService (FC-038)', () => {
  let db: InMemoryManager;
  let transfers: {
    successorFor: jest.Mock<(...args: unknown[]) => Promise<string | null>>;
    handToSuccessor: jest.Mock<(...args: unknown[]) => Promise<string | null>>;
  };
  let closure: {
    closeCommunity: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  };
  let service: CommunityOwnerDepartureService;

  beforeEach(() => {
    db = new InMemoryManager()
      .seed(FleetCommunityEntity, [
        {
          id: 'with-admin',
          name: 'Fixture Community',
          ownerUserId: OWNER_ID,
          status: FleetScopeStatus.ACTIVE,
          createdAt: new Date(1),
        },
        {
          id: 'alone',
          name: 'Lonely Community',
          ownerUserId: OWNER_ID,
          status: FleetScopeStatus.SUSPENDED,
          createdAt: new Date(2),
        },
        {
          id: 'closed',
          name: 'Closed Community',
          ownerUserId: OWNER_ID,
          status: FleetScopeStatus.CLOSED,
          createdAt: new Date(0),
        },
        {
          id: 'theirs',
          name: 'Somebody Else’s',
          ownerUserId: ADMIN_ID,
          status: FleetScopeStatus.ACTIVE,
          createdAt: new Date(3),
        },
      ])
      .seed(UserProfileEntity, [{ userId: ADMIN_ID, username: 'Deputy' }]);
    transfers = {
      successorFor: jest.fn(async (_manager, communityId) =>
        communityId === 'with-admin' ? ADMIN_ID : null,
      ),
      handToSuccessor: jest.fn(async communityId =>
        communityId === 'with-admin' ? ADMIN_ID : null,
      ),
    };
    closure = { closeCommunity: jest.fn(async () => ({})) };
    service = new CommunityOwnerDepartureService(
      db.asDataSource(),
      transfers as unknown as OwnershipTransferService,
      closure as unknown as ScopeClosureService,
    );
  });

  const outcomes = [
    {
      communityId: 'with-admin',
      name: 'Fixture Community',
      outcome: 'TRANSFER',
      toUserId: ADMIN_ID,
      toUsername: 'Deputy',
    },
    {
      communityId: 'alone',
      name: 'Lonely Community',
      outcome: 'CLOSE',
      toUserId: null,
      toUsername: null,
    },
  ];

  it('says what closing would do to each open Community, changing nothing', async () => {
    await expect(service.preview(OWNER_ID)).resolves.toEqual(outcomes);
    expect(transfers.handToSuccessor).not.toHaveBeenCalled();
    expect(closure.closeCommunity).not.toHaveBeenCalled();
  });

  it('hands one to its Admin and closes the one nobody can take', async () => {
    await expect(service.depart(OWNER_ID)).resolves.toEqual(outcomes);
    expect(transfers.handToSuccessor).toHaveBeenCalledWith(
      'with-admin',
      OWNER_ID,
      DEPARTURE_TRANSFER_REASON,
    );
    expect(closure.closeCommunity).toHaveBeenCalledTimes(1);
    expect(closure.closeCommunity).toHaveBeenCalledWith('alone', {
      actorUserId: OWNER_ID,
      reason: DEPARTURE_CLOSE_REASON,
    });
  });

  it('does nothing for somebody who owns nothing open', async () => {
    await expect(service.depart('nobody')).resolves.toEqual([]);
  });

  it('names an Admin with no username as unnamed', async () => {
    db.rows(UserProfileEntity).splice(0);

    await expect(service.preview(OWNER_ID)).resolves.toEqual([
      expect.objectContaining({ toUserId: ADMIN_ID, toUsername: null }),
      expect.objectContaining({ outcome: 'CLOSE' }),
    ]);
  });
});

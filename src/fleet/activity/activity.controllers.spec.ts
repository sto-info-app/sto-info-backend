import { PATH_METADATA } from '@nestjs/common/constants';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { FleetFeatureService } from '../fleet-feature.service';
import {
  armadaScope,
  communityScope,
  fleetScope,
} from '../governance/utilities/governance-scope.utility';
import {
  ArmadaActivityController,
  CommunityActivityController,
  FleetActivityController,
  PersonalActivityController,
} from './activity.controllers';
import { ActivityPageDto } from './dto/activity.dto';
import { ActivityFeedService } from './services/activity-feed.service';

const COMMUNITY_ID = '29000000-0000-4000-8000-000000000001';
const SCOPE_ID = '29000000-0000-4000-8000-000000000002';
const USER_ID = '29000000-0000-4000-8000-000000000003';
const PAGE: ActivityPageDto = { items: [], next: null };

const CASES = [
  {
    name: 'CommunityActivityController',
    type: CommunityActivityController,
    path: 'fleet-communities/:communityId/activity',
    id: COMMUNITY_ID,
    scope: communityScope(COMMUNITY_ID),
  },
  {
    name: 'FleetActivityController',
    type: FleetActivityController,
    path: 'fleet-communities/:communityId/fleets/:fleetId/activity',
    id: SCOPE_ID,
    scope: fleetScope(COMMUNITY_ID, SCOPE_ID),
  },
  {
    name: 'ArmadaActivityController',
    type: ArmadaActivityController,
    path: 'fleet-communities/:communityId/armadas/:armadaId/activity',
    id: SCOPE_ID,
    scope: armadaScope(COMMUNITY_ID, SCOPE_ID),
  },
];

describe('activity controllers', () => {
  let featureService: { assertEnabled: jest.Mock<() => Promise<void>> };
  let feed: {
    scopeFeed: jest.Mock<(...args: unknown[]) => Promise<ActivityPageDto>>;
    personalFeed: jest.Mock<(...args: unknown[]) => Promise<ActivityPageDto>>;
  };

  beforeEach(() => {
    featureService = { assertEnabled: jest.fn(async () => undefined) };
    feed = {
      scopeFeed: jest.fn(async () => PAGE),
      personalFeed: jest.fn(async () => PAGE),
    };
  });

  describe.each(CASES)('$name', ({ type, path, id, scope }) => {
    const controller = () =>
      new type(
        featureService as unknown as FleetFeatureService,
        feed as unknown as ActivityFeedService,
      );

    it('is addressed under its scope', () => {
      expect(Reflect.getMetadata(PATH_METADATA, type)).toBe(path);
    });

    it('reads the scope’s feed, signed in or not, once the feature is on', async () => {
      await expect(
        controller().feed(COMMUNITY_ID, id, null, { before: 'cursor' }),
      ).resolves.toBe(PAGE);
      expect(featureService.assertEnabled).toHaveBeenCalled();
      expect(feed.scopeFeed).toHaveBeenCalledWith(scope, null, {
        before: 'cursor',
      });
    });

    it('reads nothing while the feature is off', async () => {
      featureService.assertEnabled.mockRejectedValue(new Error('off'));

      await expect(
        controller().feed(COMMUNITY_ID, id, USER_ID, {}),
      ).rejects.toThrow('off');
      expect(feed.scopeFeed).not.toHaveBeenCalled();
    });
  });

  describe('PersonalActivityController', () => {
    const controller = () =>
      new PersonalActivityController(
        featureService as unknown as FleetFeatureService,
        feed as unknown as ActivityFeedService,
      );

    it('reads the caller’s own feed', async () => {
      await expect(controller().mine(USER_ID, {})).resolves.toBe(PAGE);
      expect(feed.personalFeed).toHaveBeenCalledWith(USER_ID, {});
    });

    it('reads nothing while the feature is off', async () => {
      featureService.assertEnabled.mockRejectedValue(new Error('off'));

      await expect(controller().mine(USER_ID, {})).rejects.toThrow('off');
      expect(feed.personalFeed).not.toHaveBeenCalled();
    });
  });
});

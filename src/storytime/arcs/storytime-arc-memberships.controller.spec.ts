import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { ArcMembershipStatus } from '../enums/arc-membership-status.enum';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeStoryMapper } from '../stories/storytime-story.mapper';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeArcStoryEntity } from './entities/storytime-arc-story.entity';
import { StorytimeArcEntity } from './entities/storytime-arc.entity';
import { StorytimeArcMembershipService } from './storytime-arc-membership.service';
import { StorytimeArcMembershipsController } from './storytime-arc-memberships.controller';
import { StorytimeArcMapper } from './storytime-arc.mapper';
import { StorytimeArcService } from './storytime-arc.service';

describe('StorytimeArcMembershipsController', () => {
  let controller: StorytimeArcMembershipsController;
  let membershipService: {
    findPendingForUser: jest.Mock;
    request: jest.Mock;
    approve: jest.Mock;
    decline: jest.Mock;
    leave: jest.Mock;
  };
  let arcService: { findOwnedByUser: jest.Mock };
  let storyService: {
    findOwnedByUser: jest.Mock;
    findVisibleByIds: jest.Mock;
  };
  let featureService: { assertFlagEnabled: jest.Mock };

  const userId = 'user-1';
  const arcId = 'arc-1';
  const storyId = 'story-1';
  const membershipId = 'membership-1';

  const membership = Object.assign(new StorytimeArcStoryEntity(), {
    id: membershipId,
    arcId,
    storyId,
    orderIndex: 1000,
    membershipStatus: ArcMembershipStatus.INVITED,
    introductoryNote: null,
  });

  beforeEach(async () => {
    membershipService = {
      findPendingForUser: jest.fn().mockResolvedValue([membership]),
      request: jest.fn().mockResolvedValue(membership),
      approve: jest.fn().mockResolvedValue(membership),
      decline: jest.fn().mockResolvedValue(membership),
      leave: jest.fn().mockResolvedValue(membership),
    };
    arcService = {
      findOwnedByUser: jest
        .fn()
        .mockResolvedValue([
          Object.assign(new StorytimeArcEntity(), { id: arcId }),
        ]),
    };
    storyService = {
      findOwnedByUser: jest
        .fn()
        .mockResolvedValue([
          Object.assign(new StorytimeStoryEntity(), { id: storyId }),
        ]),
      findVisibleByIds: jest.fn().mockResolvedValue([
        Object.assign(new StorytimeStoryEntity(), {
          id: storyId,
          slug: 'a-story',
          title: 'A Story',
          upVoteCount: 0,
          downVoteCount: 0,
        }),
      ]),
    };
    featureService = {
      assertFlagEnabled: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorytimeArcMembershipsController],
      providers: [
        {
          provide: StorytimeArcMembershipService,
          useValue: membershipService,
        },
        { provide: StorytimeArcService, useValue: arcService },
        { provide: StorytimeStoryService, useValue: storyService },
        StorytimeArcMapper,
        StorytimeStoryMapper,
        { provide: StorytimeFeatureService, useValue: featureService },
      ],
    }).compile();

    controller = module.get<StorytimeArcMembershipsController>(
      StorytimeArcMembershipsController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  // Invitations to their Stories and requests to their Arcs are the same kind
  // of thing to the person answering, so both are asked for at once.
  it('asks about both sides when listing what is waiting', async () => {
    const result = await controller.findPending(userId);

    expect(result).toHaveLength(1);
    expect(membershipService.findPendingForUser).toHaveBeenCalledWith(
      [storyId],
      [arcId],
    );
  });

  it('offers a Story to an Arc', async () => {
    await controller.request(arcId, { storyId }, userId);

    expect(membershipService.request).toHaveBeenCalledWith(
      arcId,
      storyId,
      userId,
    );
  });

  it.each([
    ['approve', 'approve'],
    ['decline', 'decline'],
    ['leave', 'leave'],
  ])('%ss a membership', async (_name, method) => {
    const act =
      controller[method as 'approve' | 'decline' | 'leave'].bind(controller);

    await act(membershipId, userId);

    expect(
      membershipService[method as 'approve' | 'decline' | 'leave'],
    ).toHaveBeenCalledWith(membershipId, userId);
  });

  it('returns the Story alongside the answered membership', async () => {
    const result = await controller.approve(membershipId, userId);

    expect(result[0].story?.title).toBe('A Story');
  });

  describe('when creation is switched off', () => {
    beforeEach(() => {
      featureService.assertFlagEnabled.mockRejectedValue(
        new ForbiddenException(),
      );
    });

    it.each([
      ['findPending', () => controller.findPending(userId)],
      ['request', () => controller.request(arcId, { storyId }, userId)],
      ['approve', () => controller.approve(membershipId, userId)],
      ['decline', () => controller.decline(membershipId, userId)],
      ['leave', () => controller.leave(membershipId, userId)],
    ])('refuses %s', async (_name, act) => {
      await expect(act()).rejects.toThrow(ForbiddenException);
      expect(featureService.assertFlagEnabled).toHaveBeenCalledWith(
        STORYTIME_FEATURE_FLAGS.CREATION_ENABLED,
      );
    });
  });
});

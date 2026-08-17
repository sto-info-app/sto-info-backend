import { Test, TestingModule } from '@nestjs/testing';
import { StorytimeActivityType } from '../enums/storytime-activity-type.enum';
import { FeedEntry } from './storytime-activity-feed.service';
import { StorytimeActivityFeedItemEntity } from './entities/storytime-activity-feed-item.entity';
import { StorytimeActivityFeedService } from './storytime-activity-feed.service';
import {
  FollowTargetKind,
  StorytimeFollowService,
} from './storytime-follow.service';
import { StorytimeFollowsController } from './storytime-follows.controller';
import { StorytimeSocialMapper } from './storytime-social.mapper';

describe('StorytimeFollowsController', () => {
  let controller: StorytimeFollowsController;
  let followService: {
    follow: jest.Mock;
    unfollow: jest.Mock;
    isFollowing: jest.Mock;
    countFollowers: jest.Mock;
  };
  let feedService: {
    findFeed: jest.Mock;
    countUnread: jest.Mock;
    markRead: jest.Mock;
  };

  const readerId = 'reader-1';
  const targetId = '11111111-1111-4111-8111-111111111111';

  const entry: FeedEntry = {
    item: {
      id: 'item-1',
      activityType: StorytimeActivityType.STORY_PUBLISHED,
      actorUserId: 'writer-1',
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
    } as StorytimeActivityFeedItemEntity,
    story: null,
    chapter: null,
    arc: null,
  };

  beforeEach(async () => {
    followService = {
      follow: jest.fn().mockResolvedValue(true),
      unfollow: jest.fn().mockResolvedValue(false),
      isFollowing: jest.fn().mockResolvedValue(true),
      countFollowers: jest.fn().mockResolvedValue(4),
    };
    feedService = {
      findFeed: jest.fn().mockResolvedValue([entry]),
      countUnread: jest.fn().mockResolvedValue(2),
      markRead: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorytimeFollowsController],
      providers: [
        StorytimeSocialMapper,
        { provide: StorytimeFollowService, useValue: followService },
        { provide: StorytimeActivityFeedService, useValue: feedService },
      ],
    }).compile();

    controller = module.get<StorytimeFollowsController>(
      StorytimeFollowsController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('follows something and reports the new state', async () => {
    await expect(
      controller.follow(FollowTargetKind.STORY, targetId, readerId),
    ).resolves.toEqual({ isFollowing: true, followerCount: 4 });

    expect(followService.follow).toHaveBeenCalledWith(
      FollowTargetKind.STORY,
      targetId,
      readerId,
    );
  });

  it('stops following something and reports the new state', async () => {
    await expect(
      controller.unfollow(FollowTargetKind.ARC, targetId, readerId),
    ).resolves.toEqual({ isFollowing: false, followerCount: 4 });

    expect(followService.unfollow).toHaveBeenCalledWith(
      FollowTargetKind.ARC,
      targetId,
      readerId,
    );
  });

  it('reports whether the caller follows something', async () => {
    await expect(
      controller.findState(FollowTargetKind.CREATOR, targetId, readerId),
    ).resolves.toEqual({ isFollowing: true, followerCount: 4 });
  });

  it('reads the feed', async () => {
    const feed = await controller.findFeed(readerId, '3');

    expect(feedService.findFeed).toHaveBeenCalledWith(readerId, 3);
    expect(feed).toHaveLength(1);
    expect(feed[0].id).toBe('item-1');
  });

  // A missing or unreadable page is the first page, not an error.
  it.each([
    ['nothing', undefined],
    ['nonsense', 'first'],
    ['zero', '0'],
  ])('reads the first page when asked for %s', async (_name, page) => {
    await controller.findFeed(readerId, page);

    expect(feedService.findFeed).toHaveBeenCalledWith(readerId, 1);
  });

  it('counts what is unread', async () => {
    await expect(controller.countUnread(readerId)).resolves.toEqual({
      unread: 2,
    });
  });

  it('marks the feed as read', async () => {
    await controller.markRead(readerId);

    expect(feedService.markRead).toHaveBeenCalledWith(readerId);
  });
});

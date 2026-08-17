import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { StorytimeArcEntity } from '../arcs/entities/storytime-arc.entity';
import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { ChapterStatus } from '../enums/chapter-status.enum';
import { StorytimeActivityType } from '../enums/storytime-activity-type.enum';
import { StorytimeModerationStatus } from '../enums/storytime-moderation-status.enum';
import { StorytimeVisibility } from '../enums/storytime-visibility.enum';
import { StoryStatus } from '../enums/story-status.enum';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeActivityFeedItemEntity } from './entities/storytime-activity-feed-item.entity';
import { StorytimeFeedStateEntity } from './entities/storytime-feed-state.entity';
import { StorytimeActivityFeedService } from './storytime-activity-feed.service';
import { Follows, StorytimeFollowService } from './storytime-follow.service';

describe('StorytimeActivityFeedService', () => {
  let service: StorytimeActivityFeedService;
  let itemRepository: { find: jest.Mock; create: jest.Mock; save: jest.Mock };
  let stateRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let storyRepository: { find: jest.Mock };
  let chapterRepository: { find: jest.Mock };
  let arcRepository: { find: jest.Mock };
  let followService: { findFollows: jest.Mock };

  const readerId = 'reader-1';

  /**
   * Builds a feed item.
   *
   * @param overrides - What differs from a plain Story announcement.
   * @returns The item.
   */
  const buildItem = (
    overrides: Partial<StorytimeActivityFeedItemEntity> = {},
  ): StorytimeActivityFeedItemEntity =>
    ({
      id: 'item-1',
      activityType: StorytimeActivityType.STORY_PUBLISHED,
      actorUserId: 'writer-1',
      storyId: 'story-1',
      chapterId: null,
      arcId: null,
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    }) as StorytimeActivityFeedItemEntity;

  /**
   * Builds a readable Story.
   *
   * @param overrides - What differs from a published, public, active Story.
   * @returns The Story.
   */
  const buildStory = (
    overrides: Partial<StorytimeStoryEntity> = {},
  ): StorytimeStoryEntity =>
    ({
      id: 'story-1',
      title: 'The Long Patrol',
      slug: 'the-long-patrol',
      status: StoryStatus.PUBLISHED,
      visibility: StorytimeVisibility.PUBLIC,
      moderationStatus: StorytimeModerationStatus.ACTIVE,
      ...overrides,
    }) as StorytimeStoryEntity;

  /**
   * Builds a readable Chapter.
   *
   * @param overrides - What differs from a published, active Chapter.
   * @returns The Chapter.
   */
  const buildChapter = (
    overrides: Partial<StorytimeChapterEntity> = {},
  ): StorytimeChapterEntity =>
    ({
      id: 'chapter-1',
      title: 'First Contact',
      slug: 'first-contact',
      status: ChapterStatus.PUBLISHED,
      moderationStatus: StorytimeModerationStatus.ACTIVE,
      ...overrides,
    }) as StorytimeChapterEntity;

  /**
   * Builds a readable Arc.
   *
   * @param overrides - What differs from a public, active Arc.
   * @returns The Arc.
   */
  const buildArc = (
    overrides: Partial<StorytimeArcEntity> = {},
  ): StorytimeArcEntity =>
    ({
      id: 'arc-1',
      title: 'The Dominion War',
      slug: 'the-dominion-war',
      visibility: StorytimeVisibility.PUBLIC,
      moderationStatus: StorytimeModerationStatus.ACTIVE,
      ...overrides,
    }) as StorytimeArcEntity;

  /**
   * Builds what a reader follows.
   *
   * @param overrides - What they follow.
   * @returns The follows.
   */
  const buildFollows = (overrides: Partial<Follows> = {}): Follows => ({
    creatorUserIds: [],
    storyIds: [],
    arcIds: [],
    ...overrides,
  });

  beforeEach(async () => {
    itemRepository = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation((item: unknown) => item),
      save: jest.fn().mockImplementation((item: unknown) => item),
    };
    stateRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((state: unknown) => state),
      save: jest.fn().mockResolvedValue(undefined),
    };
    storyRepository = { find: jest.fn().mockResolvedValue([]) };
    chapterRepository = { find: jest.fn().mockResolvedValue([]) };
    arcRepository = { find: jest.fn().mockResolvedValue([]) };
    followService = {
      findFollows: jest.fn().mockResolvedValue(buildFollows()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeActivityFeedService,
        {
          provide: getRepositoryToken(StorytimeActivityFeedItemEntity),
          useValue: itemRepository,
        },
        {
          provide: getRepositoryToken(StorytimeFeedStateEntity),
          useValue: stateRepository,
        },
        {
          provide: getRepositoryToken(StorytimeStoryEntity),
          useValue: storyRepository,
        },
        {
          provide: getRepositoryToken(StorytimeChapterEntity),
          useValue: chapterRepository,
        },
        {
          provide: getRepositoryToken(StorytimeArcEntity),
          useValue: arcRepository,
        },
        { provide: StorytimeFollowService, useValue: followService },
      ],
    }).compile();

    service = module.get<StorytimeActivityFeedService>(
      StorytimeActivityFeedService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('record', () => {
    it('writes what happened', async () => {
      await service.record(
        StorytimeActivityType.CHAPTER_PUBLISHED,
        'writer-1',
        { storyId: 'story-1', chapterId: 'chapter-1' },
      );

      expect(itemRepository.create).toHaveBeenCalledWith({
        activityType: StorytimeActivityType.CHAPTER_PUBLISHED,
        actorUserId: 'writer-1',
        storyId: 'story-1',
        chapterId: 'chapter-1',
        arcId: null,
      });
      expect(itemRepository.save).toHaveBeenCalled();
    });

    it('names nothing when nothing is named', async () => {
      await service.record(StorytimeActivityType.SPOTLIGHT_SELECTED, 'admin-1');

      expect(itemRepository.create).toHaveBeenCalledWith({
        activityType: StorytimeActivityType.SPOTLIGHT_SELECTED,
        actorUserId: 'admin-1',
        storyId: null,
        chapterId: null,
        arcId: null,
      });
    });
  });

  describe('findFeed', () => {
    // Following nobody is not a query, it is an empty page.
    it('does not query when the reader follows nothing', async () => {
      await expect(service.findFeed(readerId)).resolves.toEqual([]);
      expect(itemRepository.find).not.toHaveBeenCalled();
    });

    it('asks after the items a follow could produce', async () => {
      followService.findFollows.mockResolvedValue(
        buildFollows({
          creatorUserIds: ['writer-1'],
          storyIds: ['story-1'],
          arcIds: ['arc-1'],
        }),
      );

      await service.findFeed(readerId, 2, 10);

      const [options] = itemRepository.find.mock.calls[0] as [
        { where: unknown[]; skip: number; take: number },
      ];

      expect(options.where).toHaveLength(3);
      expect(options.skip).toBe(10);
      expect(options.take).toBe(10);
    });

    it('attaches the Story an item names', async () => {
      followService.findFollows.mockResolvedValue(
        buildFollows({ storyIds: ['story-1'] }),
      );
      itemRepository.find.mockResolvedValue([buildItem()]);
      storyRepository.find.mockResolvedValue([buildStory()]);

      const feed = await service.findFeed(readerId);

      expect(feed).toHaveLength(1);
      expect(feed[0].story?.title).toBe('The Long Patrol');
      expect(feed[0].chapter).toBeNull();
      expect(feed[0].arc).toBeNull();
    });

    it('attaches the Chapter and Arc an item names', async () => {
      followService.findFollows.mockResolvedValue(
        buildFollows({ arcIds: ['arc-1'] }),
      );
      itemRepository.find.mockResolvedValue([
        buildItem({
          activityType: StorytimeActivityType.CHAPTER_PUBLISHED,
          chapterId: 'chapter-1',
          arcId: 'arc-1',
        }),
      ]);
      storyRepository.find.mockResolvedValue([buildStory()]);
      chapterRepository.find.mockResolvedValue([buildChapter()]);
      arcRepository.find.mockResolvedValue([buildArc()]);

      const feed = await service.findFeed(readerId);

      expect(feed[0].chapter?.slug).toBe('first-contact');
      expect(feed[0].arc?.slug).toBe('the-dominion-war');
    });

    it('keeps an item that names only an Arc', async () => {
      followService.findFollows.mockResolvedValue(
        buildFollows({ arcIds: ['arc-1'] }),
      );
      itemRepository.find.mockResolvedValue([
        buildItem({
          activityType: StorytimeActivityType.ARC_UPDATED,
          storyId: null,
          arcId: 'arc-1',
        }),
      ]);
      arcRepository.find.mockResolvedValue([buildArc()]);

      await expect(service.findFeed(readerId)).resolves.toHaveLength(1);
    });

    it.each([
      ['unpublished', { status: StoryStatus.DRAFT }],
      ['private', { visibility: StorytimeVisibility.PRIVATE }],
      ['removed', { moderationStatus: StorytimeModerationStatus.REMOVED }],
    ])(
      'drops an item whose Story has since become %s',
      async (_name, overrides) => {
        followService.findFollows.mockResolvedValue(
          buildFollows({ storyIds: ['story-1'] }),
        );
        itemRepository.find.mockResolvedValue([buildItem()]);
        storyRepository.find.mockResolvedValue([buildStory(overrides)]);

        await expect(service.findFeed(readerId)).resolves.toEqual([]);
      },
    );

    it.each([
      ['unpublished', { status: ChapterStatus.DRAFT }],
      ['removed', { moderationStatus: StorytimeModerationStatus.REMOVED }],
    ])(
      'drops an item whose Chapter has since become %s',
      async (_name, overrides) => {
        followService.findFollows.mockResolvedValue(
          buildFollows({ storyIds: ['story-1'] }),
        );
        itemRepository.find.mockResolvedValue([
          buildItem({
            activityType: StorytimeActivityType.CHAPTER_PUBLISHED,
            chapterId: 'chapter-1',
          }),
        ]);
        storyRepository.find.mockResolvedValue([buildStory()]);
        chapterRepository.find.mockResolvedValue([buildChapter(overrides)]);

        await expect(service.findFeed(readerId)).resolves.toEqual([]);
      },
    );

    it.each([
      ['private', { visibility: StorytimeVisibility.PRIVATE }],
      ['removed', { moderationStatus: StorytimeModerationStatus.REMOVED }],
    ])(
      'drops an item whose Arc has since become %s',
      async (_name, overrides) => {
        followService.findFollows.mockResolvedValue(
          buildFollows({ arcIds: ['arc-1'] }),
        );
        itemRepository.find.mockResolvedValue([
          buildItem({
            activityType: StorytimeActivityType.ARC_UPDATED,
            storyId: null,
            arcId: 'arc-1',
          }),
        ]);
        arcRepository.find.mockResolvedValue([buildArc(overrides)]);

        await expect(service.findFeed(readerId)).resolves.toEqual([]);
      },
    );

    it('drops a Chapter announcement whose Story is gone', async () => {
      followService.findFollows.mockResolvedValue(
        buildFollows({ creatorUserIds: ['writer-1'] }),
      );
      itemRepository.find.mockResolvedValue([
        buildItem({
          activityType: StorytimeActivityType.CHAPTER_PUBLISHED,
          chapterId: 'chapter-1',
        }),
      ]);
      chapterRepository.find.mockResolvedValue([buildChapter()]);

      await expect(service.findFeed(readerId)).resolves.toEqual([]);
    });

    // The identifiers are collected once per kind, however many items name them.
    it('asks for each named thing once', async () => {
      followService.findFollows.mockResolvedValue(
        buildFollows({ storyIds: ['story-1'] }),
      );
      itemRepository.find.mockResolvedValue([
        buildItem({ id: 'item-1' }),
        buildItem({ id: 'item-2' }),
      ]);
      storyRepository.find.mockResolvedValue([buildStory()]);

      await service.findFeed(readerId);

      expect(storyRepository.find).toHaveBeenCalledTimes(1);
      expect(storyRepository.find).toHaveBeenCalledWith({
        where: { id: expect.objectContaining({ value: ['story-1'] }) },
      });
      expect(chapterRepository.find).not.toHaveBeenCalled();
      expect(arcRepository.find).not.toHaveBeenCalled();
    });
  });

  describe('countUnread', () => {
    it('counts nothing when the reader follows nothing', async () => {
      await expect(service.countUnread(readerId)).resolves.toBe(0);
      expect(itemRepository.find).not.toHaveBeenCalled();
    });

    it('counts everything when the reader has never looked', async () => {
      followService.findFollows.mockResolvedValue(
        buildFollows({ storyIds: ['story-1'] }),
      );
      itemRepository.find.mockResolvedValue([buildItem()]);
      storyRepository.find.mockResolvedValue([buildStory()]);

      await expect(service.countUnread(readerId)).resolves.toBe(1);

      const [options] = itemRepository.find.mock.calls[0] as [
        { where: Record<string, unknown>[] },
      ];

      expect(options.where[0]).not.toHaveProperty('occurredAt');
    });

    it('counts only what happened since the reader last looked', async () => {
      const lastReadAt = new Date('2026-01-01T00:00:00.000Z');

      stateRepository.findOne.mockResolvedValue({
        userId: readerId,
        lastReadAt,
      });
      followService.findFollows.mockResolvedValue(
        buildFollows({ storyIds: ['story-1'] }),
      );

      await service.countUnread(readerId);

      const [options] = itemRepository.find.mock.calls[0] as [
        { where: Record<string, unknown>[] },
      ];

      expect(options.where[0]).toHaveProperty('occurredAt');
    });

    // A badge promising three new items that turn out to be one is worse than
    // no badge, so unread is counted over what is still readable.
    it('does not count what the reader can no longer read', async () => {
      followService.findFollows.mockResolvedValue(
        buildFollows({ storyIds: ['story-1'] }),
      );
      itemRepository.find.mockResolvedValue([buildItem()]);
      storyRepository.find.mockResolvedValue([
        buildStory({ moderationStatus: StorytimeModerationStatus.REMOVED }),
      ]);

      await expect(service.countUnread(readerId)).resolves.toBe(0);
    });
  });

  describe('markRead', () => {
    it('moves the watermark to now', async () => {
      await service.markRead(readerId);

      const [state] = stateRepository.create.mock.calls[0] as [
        { userId: string; lastReadAt: Date },
      ];

      expect(state.userId).toBe(readerId);
      expect(state.lastReadAt).toBeInstanceOf(Date);
      expect(stateRepository.save).toHaveBeenCalled();
    });
  });
});

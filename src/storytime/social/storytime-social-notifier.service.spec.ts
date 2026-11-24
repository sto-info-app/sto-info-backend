import { Logger } from '@nestjs/common';

import { Repository } from 'typeorm';

import { NotificationEmailType } from 'src/notification/email/notification-email-type.enum';
import { NotificationSeverity } from 'src/notification/enums/notification-severity.enum';
import { NotificationTarget } from 'src/notification/enums/notification-target.enum';
import { NotificationService } from 'src/notification/notification.service';

import { StorytimeArcEntity } from '../arcs/entities/storytime-arc.entity';
import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { ChapterStatus } from '../enums/chapter-status.enum';
import { StoryStatus } from '../enums/story-status.enum';
import { StorytimeModerationStatus } from '../enums/storytime-moderation-status.enum';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeVisibility } from '../enums/storytime-visibility.enum';
import { StorytimeAuthorService } from '../shared/storytime-author.service';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeCreatorFollowEntity } from './entities/storytime-creator-follow.entity';
import { StorytimeStoryFollowEntity } from './entities/storytime-story-follow.entity';
import { StorytimeSocialNotifier } from './storytime-social-notifier.service';

type AnyMock = jest.Mock<any>;

describe('StorytimeSocialNotifier (sc-1067)', () => {
  const OWNER = 'owner-1';
  const READER = 'reader-1';
  let story: Partial<StorytimeStoryEntity> | null;
  let chapter: Partial<StorytimeChapterEntity> | null;
  let arc: Partial<StorytimeArcEntity> | null;
  let storyFollows: { userId: string }[];
  let creatorFollows: { userId: string }[];
  let createNotification: AnyMock;
  let findAuthor: AnyMock;
  let notifier: StorytimeSocialNotifier;

  const repository = (value: () => unknown, rows?: () => unknown[]) =>
    ({
      findOne: jest.fn(async () => value()),
      find: jest.fn(async () => rows?.() ?? []),
    }) as unknown as Repository<never>;

  /** Each notice written, as who it was for and what it said. */
  const notices = () =>
    createNotification.mock.calls.map(([dto, options]) => ({
      userId: dto.userId,
      title: dto.title,
      body: dto.body,
      linkUrl: dto.linkUrl,
      email: options.email,
    }));

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    story = {
      id: 'story-1',
      ownerUserId: OWNER,
      title: 'The Long Watch',
      slug: 'the-long-watch',
      status: StoryStatus.PUBLISHED,
      visibility: StorytimeVisibility.PUBLIC,
      moderationStatus: StorytimeModerationStatus.ACTIVE,
    };
    chapter = {
      id: 'chapter-1',
      storyId: 'story-1',
      title: 'Night Shift',
      slug: 'night-shift',
      status: ChapterStatus.PUBLISHED,
      moderationStatus: StorytimeModerationStatus.ACTIVE,
    };
    arc = {
      id: 'arc-1',
      ownerUserId: OWNER,
      title: 'Frontier Tales',
      slug: 'frontier-tales',
    };
    storyFollows = [];
    creatorFollows = [];
    createNotification = jest.fn(async () => ({}));
    findAuthor = jest.fn(async (userId: string) =>
      userId === 'nameless' ? null : { username: `${userId}-name` },
    );
    notifier = new StorytimeSocialNotifier(
      repository(() => story) as unknown as Repository<StorytimeStoryEntity>,
      repository(
        () => chapter,
      ) as unknown as Repository<StorytimeChapterEntity>,
      repository(() => arc) as unknown as Repository<StorytimeArcEntity>,
      repository(
        () => null,
        () => creatorFollows,
      ) as unknown as Repository<StorytimeCreatorFollowEntity>,
      repository(
        () => null,
        () => storyFollows,
      ) as unknown as Repository<StorytimeStoryFollowEntity>,
      { findAuthor } as unknown as StorytimeAuthorService,
      { createNotification } as unknown as NotificationService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('followed', () => {
    it('tells a creator of a new follower', async () => {
      await notifier.followed('CREATOR', OWNER, READER);

      expect(createNotification).toHaveBeenCalledWith(
        {
          target: NotificationTarget.USER,
          userId: OWNER,
          severity: NotificationSeverity.INFO,
          title: 'New follower',
          body: 'reader-1-name followed you on Storytime.',
          linkUrl: '/storytime/creators/reader-1',
        },
        { email: NotificationEmailType.STORYTIME_FOLLOWER },
      );
    });

    it.each([
      [
        StorytimeTargetType.STORY,
        'reader-1-name followed your Story "The Long Watch".',
        '/storytime/stories/the-long-watch',
      ],
      [
        StorytimeTargetType.ARC,
        'reader-1-name followed your Arc "Frontier Tales".',
        '/storytime/arcs/frontier-tales',
      ],
    ])('tells the owner of a followed %s', async (type, body, linkUrl) => {
      await notifier.followed(type, 'target-1', READER);

      expect(notices()).toEqual([
        {
          userId: OWNER,
          title: 'New follower',
          body,
          linkUrl,
          email: NotificationEmailType.STORYTIME_FOLLOWER,
        },
      ]);
    });

    it('tells nobody when the work has gone', async () => {
      story = null;

      await notifier.followed(StorytimeTargetType.STORY, 'story-1', READER);

      expect(createNotification).not.toHaveBeenCalled();
    });

    it('calls somebody without a name Someone', async () => {
      await notifier.followed('CREATOR', OWNER, 'nameless');

      expect(notices()[0].body).toBe('Someone followed you on Storytime.');
    });
  });

  describe('commented', () => {
    const comment = (targetType: StorytimeTargetType, targetId: string) => ({
      targetType,
      targetId,
      authorUserId: READER,
    });

    it('tells the author of a comment on their Chapter, without its words', async () => {
      await notifier.commented(
        comment(StorytimeTargetType.CHAPTER, 'chapter-1'),
        null,
      );

      expect(notices()).toEqual([
        {
          userId: OWNER,
          title: 'New comment on your work',
          body: 'reader-1-name commented on your Chapter "Night Shift".',
          linkUrl: '/storytime/stories/the-long-watch/chapters/night-shift',
          email: NotificationEmailType.STORYTIME_COMMENT,
        },
      ]);
    });

    it('tells the commenter of a reply, and the author of the comment', async () => {
      await notifier.commented(
        comment(StorytimeTargetType.STORY, 'story-1'),
        'commenter-1',
      );

      expect(notices()).toEqual([
        {
          userId: 'commenter-1',
          title: 'New reply to your comment',
          body: 'reader-1-name replied to your comment on Story "The Long Watch".',
          linkUrl: '/storytime/stories/the-long-watch',
          email: NotificationEmailType.STORYTIME_REPLY,
        },
        expect.objectContaining({
          userId: OWNER,
          email: NotificationEmailType.STORYTIME_COMMENT,
        }),
      ]);
    });

    // An author answered on their own work hears once, of the reply.
    it('tells an author replied to once', async () => {
      await notifier.commented(
        comment(StorytimeTargetType.ARC, 'arc-1'),
        OWNER,
      );

      expect(notices()).toEqual([
        expect.objectContaining({
          userId: OWNER,
          email: NotificationEmailType.STORYTIME_REPLY,
        }),
      ]);
    });

    it('tells nobody of their own comment', async () => {
      await notifier.commented(
        {
          ...comment(StorytimeTargetType.STORY, 'story-1'),
          authorUserId: OWNER,
        },
        null,
      );

      expect(createNotification).not.toHaveBeenCalled();
    });

    it.each([
      [
        'a Chapter that has gone',
        StorytimeTargetType.CHAPTER,
        () => (chapter = null),
      ],
      [
        'a Chapter whose Story has gone',
        StorytimeTargetType.CHAPTER,
        () => (story = null),
      ],
      ['an Arc that has gone', StorytimeTargetType.ARC, () => (arc = null)],
      ['a kind nobody is told of', StorytimeTargetType.CHARACTER, () => null],
    ])('tells nobody of a comment on %s', async (_name, type, arrange) => {
      arrange();

      await notifier.commented(comment(type, 'x'), null);

      expect(createNotification).not.toHaveBeenCalled();
    });
  });

  describe('reacted', () => {
    it('tells the author of a reaction', async () => {
      await notifier.reacted(StorytimeTargetType.STORY, 'story-1', READER);

      expect(notices()).toEqual([
        {
          userId: OWNER,
          title: 'New reaction to your work',
          body: 'reader-1-name reacted to your Story "The Long Watch".',
          linkUrl: '/storytime/stories/the-long-watch',
          email: NotificationEmailType.STORYTIME_REACTION,
        },
      ]);
    });

    it('tells nobody of a reaction to work that has gone', async () => {
      story = null;

      await notifier.reacted(StorytimeTargetType.STORY, 'story-1', READER);

      expect(createNotification).not.toHaveBeenCalled();
    });
  });

  describe('published', () => {
    beforeEach(() => {
      storyFollows = [{ userId: 'reader-1' }, { userId: 'reader-2' }];
      creatorFollows = [{ userId: 'reader-2' }, { userId: OWNER }];
    });

    it('tells each follower of the Story or its creator once of a new Chapter', async () => {
      await notifier.published('story-1', 'chapter-1', 'collaborator-1');

      expect(notices()).toEqual(
        ['reader-1', 'reader-2'].map(userId => ({
          userId,
          title: 'New Chapter',
          body: '"Night Shift" is out in "The Long Watch".',
          linkUrl: '/storytime/stories/the-long-watch/chapters/night-shift',
          email: NotificationEmailType.STORYTIME_FOLLOWED_PUBLICATION,
        })),
      );
    });

    it('tells them of a new Story', async () => {
      await notifier.published('story-1', null, OWNER);

      expect(notices()[0]).toEqual({
        userId: 'reader-1',
        title: 'New Story',
        body: 'owner-1-name published "The Long Watch".',
        linkUrl: '/storytime/stories/the-long-watch',
        email: NotificationEmailType.STORYTIME_FOLLOWED_PUBLICATION,
      });
    });

    // A collaborator who follows the Story does not hear of their own Chapter.
    it('leaves out whoever published it', async () => {
      await notifier.published('story-1', 'chapter-1', 'reader-1');

      expect(notices().map(notice => notice.userId)).toEqual(['reader-2']);
    });

    it.each([
      ['a Story that has gone', () => (story = null)],
      ['a draft', () => (story = { ...story, status: StoryStatus.DRAFT })],
      [
        'a private Story',
        () => (story = { ...story, visibility: StorytimeVisibility.PRIVATE }),
      ],
      [
        'a removed Story',
        () =>
          (story = {
            ...story,
            moderationStatus: StorytimeModerationStatus.REMOVED,
          }),
      ],
      ['a Chapter that has gone', () => (chapter = null)],
      [
        'an unpublished Chapter',
        () => (chapter = { ...chapter, status: ChapterStatus.DRAFT }),
      ],
      [
        'a removed Chapter',
        () =>
          (chapter = {
            ...chapter,
            moderationStatus: StorytimeModerationStatus.REMOVED,
          }),
      ],
    ])('tells nobody of %s', async (_name, arrange) => {
      arrange();

      await notifier.published('story-1', 'chapter-1', OWNER);

      expect(createNotification).not.toHaveBeenCalled();
    });
  });

  // The follow, comment or reaction stands whether or not anybody hears.
  it('logs rather than throws when a notice fails', async () => {
    createNotification.mockRejectedValue(new RangeError('No database'));

    await expect(
      notifier.reacted(StorytimeTargetType.STORY, 'story-1', READER),
    ).resolves.toBeUndefined();
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      '[reacted] A Storytime notice was not sent - Reason: RangeError',
    );
  });
});

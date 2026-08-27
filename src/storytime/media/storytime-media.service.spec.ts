import {
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { StoryCapability } from '../collaboration/storytime-story-capability.enum';
import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { YouTubeUrlService } from '../content/youtube-url.service';
import { MediaProvider } from '../enums/media-provider.enum';
import { StorytimeOrderingService } from '../shared/storytime-ordering.service';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeChapterMediaEntity } from './entities/storytime-chapter-media.entity';
import { StorytimeMediaService } from './storytime-media.service';

describe('StorytimeMediaService', () => {
  let service: StorytimeMediaService;
  let mediaRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    softDelete: jest.Mock;
  };
  let chapterRepository: { findOne: jest.Mock };
  let storyService: { findEditableOrFail: jest.Mock };
  let featureService: { assertFlagEnabled: jest.Mock };

  const ownerId = 'e6d3a1b2-0000-4000-8000-000000000001';
  const storyId = 'e6d3a1b2-0000-4000-8000-0000000000aa';
  const chapterId = 'e6d3a1b2-0000-4000-8000-0000000000bb';
  const mediaId = 'e6d3a1b2-0000-4000-8000-0000000000ff';

  const SHARE_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

  /**
   * Builds a stored video.
   *
   * @param overrides - Fields to change.
   * @returns The media entity.
   */
  const buildMedia = (
    overrides: Partial<StorytimeChapterMediaEntity> = {},
  ): StorytimeChapterMediaEntity =>
    Object.assign(new StorytimeChapterMediaEntity(), {
      id: mediaId,
      chapterId,
      provider: MediaProvider.YOUTUBE,
      externalId: 'dQw4w9WgXcQ',
      playlistId: null,
      startSeconds: null,
      endSeconds: null,
      title: null,
      caption: null,
      orderIndex: 1000,
      isPrimary: false,
      ...overrides,
    });

  beforeEach(async () => {
    mediaRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(input =>
        Object.assign(new StorytimeChapterMediaEntity(), input),
      ),
      save: jest.fn(input => Promise.resolve(input)),
      softDelete: jest.fn().mockResolvedValue(undefined),
    };
    chapterRepository = {
      findOne: jest.fn().mockResolvedValue(
        Object.assign(new StorytimeChapterEntity(), {
          id: chapterId,
          storyId,
        }),
      ),
    };
    storyService = {
      findEditableOrFail: jest.fn().mockResolvedValue({ id: storyId }),
    };
    featureService = {
      assertFlagEnabled: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeMediaService,
        {
          provide: getRepositoryToken(StorytimeChapterMediaEntity),
          useValue: mediaRepository,
        },
        {
          provide: getRepositoryToken(StorytimeChapterEntity),
          useValue: chapterRepository,
        },
        { provide: StorytimeStoryService, useValue: storyService },
        YouTubeUrlService,
        StorytimeOrderingService,
        { provide: StorytimeFeatureService, useValue: featureService },
      ],
    }).compile();

    service = module.get<StorytimeMediaService>(StorytimeMediaService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('adding a video', () => {
    it('keeps only the video identifier, not the URL', async () => {
      const media = await service.add(chapterId, { url: SHARE_URL }, ownerId);

      expect(media.externalId).toBe('dQw4w9WgXcQ');
      expect(media.provider).toBe(MediaProvider.YOUTUBE);
      expect(media).not.toHaveProperty('url');
    });

    // Creators paste whatever the Share button gave them.
    it.each([
      ['a watch link', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
      ['a short link', 'https://youtu.be/dQw4w9WgXcQ'],
      ['a Shorts link', 'https://www.youtube.com/shorts/dQw4w9WgXcQ'],
      ['a mobile link', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ'],
    ])('accepts %s', async (_name, url) => {
      const media = await service.add(chapterId, { url }, ownerId);

      expect(media.externalId).toBe('dQw4w9WgXcQ');
    });

    // The parser compares a parsed hostname rather than searching the string,
    // which is what stops a lookalike domain from being accepted.
    it.each([
      ['a lookalike host', 'https://youtu.be.attacker.net/dQw4w9WgXcQ'],
      [
        'another lookalike',
        'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
      ],
      ['something that is not a URL', 'not a link at all'],
      ['a different site', 'https://vimeo.com/123456'],
    ])('refuses %s', async (_name, url) => {
      await expect(service.add(chapterId, { url }, ownerId)).rejects.toThrow(
        /YouTube link/,
      );
    });

    it('takes the start time from the URL when it carries one', async () => {
      const media = await service.add(
        chapterId,
        { url: 'https://youtu.be/dQw4w9WgXcQ?t=90' },
        ownerId,
      );

      expect(media.startSeconds).toBe(90);
    });

    // A creator who wants a different starting point from the one they copied
    // should get theirs.
    it('prefers a start time the creator gave', async () => {
      const media = await service.add(
        chapterId,
        { url: 'https://youtu.be/dQw4w9WgXcQ?t=90', startSeconds: 30 },
        ownerId,
      );

      expect(media.startSeconds).toBe(30);
    });

    it('keeps a playlist the link named', async () => {
      const media = await service.add(
        chapterId,
        {
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLtest12345678901234',
        },
        ownerId,
      );

      expect(media.playlistId).toBe('PLtest12345678901234');
    });

    it('needs permission to manage Chapters', async () => {
      await service.add(chapterId, { url: SHARE_URL }, ownerId);

      expect(storyService.findEditableOrFail).toHaveBeenCalledWith(
        storyId,
        ownerId,
        StoryCapability.MANAGE_CHAPTERS,
      );
    });

    it('refuses when the caller may not manage Chapters', async () => {
      storyService.findEditableOrFail.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.add(chapterId, { url: SHARE_URL }, ownerId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses an unknown Chapter', async () => {
      chapterRepository.findOne.mockResolvedValue(null);

      await expect(
        service.add(chapterId, { url: SHARE_URL }, ownerId),
      ).rejects.toThrow(NotFoundException);
    });

    it('places a later video after the last', async () => {
      mediaRepository.findOne.mockResolvedValue(
        buildMedia({ orderIndex: 3000 }),
      );

      const media = await service.add(chapterId, { url: SHARE_URL }, ownerId);

      expect(media.orderIndex).toBe(4000);
    });

    it('records the title and caption', async () => {
      const media = await service.add(
        chapterId,
        { url: SHARE_URL, title: 'The escape', caption: 'Shot on Risa.' },
        ownerId,
      );

      expect(media.title).toBe('The escape');
      expect(media.caption).toBe('Shot on Risa.');
    });
  });

  // Switching embedding off has to stop new videos being added as well as
  // hiding the ones already there.
  describe('when embedding is switched off', () => {
    beforeEach(() => {
      featureService.assertFlagEnabled.mockRejectedValue(
        new ForbiddenException(),
      );
      mediaRepository.findOne.mockResolvedValue(buildMedia());
    });

    it.each([
      ['add', () => service.add(chapterId, { url: SHARE_URL }, ownerId)],
      ['update', () => service.update(mediaId, { title: 'New' }, ownerId)],
      ['remove', () => service.remove(mediaId, ownerId)],
      ['reorder', () => service.reorder(chapterId, [mediaId], ownerId)],
    ])('refuses %s', async (_name, act) => {
      await expect(act()).rejects.toThrow(ForbiddenException);
      expect(featureService.assertFlagEnabled).toHaveBeenCalledWith(
        STORYTIME_FEATURE_FLAGS.YOUTUBE_ENABLED,
      );
    });
  });

  describe('the clip offsets', () => {
    it('accepts an end after its start', async () => {
      const media = await service.add(
        chapterId,
        { url: SHARE_URL, startSeconds: 10, endSeconds: 30 },
        ownerId,
      );

      expect(media.endSeconds).toBe(30);
    });

    it.each([
      ['an end before its start', 10, 5],
      ['an end equal to its start', 10, 10],
    ])('refuses %s', async (_name, startSeconds, endSeconds) => {
      await expect(
        service.add(
          chapterId,
          { url: SHARE_URL, startSeconds, endSeconds },
          ownerId,
        ),
      ).rejects.toThrow(/end of the clip/);
    });

    // With no start given, playback begins at zero, so any end at all is after
    // it — except zero itself, which describes nothing.
    it('refuses an end of zero with no start', async () => {
      await expect(
        service.add(chapterId, { url: SHARE_URL, endSeconds: 0 }, ownerId),
      ).rejects.toThrow(/end of the clip/);
    });

    it('accepts an end with no start', async () => {
      const media = await service.add(
        chapterId,
        { url: SHARE_URL, endSeconds: 30 },
        ownerId,
      );

      expect(media.endSeconds).toBe(30);
    });

    it('accepts a video with no clip at all', async () => {
      const media = await service.add(chapterId, { url: SHARE_URL }, ownerId);

      expect(media.startSeconds).toBeNull();
      expect(media.endSeconds).toBeNull();
    });
  });

  describe('changing a video', () => {
    beforeEach(() => {
      mediaRepository.findOne.mockResolvedValue(buildMedia());
    });

    it('changes the title and caption', async () => {
      const updated = await service.update(
        mediaId,
        { title: 'Renamed', caption: 'A new caption.' },
        ownerId,
      );

      expect(updated.title).toBe('Renamed');
      expect(updated.updatedByUserId).toBe(ownerId);
    });

    it('changes the clip', async () => {
      const updated = await service.update(
        mediaId,
        { startSeconds: 5, endSeconds: 20 },
        ownerId,
      );

      expect(updated.startSeconds).toBe(5);
      expect(updated.endSeconds).toBe(20);
    });

    // Checked against what is already stored, not only against what was sent,
    // so shortening a clip to before its existing start is caught too.
    it('refuses a new end before the stored start', async () => {
      mediaRepository.findOne.mockResolvedValue(
        buildMedia({ startSeconds: 60 }),
      );

      await expect(
        service.update(mediaId, { endSeconds: 30 }, ownerId),
      ).rejects.toThrow(/end of the clip/);
    });

    it('refuses a new start after the stored end', async () => {
      mediaRepository.findOne.mockResolvedValue(
        buildMedia({ startSeconds: 10, endSeconds: 30 }),
      );

      await expect(
        service.update(mediaId, { startSeconds: 40 }, ownerId),
      ).rejects.toThrow(/end of the clip/);
    });

    it('leaves the video itself alone', async () => {
      const updated = await service.update(
        mediaId,
        { title: 'Renamed' },
        ownerId,
      );

      expect(updated.externalId).toBe('dQw4w9WgXcQ');
    });

    it('refuses an unknown video', async () => {
      mediaRepository.findOne.mockResolvedValue(null);

      await expect(
        service.update(mediaId, { title: 'Nope' }, ownerId),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses when the caller may not manage Chapters', async () => {
      storyService.findEditableOrFail.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.update(mediaId, { title: 'Nope' }, ownerId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('removing a video', () => {
    beforeEach(() => {
      mediaRepository.findOne.mockResolvedValue(buildMedia());
    });

    it('soft-deletes it', async () => {
      await service.remove(mediaId, ownerId);

      expect(mediaRepository.softDelete).toHaveBeenCalledWith(mediaId);
    });

    it('refuses when the caller may not manage Chapters', async () => {
      storyService.findEditableOrFail.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(service.remove(mediaId, ownerId)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mediaRepository.softDelete).not.toHaveBeenCalled();
    });
  });

  describe('reordering', () => {
    const first = buildMedia({ id: 'a', orderIndex: 1000 });
    const second = buildMedia({ id: 'b', orderIndex: 2000 });

    beforeEach(() => {
      mediaRepository.find.mockResolvedValue([first, second]);
    });

    it('renumbers into the given order', async () => {
      const reordered = await service.reorder(chapterId, ['b', 'a'], ownerId);

      expect(reordered.map(media => media.id)).toEqual(['b', 'a']);
      expect(reordered[0].orderIndex).toBeLessThan(reordered[1].orderIndex);
    });

    it.each([
      ['a partial order', ['a']],
      ['a repeated video', ['a', 'a']],
      ['a video from elsewhere', ['a', 'z']],
    ])('refuses %s', async (_name, mediaIds) => {
      await expect(
        service.reorder(chapterId, mediaIds, ownerId),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses when the caller may not manage Chapters', async () => {
      storyService.findEditableOrFail.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.reorder(chapterId, ['a', 'b'], ownerId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('reading', () => {
    it('lists a Chapter’s videos in order', async () => {
      await service.findByChapter(chapterId);

      expect(mediaRepository.find).toHaveBeenCalledWith({
        where: { chapterId },
        order: { orderIndex: 'ASC' },
      });
    });

    it('lists videos across several Chapters at once', async () => {
      await service.findByChapters(['chapter-1', 'chapter-2']);

      expect(mediaRepository.find).toHaveBeenCalledTimes(1);
    });

    // Asking the database for nothing would return every video on the site.
    it('asks for nothing when given no Chapters', async () => {
      await expect(service.findByChapters([])).resolves.toEqual([]);
      expect(mediaRepository.find).not.toHaveBeenCalled();
    });
  });
});

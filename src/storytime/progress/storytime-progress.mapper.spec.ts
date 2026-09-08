import { Test, TestingModule } from '@nestjs/testing';

import { ReaderChapterStatus } from '../enums/reader-chapter-status.enum';
import { ReaderStoryStatus } from '../enums/reader-story-status.enum';
import { StorytimeUserChapterProgressEntity } from './entities/storytime-user-chapter-progress.entity';
import { StorytimeUserStoryProgressEntity } from './entities/storytime-user-story-progress.entity';
import { StorytimeProgressMapper } from './storytime-progress.mapper';
import { StoryProgressSummary } from './storytime-progress.service';

describe('StorytimeProgressMapper', () => {
  let mapper: StorytimeProgressMapper;

  const lastReadAt = new Date('2026-05-01T10:00:00.000Z');
  const completedAt = new Date('2026-05-02T10:00:00.000Z');

  /**
   * Builds a progress summary to map.
   *
   * @param overrides - Fields to change on the summary.
   * @returns The summary.
   */
  const buildSummary = (
    overrides: Partial<StoryProgressSummary> = {},
  ): StoryProgressSummary => ({
    progress: Object.assign(new StorytimeUserStoryProgressEntity(), {
      id: 'progress-1',
      userId: 'user-1',
      storyId: 'story-1',
      status: ReaderStoryStatus.IN_PROGRESS,
      lastReadChapterId: 'chapter-2',
      lastReadAt,
      completedAt,
      knownPublishedChapterCount: 3,
    }),
    totalChapters: 3,
    readChapters: 2,
    percentComplete: 67,
    newChapterCount: 1,
    continueChapterId: 'chapter-3',
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StorytimeProgressMapper],
    }).compile();

    mapper = module.get<StorytimeProgressMapper>(StorytimeProgressMapper);
  });

  it('is defined', () => {
    expect(mapper).toBeDefined();
  });

  it('maps what a reader is shown', () => {
    expect(mapper.toDto(buildSummary())).toEqual({
      storyId: 'story-1',
      status: ReaderStoryStatus.IN_PROGRESS,
      totalChapters: 3,
      readChapters: 2,
      percentComplete: 67,
      newChapterCount: 1,
      continueChapterId: 'chapter-3',
      lastReadChapterId: 'chapter-2',
      lastReadAt,
      completedAt,
    });
  });

  // Progress rows carry the reader's identity and the service's own
  // bookkeeping; neither belongs in a response.
  it('withholds the reader and the internal counts', () => {
    const dto = mapper.toDto(buildSummary()) as unknown as Record<
      string,
      unknown
    >;

    expect(dto).not.toHaveProperty('userId');
    expect(dto).not.toHaveProperty('id');
    expect(dto).not.toHaveProperty('knownPublishedChapterCount');
  });

  it('maps a list', () => {
    const dtos = mapper.toDtoList([
      buildSummary(),
      buildSummary({ continueChapterId: null }),
    ]);

    expect(dtos).toHaveLength(2);
    expect(dtos[1].continueChapterId).toBeNull();
  });

  it('maps an empty list', () => {
    expect(mapper.toDtoList([])).toEqual([]);
  });

  describe('the library', () => {
    const story = { id: 'story-1', title: 'A Story' } as never;

    it('pairs each Story with its progress', () => {
      const entries = mapper.toLibraryDtoList(
        [buildSummary()],
        new Map([['story-1', story]]),
      );

      expect(entries[0].story).toBe(story);
      expect(entries[0].progress.storyId).toBe('story-1');
    });

    // A Story made private or removed since the reader started it still
    // belongs in their own history.
    it('keeps a row whose Story is no longer readable', () => {
      const entries = mapper.toLibraryDtoList([buildSummary()], new Map());

      expect(entries).toHaveLength(1);
      expect(entries[0].story).toBeNull();
    });

    it('maps an empty library', () => {
      expect(mapper.toLibraryDtoList([], new Map())).toEqual([]);
    });
  });

  describe('Chapter progress', () => {
    it('maps where the reader left off', () => {
      const progress = Object.assign(new StorytimeUserChapterProgressEntity(), {
        userId: 'user-1',
        chapterId: 'chapter-1',
        status: ReaderChapterStatus.IN_PROGRESS,
        progressPercent: 55,
        lastPositionType: 'BLOCK',
        lastPositionValue: 'b9',
        lastReadAt,
      });

      expect(mapper.toChapterDto('chapter-1', progress)).toEqual({
        chapterId: 'chapter-1',
        status: ReaderChapterStatus.IN_PROGRESS,
        progressPercent: 55,
        blockId: 'b9',
        lastReadAt,
      });
    });

    // Having never opened a Chapter is an ordinary state, not a missing
    // resource, so it maps to a row of nothings rather than an absence the
    // reader page has to special-case.
    it('maps a Chapter the reader has never opened', () => {
      expect(mapper.toChapterDto('chapter-1', null)).toEqual({
        chapterId: 'chapter-1',
        status: ReaderChapterStatus.UNREAD,
        progressPercent: null,
        blockId: null,
        lastReadAt: null,
      });
    });

    // The reader page looks up an element id; the kind of position it was
    // stored under is bookkeeping it could not act on.
    it('withholds the stored position type', () => {
      const dto = mapper.toChapterDto('chapter-1', null) as unknown as Record<
        string,
        unknown
      >;

      expect(dto).not.toHaveProperty('lastPositionType');
    });
  });
});

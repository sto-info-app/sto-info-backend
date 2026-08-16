import { Test, TestingModule } from '@nestjs/testing';
import { ReaderStoryStatus } from '../enums/reader-story-status.enum';
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
});

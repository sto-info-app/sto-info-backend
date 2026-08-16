import { ChapterStatus } from '../enums/chapter-status.enum';
import { StorytimeModerationStatus } from '../enums/storytime-moderation-status.enum';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeChapterEntity } from './entities/storytime-chapter.entity';
import { StorytimeChapterMapper } from './storytime-chapter.mapper';

describe('StorytimeChapterMapper', () => {
  let mapper: StorytimeChapterMapper;

  /**
   * Builds a Story with a known language.
   *
   * @param languageCode - The Story language.
   * @returns The Story entity.
   */
  const buildStory = (languageCode = 'en'): StorytimeStoryEntity =>
    Object.assign(new StorytimeStoryEntity(), { id: 'story-1', languageCode });

  /**
   * Builds a Chapter carrying values for every mapped field.
   *
   * @param overrides - Fields to change.
   * @returns The Chapter entity.
   */
  const buildChapter = (
    overrides: Partial<StorytimeChapterEntity> = {},
  ): StorytimeChapterEntity =>
    Object.assign(new StorytimeChapterEntity(), {
      id: 'chapter-1',
      storyId: 'story-1',
      slug: 'chapter-one',
      title: 'Chapter One',
      synopsis: 'A summary',
      contentSource: '# Source',
      contentHtml: '<h2 id="b1">Source</h2>',
      status: ChapterStatus.PUBLISHED,
      languageCode: null,
      orderIndex: 1000,
      wordCount: 250,
      estimatedReadingMinutes: 2,
      upVoteCount: 9,
      downVoteCount: 4,
      version: 3,
      scheduledPublishAt: null,
      moderationStatus: StorytimeModerationStatus.REMOVED,
      moderationMessage: 'Breached the content policy',
      coverImageId: null,
      coverImageAlt: null,
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    });

  beforeEach(() => {
    mapper = new StorytimeChapterMapper();
  });

  describe('toSummary', () => {
    it('maps the list fields', () => {
      const dto = mapper.toSummary(buildChapter());

      expect(dto.title).toBe('Chapter One');
      expect(dto.synopsis).toBe('A summary');
      expect(dto.wordCount).toBe(250);
      expect(dto.estimatedReadingMinutes).toBe(2);
    });

    // A list must not carry every Chapter's full body.
    it('omits the body, source and working state', () => {
      const dto = mapper.toSummary(buildChapter()) as unknown as Record<
        string,
        unknown
      >;

      expect(dto['contentHtml']).toBeUndefined();
      expect(dto['contentSource']).toBeUndefined();
      expect(dto['status']).toBeUndefined();
      expect(dto['version']).toBeUndefined();
    });
  });

  describe('toPublic', () => {
    it('adds the rendered body', () => {
      const dto = mapper.toPublic(buildChapter(), buildStory());

      expect(dto.contentHtml).toBe('<h2 id="b1">Source</h2>');
    });

    it('reports the rating as up votes minus down votes', () => {
      expect(mapper.toPublic(buildChapter(), buildStory()).rating).toBe(5);
    });

    // The reader page needs one value for its lang attribute, and only the
    // server knows the Story's language.
    it('inherits the Story language when the Chapter sets none', () => {
      const dto = mapper.toPublic(buildChapter(), buildStory('de'));

      expect(dto.languageCode).toBe('de');
    });

    it('prefers the Chapter language when it sets one', () => {
      const dto = mapper.toPublic(
        buildChapter({ languageCode: 'tlh' }),
        buildStory('de'),
      );

      expect(dto.languageCode).toBe('tlh');
    });

    it('omits the editable source and working state', () => {
      const dto = mapper.toPublic(
        buildChapter(),
        buildStory(),
      ) as unknown as Record<string, unknown>;

      expect(dto['contentSource']).toBeUndefined();
      expect(dto['status']).toBeUndefined();
      expect(dto['moderationMessage']).toBeUndefined();
    });
  });

  describe('toManaged', () => {
    it('adds the fields a creator works with', () => {
      const dto = mapper.toManaged(buildChapter(), buildStory());

      expect(dto.status).toBe(ChapterStatus.PUBLISHED);
      expect(dto.contentSource).toBe('# Source');
      expect(dto.version).toBe(3);
    });

    it('shows the moderation notice to the creator', () => {
      const dto = mapper.toManaged(buildChapter(), buildStory());

      expect(dto.moderationStatus).toBe(StorytimeModerationStatus.REMOVED);
      expect(dto.moderationMessage).toBe('Breached the content policy');
    });

    it('reports a pending schedule', () => {
      const when = new Date('2030-01-01T00:00:00Z');
      const dto = mapper.toManaged(
        buildChapter({ scheduledPublishAt: when }),
        buildStory(),
      );

      expect(dto.scheduledPublishAt).toBe(when);
    });
  });

  describe('toLink', () => {
    it('reduces a Chapter to a navigation link', () => {
      expect(mapper.toLink(buildChapter())).toEqual({
        slug: 'chapter-one',
        title: 'Chapter One',
      });
    });

    it('reports nothing when there is no neighbour', () => {
      expect(mapper.toLink(null)).toBeNull();
    });
  });

  describe('list mapping', () => {
    it('maps a list of summaries', () => {
      expect(
        mapper.toSummaryList([buildChapter(), buildChapter()]),
      ).toHaveLength(2);
    });

    it('maps a list for the creator', () => {
      expect(mapper.toManagedList([buildChapter()], buildStory())).toHaveLength(
        1,
      );
    });

    it('maps empty lists', () => {
      expect(mapper.toSummaryList([])).toEqual([]);
      expect(mapper.toManagedList([], buildStory())).toEqual([]);
    });
  });
});

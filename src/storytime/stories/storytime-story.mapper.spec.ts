import { StoryStatus } from '../enums/story-status.enum';
import { StorytimeModerationStatus } from '../enums/storytime-moderation-status.enum';
import { StorytimeVisibility } from '../enums/storytime-visibility.enum';
import { StorytimeStoryEntity } from './entities/storytime-story.entity';
import { StorytimeStoryMapper } from './storytime-story.mapper';

describe('StorytimeStoryMapper', () => {
  let mapper: StorytimeStoryMapper;

  /**
   * Builds a Story carrying values for every mapped field.
   *
   * @returns The Story entity.
   */
  const buildStory = (): StorytimeStoryEntity => {
    const story = new StorytimeStoryEntity();
    Object.assign(story, {
      id: 'story-1',
      slug: 'a-story',
      title: 'A Story',
      ownerUserId: 'owner-1',
      shortDescription: 'Summary',
      description: '# Source',
      descriptionHtml: '<h2 id="b1">Source</h2>',
      status: StoryStatus.PUBLISHED,
      visibility: StorytimeVisibility.PUBLIC,
      ownerOrderIndex: 1000,
      upVoteCount: 7,
      downVoteCount: 2,
      version: 3,
      moderationStatus: StorytimeModerationStatus.REMOVED,
      moderationMessage: 'Breached the content policy',
      contentPolicyAcceptedAt: new Date('2026-01-01T00:00:00Z'),
      publishedChapterCount: 4,
    });
    return story;
  };

  beforeEach(() => {
    mapper = new StorytimeStoryMapper();
  });

  describe('toPublic', () => {
    it('maps the reader-facing fields', () => {
      const dto = mapper.toPublic(buildStory());

      expect(dto.slug).toBe('a-story');
      expect(dto.title).toBe('A Story');
      expect(dto.descriptionHtml).toBe('<h2 id="b1">Source</h2>');
      expect(dto.publishedChapterCount).toBe(4);
    });

    it('reports the rating as up votes minus down votes', () => {
      expect(mapper.toPublic(buildStory()).rating).toBe(5);
    });

    // Building the public shape explicitly means a column added later stays
    // private until somebody decides otherwise.
    it('omits the editable source, working state and moderation notes', () => {
      const dto = mapper.toPublic(buildStory()) as unknown as Record<
        string,
        unknown
      >;

      expect(dto['description']).toBeUndefined();
      expect(dto['status']).toBeUndefined();
      expect(dto['visibility']).toBeUndefined();
      expect(dto['version']).toBeUndefined();
      expect(dto['moderationMessage']).toBeUndefined();
      expect(dto['ownerOrderIndex']).toBeUndefined();
    });
  });

  describe('toManaged', () => {
    it('adds the fields a creator manages the Story through', () => {
      const dto = mapper.toManaged(buildStory());

      expect(dto.status).toBe(StoryStatus.PUBLISHED);
      expect(dto.visibility).toBe(StorytimeVisibility.PUBLIC);
      expect(dto.description).toBe('# Source');
      expect(dto.version).toBe(3);
      expect(dto.ownerOrderIndex).toBe(1000);
    });

    // The creator sees the administrator's reason verbatim.
    it('shows the moderation notice to the owner', () => {
      const dto = mapper.toManaged(buildStory());

      expect(dto.moderationStatus).toBe(StorytimeModerationStatus.REMOVED);
      expect(dto.moderationMessage).toBe('Breached the content policy');
    });

    it('keeps everything the reader shape carries', () => {
      const dto = mapper.toManaged(buildStory());

      expect(dto.title).toBe('A Story');
      expect(dto.rating).toBe(5);
    });
  });

  describe('list mapping', () => {
    it('maps a list of Stories for readers', () => {
      expect(mapper.toPublicList([buildStory(), buildStory()])).toHaveLength(2);
    });

    it('maps a list of Stories for their owner', () => {
      expect(mapper.toManagedList([buildStory()])).toHaveLength(1);
    });

    it('maps an empty list', () => {
      expect(mapper.toPublicList([])).toEqual([]);
      expect(mapper.toManagedList([])).toEqual([]);
    });
  });
});

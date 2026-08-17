import { Test, TestingModule } from '@nestjs/testing';
import { StorytimeArcEntity } from '../arcs/entities/storytime-arc.entity';
import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { StorytimeActivityType } from '../enums/storytime-activity-type.enum';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { FeedEntry } from './storytime-activity-feed.service';
import { StorytimeActivityFeedItemEntity } from './entities/storytime-activity-feed-item.entity';
import { StorytimeSocialMapper } from './storytime-social.mapper';

describe('StorytimeSocialMapper', () => {
  let mapper: StorytimeSocialMapper;

  const occurredAt = new Date('2026-01-01T00:00:00.000Z');

  /**
   * Builds a feed entry.
   *
   * @param overrides - What differs from a bare Story announcement.
   * @returns The entry.
   */
  const buildEntry = (overrides: Partial<FeedEntry> = {}): FeedEntry => ({
    item: {
      id: 'item-1',
      activityType: StorytimeActivityType.STORY_PUBLISHED,
      actorUserId: 'writer-1',
      occurredAt,
    } as StorytimeActivityFeedItemEntity,
    story: null,
    chapter: null,
    arc: null,
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StorytimeSocialMapper],
    }).compile();

    mapper = module.get<StorytimeSocialMapper>(StorytimeSocialMapper);
  });

  it('is defined', () => {
    expect(mapper).toBeDefined();
  });

  it('carries the addresses of everything an item names', () => {
    const entry = mapper.toFeedEntry(
      buildEntry({
        story: {
          title: 'The Long Patrol',
          slug: 'the-long-patrol',
        } as StorytimeStoryEntity,
        chapter: {
          title: 'First Contact',
          slug: 'first-contact',
        } as StorytimeChapterEntity,
        arc: {
          title: 'The Dominion War',
          slug: 'the-dominion-war',
        } as StorytimeArcEntity,
      }),
    );

    expect(entry).toEqual({
      id: 'item-1',
      activityType: StorytimeActivityType.STORY_PUBLISHED,
      actorUserId: 'writer-1',
      storyTitle: 'The Long Patrol',
      storySlug: 'the-long-patrol',
      chapterTitle: 'First Contact',
      chapterSlug: 'first-contact',
      arcTitle: 'The Dominion War',
      arcSlug: 'the-dominion-war',
      occurredAt,
    });
  });

  it('leaves out what an item does not name', () => {
    const entry = mapper.toFeedEntry(buildEntry());

    expect(entry.storyTitle).toBeNull();
    expect(entry.storySlug).toBeNull();
    expect(entry.chapterTitle).toBeNull();
    expect(entry.chapterSlug).toBeNull();
    expect(entry.arcTitle).toBeNull();
    expect(entry.arcSlug).toBeNull();
  });

  it('maps a whole feed', () => {
    const feed = mapper.toFeed([
      buildEntry(),
      buildEntry({
        item: {
          id: 'item-2',
          activityType: StorytimeActivityType.ARC_UPDATED,
          actorUserId: 'writer-2',
          occurredAt,
        } as StorytimeActivityFeedItemEntity,
      }),
    ]);

    expect(feed.map(entry => entry.id)).toEqual(['item-1', 'item-2']);
  });

  it('maps an empty feed', () => {
    expect(mapper.toFeed([])).toEqual([]);
  });
});

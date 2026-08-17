import { Test, TestingModule } from '@nestjs/testing';
import { StorytimeArcEntity } from '../arcs/entities/storytime-arc.entity';
import { StorytimeArcMapper } from '../arcs/storytime-arc.mapper';
import { SpotlightEntityType } from '../enums/spotlight-entity-type.enum';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeStoryMapper } from '../stories/storytime-story.mapper';
import { StorytimeSpotlightEntity } from './entities/storytime-spotlight.entity';
import { StorytimeSpotlightMapper } from './storytime-spotlight.mapper';

describe('StorytimeSpotlightMapper', () => {
  let mapper: StorytimeSpotlightMapper;

  /**
   * Builds a Spotlight entry.
   *
   * @param overrides - Fields to change.
   * @returns The entry.
   */
  const buildEntry = (
    overrides: Partial<StorytimeSpotlightEntity> = {},
  ): StorytimeSpotlightEntity =>
    Object.assign(new StorytimeSpotlightEntity(), {
      id: 'spotlight-1',
      slug: 'a-fine-story',
      entityType: SpotlightEntityType.STORY,
      storyId: 'story-1',
      arcId: null,
      headline: 'A Fine Story',
      summary: 'Worth your evening.',
      selectionReason: 'It stayed with us.',
      overrideImageId: null,
      overrideImageAlt: null,
      displayPriority: 5,
      startsAt: new Date('2026-06-01T00:00:00.000Z'),
      endsAt: null,
      isPublished: true,
      createdByUserId: 'editor-1',
      updatedByUserId: 'editor-1',
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
      updatedAt: new Date('2026-05-02T00:00:00.000Z'),
      ...overrides,
    });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeSpotlightMapper,
        StorytimeStoryMapper,
        StorytimeArcMapper,
      ],
    }).compile();

    mapper = module.get<StorytimeSpotlightMapper>(StorytimeSpotlightMapper);
  });

  it('is defined', () => {
    expect(mapper).toBeDefined();
  });

  it('maps the editorial copy', () => {
    const mapped = mapper.toPublic({
      entry: buildEntry(),
      story: null,
      arc: null,
    });

    expect(mapped.headline).toBe('A Fine Story');
    expect(mapped.summary).toBe('Worth your evening.');
    expect(mapped.selectionReason).toBe('It stayed with us.');
  });

  it('maps the featured Story', () => {
    const story = Object.assign(new StorytimeStoryEntity(), {
      id: 'story-1',
      title: 'A Fine Story',
      slug: 'a-fine-story',
    });

    const mapped = mapper.toPublic({ entry: buildEntry(), story, arc: null });

    expect(mapped.story?.title).toBe('A Fine Story');
    expect(mapped.arc).toBeNull();
  });

  it('maps the featured Arc', () => {
    const arc = Object.assign(new StorytimeArcEntity(), {
      id: 'arc-1',
      title: 'The Long War',
      slug: 'the-long-war',
    });

    const mapped = mapper.toPublic({
      entry: buildEntry({ entityType: SpotlightEntityType.ARC }),
      story: null,
      arc,
    });

    expect(mapped.arc?.title).toBe('The Long War');
    expect(mapped.story).toBeNull();
  });

  // Scheduling and identifiers are an editor's business, not a reader's.
  it.each([
    'storyId',
    'arcId',
    'displayPriority',
    'isPublished',
    'createdByUserId',
  ])('leaves %s out of the reader-facing shape', field => {
    const mapped = mapper.toPublic({
      entry: buildEntry(),
      story: null,
      arc: null,
    });

    expect(mapped as unknown as Record<string, unknown>).not.toHaveProperty(
      field,
    );
  });

  it('maps the editorial shape with its scheduling', () => {
    const mapped = mapper.toManaged(buildEntry());

    expect(mapped.displayPriority).toBe(5);
    expect(mapped.isPublished).toBe(true);
    expect(mapped.storyId).toBe('story-1');
    expect(mapped.updatedByUserId).toBe('editor-1');
  });

  // An entry pointing at work that has been taken down is exactly the entry an
  // editor most needs to find, so it must still map.
  it('maps an entry whose work is gone', () => {
    const mapped = mapper.toManaged(buildEntry());

    expect(mapped.story).toBeNull();
    expect(mapped.arc).toBeNull();
  });

  it('maps the override image to a URL', () => {
    const mapped = mapper.toManaged(
      buildEntry({ overrideImageId: 'image-1', overrideImageAlt: 'A ship' }),
    );

    expect(mapped.overrideImageUrl).toContain('image-1');
    expect(mapped.overrideImageMobileUrl).toContain('image-1');
    expect(mapped.overrideImageAlt).toBe('A ship');
    expect(mapped.overrideImageId).toBe('image-1');
  });

  it('leaves the image URLs empty when there is no override', () => {
    const mapped = mapper.toManaged(buildEntry());

    expect(mapped.overrideImageUrl).toBeNull();
    expect(mapped.overrideImageMobileUrl).toBeNull();
  });

  it('maps lists', () => {
    expect(
      mapper.toPublicList([{ entry: buildEntry(), story: null, arc: null }]),
    ).toHaveLength(1);
    expect(mapper.toManagedList([buildEntry()])).toHaveLength(1);
  });
});

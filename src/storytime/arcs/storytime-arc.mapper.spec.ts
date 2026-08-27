import { Test, TestingModule } from '@nestjs/testing';
import { StoryDto } from '../stories/dto/story.dto';
import { ArcMembershipStatus } from '../enums/arc-membership-status.enum';
import { ArcStatus } from '../enums/arc-status.enum';
import { StorytimeVisibility } from '../enums/storytime-visibility.enum';
import { StorytimeArcStoryEntity } from './entities/storytime-arc-story.entity';
import { StorytimeArcEntity } from './entities/storytime-arc.entity';
import { StorytimeArcMapper } from './storytime-arc.mapper';

describe('StorytimeArcMapper', () => {
  let mapper: StorytimeArcMapper;

  const originalHash = process.env.CLOUDFLARE_IMAGES_HASH;
  const originalCdn = process.env.CLOUDFLARE_CDN_ROOT_URL;

  /**
   * Builds an Arc.
   *
   * @param overrides - Fields to change.
   * @returns The Arc entity.
   */
  const buildArc = (
    overrides: Partial<StorytimeArcEntity> = {},
  ): StorytimeArcEntity =>
    Object.assign(new StorytimeArcEntity(), {
      id: 'arc-1',
      ownerUserId: 'curator-1',
      title: 'The Long War',
      slug: 'the-long-war',
      shortDescription: 'A summary',
      description: '# Heading',
      descriptionHtml: '<h2 id="b1">Heading</h2>',
      status: ArcStatus.PUBLISHED,
      visibility: StorytimeVisibility.PUBLIC,
      languageCode: 'en',
      bannerImageId: null,
      bannerImageAlt: null,
      profileImageId: null,
      profileImageAlt: null,
      upVoteCount: 7,
      downVoteCount: 2,
      version: 3,
      publishedAt: new Date('2026-05-01T10:00:00.000Z'),
      ...overrides,
    });

  /**
   * Builds a membership.
   *
   * @param overrides - Fields to change.
   * @returns The membership entity.
   */
  const buildMembership = (
    overrides: Partial<StorytimeArcStoryEntity> = {},
  ): StorytimeArcStoryEntity =>
    Object.assign(new StorytimeArcStoryEntity(), {
      id: 'membership-1',
      arcId: 'arc-1',
      storyId: 'story-1',
      orderIndex: 1000,
      membershipStatus: ArcMembershipStatus.APPROVED,
      introductoryNote: 'Start here.',
      ...overrides,
    });

  beforeEach(async () => {
    process.env.CLOUDFLARE_IMAGES_HASH = 'test-hash';
    process.env.CLOUDFLARE_CDN_ROOT_URL = 'https://cdn.example.test';

    const module: TestingModule = await Test.createTestingModule({
      providers: [StorytimeArcMapper],
    }).compile();

    mapper = module.get<StorytimeArcMapper>(StorytimeArcMapper);
  });

  afterEach(() => {
    process.env.CLOUDFLARE_IMAGES_HASH = originalHash;
    process.env.CLOUDFLARE_CDN_ROOT_URL = originalCdn;
  });

  it('is defined', () => {
    expect(mapper).toBeDefined();
  });

  describe('the reader-facing shape', () => {
    it('maps what a reader is shown', () => {
      const dto = mapper.toPublic(buildArc());

      expect(dto.title).toBe('The Long War');
      expect(dto.descriptionHtml).toContain('Heading');
    });

    // The rating is the net of the two counts, computed once here so no client
    // has to know how it is arrived at.
    it('reports the rating as thumbs up minus thumbs down', () => {
      expect(mapper.toPublic(buildArc()).rating).toBe(5);
    });

    it('withholds the authoring copy and the bookkeeping', () => {
      const dto = mapper.toPublic(buildArc()) as unknown as Record<
        string,
        unknown
      >;

      expect(dto).not.toHaveProperty('description');
      expect(dto).not.toHaveProperty('status');
      expect(dto).not.toHaveProperty('visibility');
      expect(dto).not.toHaveProperty('version');
    });

    it('builds the banner URL when there is one', () => {
      const dto = mapper.toPublic(buildArc({ bannerImageId: 'banner-1' }));

      expect(dto.bannerImageUrl).toContain('banner-1');
    });

    // Artwork is optional throughout, so a missing image must produce nothing
    // at all rather than an empty frame.
    it('reports no banner when there is none', () => {
      expect(mapper.toPublic(buildArc()).bannerImageUrl).toBeNull();
    });

    it('maps a list', () => {
      expect(mapper.toPublicList([buildArc()])).toHaveLength(1);
    });
  });

  describe('the curator-facing shape', () => {
    it('adds what a curator needs to edit', () => {
      const dto = mapper.toManaged(buildArc());

      expect(dto.description).toBe('# Heading');
      expect(dto.status).toBe(ArcStatus.PUBLISHED);
      expect(dto.visibility).toBe(StorytimeVisibility.PUBLIC);
      expect(dto.version).toBe(3);
    });

    it('maps a list', () => {
      expect(mapper.toManagedList([buildArc()])).toHaveLength(1);
    });
  });

  describe('memberships', () => {
    const story = { id: 'story-1', title: 'A Story' } as StoryDto;

    it('pairs each membership with its Story', () => {
      const [dto] = mapper.toMembershipList(
        [buildMembership()],
        new Map([['story-1', story]]),
      );

      expect(dto.story).toBe(story);
      expect(dto.introductoryNote).toBe('Start here.');
      expect(dto.membershipStatus).toBe(ArcMembershipStatus.APPROVED);
    });

    // Dropping the row would leave a curator unable to see or undo what they
    // agreed to once a Story is made private.
    it('keeps a membership whose Story the caller may not see', () => {
      const dtos = mapper.toMembershipList([buildMembership()], new Map());

      expect(dtos).toHaveLength(1);
      expect(dtos[0].story).toBeNull();
    });

    it('maps an empty Arc', () => {
      expect(mapper.toMembershipList([], new Map())).toEqual([]);
    });
  });
});

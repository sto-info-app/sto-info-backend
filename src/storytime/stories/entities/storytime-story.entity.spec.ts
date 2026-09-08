import { StoryStatus } from '../../enums/story-status.enum';
import { StorytimeVisibility } from '../../enums/storytime-visibility.enum';
import { StorytimeStoryEntity } from './storytime-story.entity';

describe('StorytimeStoryEntity', () => {
  const originalHash = process.env.CLOUDFLARE_IMAGES_HASH;
  const originalCdn = process.env.CLOUDFLARE_CDN_ROOT_URL;

  beforeEach(() => {
    process.env.CLOUDFLARE_IMAGES_HASH = 'test-hash';
    process.env.CLOUDFLARE_CDN_ROOT_URL = 'https://cdn.example.test';
  });

  afterEach(() => {
    process.env.CLOUDFLARE_IMAGES_HASH = originalHash;
    process.env.CLOUDFLARE_CDN_ROOT_URL = originalCdn;
  });

  /**
   * Builds a Story with the supplied image identifiers.
   *
   * @param bannerImageId - The banner image ID, if any.
   * @param profileImageId - The profile image ID, if any.
   * @returns The Story entity.
   */
  const createStory = (
    bannerImageId: string | null = null,
    profileImageId: string | null = null,
  ): StorytimeStoryEntity => {
    const story = new StorytimeStoryEntity();
    story.title = 'The Long Way Home';
    story.slug = 'the-long-way-home';
    story.status = StoryStatus.DRAFT;
    story.visibility = StorytimeVisibility.PRIVATE;
    story.bannerImageId = bannerImageId;
    story.profileImageId = profileImageId;
    return story;
  };

  it('stores assigned fields', () => {
    const story = createStory();

    expect(story.title).toBe('The Long Way Home');
    expect(story.slug).toBe('the-long-way-home');
    expect(story.status).toBe(StoryStatus.DRAFT);
    expect(story.visibility).toBe(StorytimeVisibility.PRIVATE);
  });

  describe('image URLs', () => {
    it('builds the banner URL at desktop size', () => {
      const story = createStory('banner-image-id');

      expect(story.bannerImageUrl).toContain('banner-image-id');
      expect(story.bannerImageUrl).toContain('banner2400x480');
    });

    it('builds the banner URL at mobile size', () => {
      const story = createStory('banner-image-id');

      expect(story.bannerImageMobileUrl).toContain('banner1200x240');
    });

    it('builds the profile image URL', () => {
      const story = createStory(null, 'profile-image-id');

      expect(story.profileImageUrl).toContain('profile-image-id');
      expect(story.profileImageUrl).toContain('square300');
    });

    it('builds the profile thumbnail URL', () => {
      const story = createStory(null, 'profile-image-id');

      expect(story.profileImageThumbnailUrl).toContain('square100');
    });

    // Storytime artwork is optional throughout. A missing image must produce
    // nothing at all, so the layout can collapse rather than render an empty
    // frame or a placeholder.
    it('reports no banner URL when there is no banner', () => {
      const story = createStory();

      expect(story.bannerImageUrl).toBeNull();
      expect(story.bannerImageMobileUrl).toBeNull();
    });

    it('reports no profile URL when there is no profile image', () => {
      const story = createStory();

      expect(story.profileImageUrl).toBeNull();
      expect(story.profileImageThumbnailUrl).toBeNull();
    });
  });
});

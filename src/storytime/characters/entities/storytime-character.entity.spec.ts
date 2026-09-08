import { StorytimeCharacterEntity } from './storytime-character.entity';

describe('StorytimeCharacterEntity', () => {
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
   * Builds a Character with the supplied portrait.
   *
   * @param portraitImageId - The portrait image ID, if any.
   * @returns The Character entity.
   */
  const createCharacter = (
    portraitImageId: string | null = null,
  ): StorytimeCharacterEntity => {
    const character = new StorytimeCharacterEntity();
    character.name = 'Captain Shran';
    character.slug = 'captain-shran';
    character.portraitImageId = portraitImageId;
    return character;
  };

  it('stores assigned fields', () => {
    const character = createCharacter();

    expect(character.name).toBe('Captain Shran');
    expect(character.slug).toBe('captain-shran');
  });

  describe('portrait URLs', () => {
    // Portraits are 2:3 throughout, so a cast list never has to crop or letterbox.
    it('builds the portrait URL at full size', () => {
      const character = createCharacter('portrait-image-id');

      expect(character.portraitImageUrl).toContain('portrait-image-id');
      expect(character.portraitImageUrl).toContain('portrait400x600');
    });

    it('builds the portrait URL at cast-list size', () => {
      const character = createCharacter('portrait-image-id');

      expect(character.portraitImageThumbnailUrl).toContain('portrait133x200');
    });

    // Storytime artwork is optional throughout. A missing portrait must
    // produce nothing at all, so the layout can collapse rather than render an
    // empty frame.
    it('reports no portrait URL when there is no portrait', () => {
      const character = createCharacter();

      expect(character.portraitImageUrl).toBeNull();
      expect(character.portraitImageThumbnailUrl).toBeNull();
    });
  });
});

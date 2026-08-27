import { Test, TestingModule } from '@nestjs/testing';
import { StorytimeModerationStatus } from '../enums/storytime-moderation-status.enum';
import { StorytimeChapterCharacterEntity } from './entities/storytime-chapter-character.entity';
import { StorytimeCharacterEntity } from './entities/storytime-character.entity';
import { StorytimeCharacterMapper } from './storytime-character.mapper';

describe('StorytimeCharacterMapper', () => {
  let mapper: StorytimeCharacterMapper;

  /**
   * Builds a Character to map.
   *
   * @param overrides - Fields to change.
   * @returns The Character entity.
   */
  const buildCharacter = (
    overrides: Partial<StorytimeCharacterEntity> = {},
  ): StorytimeCharacterEntity =>
    Object.assign(new StorytimeCharacterEntity(), {
      id: 'character-1',
      storyId: 'story-1',
      slug: 'captain-shran',
      name: 'Captain Shran',
      shortBio: 'An Andorian officer.',
      biographySource: 'An **Andorian** officer.',
      biographyHtml: '<p id="b1">An <strong>Andorian</strong> officer.</p>',
      portraitImageId: null,
      portraitImageAlt: null,
      species: 'Andorian',
      faction: null,
      rank: 'Captain',
      occupation: null,
      affiliation: null,
      shipAssignment: null,
      traits: ['Loyal'],
      isPrimary: true,
      displayOrder: 1000,
      version: 3,
      moderationStatus: StorytimeModerationStatus.ACTIVE,
      moderationMessage: null,
      createdByUserId: 'user-1',
      ...overrides,
    });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StorytimeCharacterMapper],
    }).compile();

    mapper = module.get<StorytimeCharacterMapper>(StorytimeCharacterMapper);
  });

  it('is defined', () => {
    expect(mapper).toBeDefined();
  });

  describe('the reader-facing shape', () => {
    it('maps what a reader is shown', () => {
      const dto = mapper.toPublic(buildCharacter());

      expect(dto.name).toBe('Captain Shran');
      expect(dto.species).toBe('Andorian');
      expect(dto.traits).toEqual(['Loyal']);
      expect(dto.biographyHtml).toContain('Andorian');
    });

    // The rendered HTML is what a reader gets. Sending the source as well
    // would hand out the authoring copy for no reason.
    it('withholds the authoring copy and the bookkeeping', () => {
      const dto = mapper.toPublic(buildCharacter()) as unknown as Record<
        string,
        unknown
      >;

      expect(dto).not.toHaveProperty('biographySource');
      expect(dto).not.toHaveProperty('version');
      expect(dto).not.toHaveProperty('createdByUserId');
      expect(dto).not.toHaveProperty('moderationStatus');
    });

    it('maps a list', () => {
      expect(mapper.toPublicList([buildCharacter()])).toHaveLength(1);
    });

    it('maps an empty list', () => {
      expect(mapper.toPublicList([])).toEqual([]);
    });
  });

  describe('the creator-facing shape', () => {
    it('adds what a creator needs to edit', () => {
      const dto = mapper.toManaged(buildCharacter());

      expect(dto.biographySource).toBe('An **Andorian** officer.');
      expect(dto.version).toBe(3);
      expect(dto.moderationStatus).toBe(StorytimeModerationStatus.ACTIVE);
    });

    // A creator picking a new portrait needs the stored ID, which a reader
    // has no use for.
    it('carries the stored portrait identifier', () => {
      const dto = mapper.toManaged(
        buildCharacter({ portraitImageId: 'portrait-1' }),
      );

      expect(dto.portraitImageId).toBe('portrait-1');
      expect(dto.portraitImageUrl).toContain('portrait-1');
    });

    it('maps a list', () => {
      expect(mapper.toManagedList([buildCharacter()])).toHaveLength(1);
    });
  });

  describe('appearances', () => {
    /**
     * Builds an appearance row.
     *
     * @param characterId - The Character appearing.
     * @returns The appearance entity.
     */
    const buildAppearance = (characterId: string) =>
      Object.assign(new StorytimeChapterCharacterEntity(), {
        chapterId: 'chapter-1',
        characterId,
        appearanceOrder: 1000,
        appearanceNotes: 'Takes the bridge.',
        isPrimary: true,
      });

    it('pairs each appearance with its Character', () => {
      const dtos = mapper.toAppearanceList(
        [buildAppearance('character-1')],
        [buildCharacter()],
      );

      expect(dtos[0].character?.name).toBe('Captain Shran');
      expect(dtos[0].appearanceNotes).toBe('Takes the bridge.');
      expect(dtos[0].isPrimary).toBe(true);
    });

    // Dropping the row instead would make a caller counting appearances and a
    // caller listing them disagree.
    it('keeps an appearance whose Character has been deleted', () => {
      const dtos = mapper.toAppearanceList([buildAppearance('gone')], []);

      expect(dtos).toHaveLength(1);
      expect(dtos[0].character).toBeNull();
    });

    it('maps an empty cast', () => {
      expect(mapper.toAppearanceList([], [])).toEqual([]);
    });
  });
});

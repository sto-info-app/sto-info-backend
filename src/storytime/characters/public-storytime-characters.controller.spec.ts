import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { StorytimeChapterService } from '../chapters/storytime-chapter.service';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeChapterCharacterEntity } from './entities/storytime-chapter-character.entity';
import { StorytimeCharacterEntity } from './entities/storytime-character.entity';
import { PublicStorytimeCharactersController } from './public-storytime-characters.controller';
import { StorytimeAppearanceService } from './storytime-appearance.service';
import { StorytimeCharacterMapper } from './storytime-character.mapper';
import { StorytimeCharacterService } from './storytime-character.service';

describe('PublicStorytimeCharactersController', () => {
  let controller: PublicStorytimeCharactersController;
  let characterService: {
    findPublicByStory: jest.Mock;
    findPublicBySlug: jest.Mock;
  };
  let appearanceService: { findByCharacter: jest.Mock };
  let chapterService: { findPublicByStory: jest.Mock };
  let storyService: { findPublicBySlug: jest.Mock };
  let featureService: { assertFlagEnabled: jest.Mock };

  const story = Object.assign(new StorytimeStoryEntity(), {
    id: 'story-1',
    slug: 'a-story',
  });

  const character = Object.assign(new StorytimeCharacterEntity(), {
    id: 'character-1',
    storyId: 'story-1',
    slug: 'captain-shran',
    name: 'Captain Shran',
    traits: null,
    isPrimary: true,
    displayOrder: 1000,
  });

  /**
   * Builds a readable Chapter.
   *
   * @param id - The Chapter identifier.
   * @param slug - Its slug.
   * @returns The Chapter entity.
   */
  const buildChapter = (id: string, slug: string) =>
    Object.assign(new StorytimeChapterEntity(), {
      id,
      slug,
      title: `Title ${slug}`,
      storyId: 'story-1',
    });

  /**
   * Builds an appearance row.
   *
   * @param chapterId - The Chapter appeared in.
   * @returns The appearance entity.
   */
  const buildAppearance = (chapterId: string) =>
    Object.assign(new StorytimeChapterCharacterEntity(), {
      chapterId,
      characterId: 'character-1',
      appearanceOrder: 1000,
      isPrimary: true,
      appearanceNotes: null,
    });

  beforeEach(async () => {
    characterService = {
      findPublicByStory: jest.fn().mockResolvedValue([character]),
      findPublicBySlug: jest.fn().mockResolvedValue(character),
    };
    appearanceService = {
      findByCharacter: jest.fn().mockResolvedValue([]),
    };
    chapterService = { findPublicByStory: jest.fn().mockResolvedValue([]) };
    storyService = { findPublicBySlug: jest.fn().mockResolvedValue(story) };
    featureService = {
      assertFlagEnabled: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicStorytimeCharactersController],
      providers: [
        { provide: StorytimeCharacterService, useValue: characterService },
        { provide: StorytimeAppearanceService, useValue: appearanceService },
        { provide: StorytimeChapterService, useValue: chapterService },
        { provide: StorytimeStoryService, useValue: storyService },
        StorytimeCharacterMapper,
        { provide: StorytimeFeatureService, useValue: featureService },
      ],
    }).compile();

    controller = module.get<PublicStorytimeCharactersController>(
      PublicStorytimeCharactersController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('lists the cast of a published Story', async () => {
    const result = await controller.findAll('a-story');

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Captain Shran');
  });

  it('reads one Character', async () => {
    const result = await controller.findOne('a-story', 'captain-shran');

    expect(result.character.name).toBe('Captain Shran');
  });

  // A Character has no publication state of its own, so the Story being
  // readable is the only thing keeping a private Story's cast private.
  describe('gating on the Story', () => {
    it('refuses a cast list when no readable Story matches', async () => {
      storyService.findPublicBySlug.mockResolvedValue(null);

      await expect(controller.findAll('a-story')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses a Character when no readable Story matches', async () => {
      storyService.findPublicBySlug.mockResolvedValue(null);

      await expect(
        controller.findOne('a-story', 'captain-shran'),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses an unknown Character', async () => {
      characterService.findPublicBySlug.mockResolvedValue(null);

      await expect(controller.findOne('a-story', 'nobody')).rejects.toThrow(
        NotFoundException,
      );
    });

    it.each([
      ['findAll', () => controller.findAll('a-story')],
      ['findOne', () => controller.findOne('a-story', 'captain-shran')],
    ])('refuses %s when reading is switched off', async (_name, act) => {
      featureService.assertFlagEnabled.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(act()).rejects.toThrow(ForbiddenException);
    });
  });

  describe('the Chapters a Character appears in', () => {
    it('lists them with their titles and slugs', async () => {
      appearanceService.findByCharacter.mockResolvedValue([
        buildAppearance('chapter-1'),
      ]);
      chapterService.findPublicByStory.mockResolvedValue([
        buildChapter('chapter-1', 'chapter-one'),
      ]);

      const result = await controller.findOne('a-story', 'captain-shran');

      expect(result.appearsIn).toEqual([
        {
          chapterId: 'chapter-1',
          chapterSlug: 'chapter-one',
          chapterTitle: 'Title chapter-one',
          isPrimary: true,
        },
      ]);
    });

    // Listing an unpublished Chapter would leak both its existence and its
    // title from a Story the reader can otherwise see.
    it('hides Chapters a reader could not open', async () => {
      appearanceService.findByCharacter.mockResolvedValue([
        buildAppearance('chapter-draft'),
      ]);
      chapterService.findPublicByStory.mockResolvedValue([]);

      const result = await controller.findOne('a-story', 'captain-shran');

      expect(result.appearsIn).toEqual([]);
    });

    it('keeps the readable ones when only some are published', async () => {
      appearanceService.findByCharacter.mockResolvedValue([
        buildAppearance('chapter-1'),
        buildAppearance('chapter-draft'),
      ]);
      chapterService.findPublicByStory.mockResolvedValue([
        buildChapter('chapter-1', 'chapter-one'),
      ]);

      const result = await controller.findOne('a-story', 'captain-shran');

      expect(result.appearsIn).toHaveLength(1);
      expect(result.appearsIn[0].chapterSlug).toBe('chapter-one');
    });

    it('reports an empty list for a Character who appears nowhere', async () => {
      const result = await controller.findOne('a-story', 'captain-shran');

      expect(result.appearsIn).toEqual([]);
    });
  });
});

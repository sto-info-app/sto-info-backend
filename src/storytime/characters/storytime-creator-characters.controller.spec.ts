import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AccessControlService } from '../../access-control/access-control.service';
import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeChapterCharacterEntity } from './entities/storytime-chapter-character.entity';
import { StorytimeCharacterEntity } from './entities/storytime-character.entity';
import { StorytimeAppearanceService } from './storytime-appearance.service';
import { StorytimeCharacterMapper } from './storytime-character.mapper';
import { StorytimeCharacterService } from './storytime-character.service';
import { StorytimeCreatorCharactersController } from './storytime-creator-characters.controller';

describe('StorytimeCreatorCharactersController', () => {
  let controller: StorytimeCreatorCharactersController;
  let characterService: {
    findManagedByStory: jest.Mock;
    findEditableOrFail: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    reorder: jest.Mock;
    remove: jest.Mock;
    findByIds: jest.Mock;
    setPortraitImage: jest.Mock;
    clearPortraitImage: jest.Mock;
  };
  let appearanceService: {
    setAppearances: jest.Mock;
    findByChapterForOwner: jest.Mock;
  };
  let featureService: { assertFlagEnabled: jest.Mock };

  const userId = 'user-1';
  const storyId = 'story-1';
  const characterId = 'character-1';
  const chapterId = 'chapter-1';

  const character = Object.assign(new StorytimeCharacterEntity(), {
    id: characterId,
    storyId,
    slug: 'captain-shran',
    name: 'Captain Shran',
    traits: null,
    isPrimary: false,
    displayOrder: 1000,
    version: 1,
  });

  const appearance = Object.assign(new StorytimeChapterCharacterEntity(), {
    chapterId,
    characterId,
    appearanceOrder: 1000,
    appearanceNotes: null,
    isPrimary: false,
  });

  beforeEach(async () => {
    characterService = {
      findManagedByStory: jest.fn().mockResolvedValue([character]),
      findEditableOrFail: jest.fn().mockResolvedValue(character),
      create: jest.fn().mockResolvedValue(character),
      update: jest.fn().mockResolvedValue(character),
      reorder: jest.fn().mockResolvedValue([character]),
      remove: jest.fn().mockResolvedValue(undefined),
      findByIds: jest.fn().mockResolvedValue([character]),
      setPortraitImage: jest.fn().mockResolvedValue(character),
      clearPortraitImage: jest.fn().mockResolvedValue(character),
    };
    appearanceService = {
      setAppearances: jest.fn().mockResolvedValue([appearance]),
      findByChapterForOwner: jest.fn().mockResolvedValue([appearance]),
    };
    featureService = {
      assertFlagEnabled: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorytimeCreatorCharactersController],
      providers: [
        { provide: StorytimeCharacterService, useValue: characterService },
        { provide: StorytimeAppearanceService, useValue: appearanceService },
        StorytimeCharacterMapper,
        { provide: StorytimeFeatureService, useValue: featureService },
        { provide: AccessControlService, useValue: { can: jest.fn() } },
      ],
    }).compile();

    controller = module.get<StorytimeCreatorCharactersController>(
      StorytimeCreatorCharactersController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('lists the cast of a Story', async () => {
    const result = await controller.findByStory(storyId, userId);

    expect(result).toHaveLength(1);
    expect(characterService.findManagedByStory).toHaveBeenCalledWith(
      storyId,
      userId,
    );
  });

  it('retrieves one Character for editing', async () => {
    const result = await controller.findOne(characterId, userId);

    expect(result.name).toBe('Captain Shran');
    expect(characterService.findEditableOrFail).toHaveBeenCalledWith(
      characterId,
      userId,
    );
  });

  it('creates a Character', async () => {
    await controller.create(storyId, { name: 'Captain Shran' }, userId);

    expect(characterService.create).toHaveBeenCalledWith(
      storyId,
      { name: 'Captain Shran' },
      userId,
    );
  });

  it('updates a Character', async () => {
    await controller.update(characterId, { rank: 'Captain' }, userId);

    expect(characterService.update).toHaveBeenCalledWith(
      characterId,
      { rank: 'Captain' },
      userId,
    );
  });

  it('reorders the cast', async () => {
    await controller.reorder(storyId, { characterIds: ['a', 'b'] }, userId);

    expect(characterService.reorder).toHaveBeenCalledWith(
      storyId,
      ['a', 'b'],
      userId,
    );
  });

  it('deletes a Character', async () => {
    await controller.remove(characterId, userId);

    expect(characterService.remove).toHaveBeenCalledWith(characterId, userId);
  });

  describe('appearances', () => {
    it('sets who appears in a Chapter', async () => {
      const result = await controller.setAppearances(
        chapterId,
        { appearances: [{ characterId }] },
        userId,
      );

      expect(result[0].character?.name).toBe('Captain Shran');
      expect(appearanceService.setAppearances).toHaveBeenCalledWith(
        chapterId,
        { appearances: [{ characterId }] },
        userId,
      );
    });

    it('lists who appears in a Chapter', async () => {
      const result = await controller.findAppearances(chapterId, userId);

      expect(result).toHaveLength(1);
    });

    // Holding the permission to edit your own Stories says nothing about
    // whose Chapter this is, so ownership is checked for the listing too.
    it('checks ownership when listing', async () => {
      await controller.findAppearances(chapterId, userId);

      expect(appearanceService.findByChapterForOwner).toHaveBeenCalledWith(
        chapterId,
        userId,
      );
    });

    it('refuses a Chapter belonging to somebody else', async () => {
      appearanceService.findByChapterForOwner.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        controller.findAppearances(chapterId, userId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('the portrait', () => {
    const file = { originalname: 'portrait.png' } as Express.Multer.File;

    it('passes the upload and its description on', async () => {
      await controller.setPortraitImage(characterId, userId, file, {
        altText: 'An Andorian in uniform',
      });

      expect(characterService.setPortraitImage).toHaveBeenCalledWith(
        characterId,
        userId,
        file,
        'An Andorian in uniform',
      );
    });

    it('asks for the portrait to be removed', async () => {
      await controller.clearPortraitImage(characterId, userId);

      expect(characterService.clearPortraitImage).toHaveBeenCalledWith(
        characterId,
        userId,
      );
    });

    it('complains when no file arrived', async () => {
      await expect(
        controller.setPortraitImage(characterId, userId, undefined, {
          altText: 'An Andorian',
        }),
      ).rejects.toThrow('An image file is required');

      expect(characterService.setPortraitImage).not.toHaveBeenCalled();
    });
  });

  // Characters are part of creating, so they go away with the rest of it
  // rather than carrying on quietly behind a switched-off feature.
  describe('when creation is switched off', () => {
    beforeEach(() => {
      featureService.assertFlagEnabled.mockRejectedValue(
        new ForbiddenException(),
      );
    });

    it.each([
      ['findByStory', () => controller.findByStory(storyId, userId)],
      ['findOne', () => controller.findOne(characterId, userId)],
      ['create', () => controller.create(storyId, { name: 'Shran' }, userId)],
      [
        'update',
        () => controller.update(characterId, { rank: 'Captain' }, userId),
      ],
      [
        'reorder',
        () => controller.reorder(storyId, { characterIds: ['a'] }, userId),
      ],
      [
        'setAppearances',
        () => controller.setAppearances(chapterId, { appearances: [] }, userId),
      ],
      ['findAppearances', () => controller.findAppearances(chapterId, userId)],
      ['remove', () => controller.remove(characterId, userId)],
      [
        'setPortraitImage',
        () =>
          controller.setPortraitImage(
            characterId,
            userId,
            { originalname: 'portrait.png' } as Express.Multer.File,
            { altText: 'An Andorian' },
          ),
      ],
      [
        'clearPortraitImage',
        () => controller.clearPortraitImage(characterId, userId),
      ],
    ])('refuses %s', async (_name, act) => {
      await expect(act()).rejects.toThrow(ForbiddenException);
      expect(featureService.assertFlagEnabled).toHaveBeenCalledWith(
        STORYTIME_FEATURE_FLAGS.CREATION_ENABLED,
      );
    });
  });
});

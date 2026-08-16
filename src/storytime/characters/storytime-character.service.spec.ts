import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LimitService } from '../../access-control/limit.service';
import { STORYTIME_LIMITS } from '../constants/storytime-limits.constants';
import { StorytimeMarkdownService } from '../content/storytime-markdown.service';
import { StorytimeModerationStatus } from '../enums/storytime-moderation-status.enum';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeOrderingService } from '../shared/storytime-ordering.service';
import {
  SlugRequest,
  StorytimeSlugService,
} from '../shared/storytime-slug.service';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeCharacterEntity } from './entities/storytime-character.entity';
import { StorytimeCharacterService } from './storytime-character.service';

describe('StorytimeCharacterService', () => {
  let service: StorytimeCharacterService;
  let characterRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    count: jest.Mock;
    softDelete: jest.Mock;
  };
  let storyService: { findEditableOrFail: jest.Mock };
  let slugService: {
    generateUniqueSlug: jest.Mock;
    recordRetiredSlug: jest.Mock;
  };
  let limitService: { assertWithinLimit: jest.Mock };

  const ownerId = 'e6d3a1b2-0000-4000-8000-000000000001';
  const storyId = 'e6d3a1b2-0000-4000-8000-0000000000aa';
  const characterId = 'e6d3a1b2-0000-4000-8000-0000000000cc';

  /**
   * Builds a Character with sensible defaults.
   *
   * @param overrides - Fields to change.
   * @returns The Character entity.
   */
  const buildCharacter = (
    overrides: Partial<StorytimeCharacterEntity> = {},
  ): StorytimeCharacterEntity =>
    Object.assign(new StorytimeCharacterEntity(), {
      id: characterId,
      storyId,
      name: 'Captain Shran',
      slug: 'captain-shran',
      shortBio: null,
      biographySource: '',
      biographyHtml: null,
      portraitImageId: null,
      portraitImageAlt: null,
      species: null,
      faction: null,
      rank: null,
      occupation: null,
      affiliation: null,
      shipAssignment: null,
      traits: null,
      isPrimary: false,
      displayOrder: 1000,
      moderationStatus: StorytimeModerationStatus.ACTIVE,
      version: 1,
      ...overrides,
    });

  beforeEach(async () => {
    characterRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(input =>
        Object.assign(new StorytimeCharacterEntity(), input),
      ),
      save: jest.fn(input => Promise.resolve(input)),
      count: jest.fn().mockResolvedValue(0),
      softDelete: jest.fn().mockResolvedValue(undefined),
    };

    storyService = {
      findEditableOrFail: jest.fn().mockResolvedValue(
        Object.assign(new StorytimeStoryEntity(), {
          id: storyId,
          ownerUserId: ownerId,
        }),
      ),
    };

    slugService = {
      generateUniqueSlug: jest.fn(async (request: SlugRequest) => {
        await request.isTakenByLiveEntity('candidate-slug');
        return 'captain-shran';
      }),
      recordRetiredSlug: jest.fn().mockResolvedValue(undefined),
    };

    limitService = {
      assertWithinLimit: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeCharacterService,
        {
          provide: getRepositoryToken(StorytimeCharacterEntity),
          useValue: characterRepository,
        },
        { provide: StorytimeStoryService, useValue: storyService },
        { provide: StorytimeSlugService, useValue: slugService },
        StorytimeOrderingService,
        StorytimeMarkdownService,
        { provide: LimitService, useValue: limitService },
      ],
    }).compile();

    service = module.get<StorytimeCharacterService>(StorytimeCharacterService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('creates a Character in the Story', async () => {
      const created = await service.create(
        storyId,
        { name: 'Captain Shran' },
        ownerId,
      );

      expect(created.storyId).toBe(storyId);
      expect(created.createdByUserId).toBe(ownerId);
    });

    // Ownership belongs to the Story, so it is asked of the Story rather than
    // re-derived here.
    it('refuses when the caller does not own the Story', async () => {
      storyService.findEditableOrFail.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.create(storyId, { name: 'Captain Shran' }, ownerId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('names the Character slug scope so it is unique per Story', async () => {
      await service.create(storyId, { name: 'Captain Shran' }, ownerId);

      expect(slugService.generateUniqueSlug).toHaveBeenCalledWith(
        expect.objectContaining({
          targetType: StorytimeTargetType.CHARACTER,
          storyId,
        }),
      );
    });

    it('places the first Character at the start of the cast', async () => {
      const created = await service.create(
        storyId,
        { name: 'Captain Shran' },
        ownerId,
      );

      expect(created.displayOrder).toBe(1000);
    });

    it('places a later Character after the last', async () => {
      characterRepository.findOne.mockResolvedValue(
        buildCharacter({ displayOrder: 3000 }),
      );

      const created = await service.create(storyId, { name: 'T’Pol' }, ownerId);

      expect(created.displayOrder).toBe(4000);
    });

    it('renders the biography', async () => {
      const created = await service.create(
        storyId,
        { name: 'Captain Shran', biographySource: 'An **Andorian** officer.' },
        ownerId,
      );

      expect(created.biographyHtml).toContain('<strong>Andorian</strong>');
    });

    // Every field but the name is optional: a creator sketching a cast should
    // be able to write down eight names and fill in the detail later.
    it('creates a Character with nothing but a name', async () => {
      const created = await service.create(storyId, { name: 'Guard' }, ownerId);

      expect(created.biographySource).toBe('');
      expect(created.shortBio).toBeUndefined();
    });

    it('refuses once the Story is at its Character limit', async () => {
      limitService.assertWithinLimit.mockRejectedValue(
        new BadRequestException('Too many Characters'),
      );

      await expect(
        service.create(storyId, { name: 'Captain Shran' }, ownerId),
      ).rejects.toThrow(BadRequestException);
    });

    it('counts the Story’s existing cast against the limit', async () => {
      characterRepository.count.mockResolvedValue(7);

      await service.create(storyId, { name: 'Captain Shran' }, ownerId);

      expect(limitService.assertWithinLimit).toHaveBeenCalledWith(
        ownerId,
        STORYTIME_LIMITS.MAX_CHARACTERS_PER_STORY.key,
        STORYTIME_LIMITS.MAX_CHARACTERS_PER_STORY.defaultValue,
        7,
      );
    });

    describe('traits', () => {
      it('stores the traits given', async () => {
        const created = await service.create(
          storyId,
          { name: 'Captain Shran', traits: ['Loyal', 'Blunt'] },
          ownerId,
        );

        expect(created.traits).toEqual(['Loyal', 'Blunt']);
      });

      // An empty row left in the editor means nothing there, not a trait with
      // no name.
      it('drops blank traits', async () => {
        const created = await service.create(
          storyId,
          { name: 'Captain Shran', traits: ['Loyal', '   ', ''] },
          ownerId,
        );

        expect(created.traits).toEqual(['Loyal']);
      });

      it('stores nothing when every trait is blank', async () => {
        const created = await service.create(
          storyId,
          { name: 'Captain Shran', traits: ['  '] },
          ownerId,
        );

        expect(created.traits).toBeNull();
      });

      it('stores nothing when no traits are given', async () => {
        const created = await service.create(
          storyId,
          { name: 'Captain Shran' },
          ownerId,
        );

        expect(created.traits).toBeNull();
      });
    });
  });

  describe('update', () => {
    beforeEach(() => {
      characterRepository.findOne.mockResolvedValue(buildCharacter());
    });

    it('changes the name', async () => {
      const updated = await service.update(
        characterId,
        { name: 'General Shran' },
        ownerId,
      );

      expect(updated.name).toBe('General Shran');
      expect(updated.version).toBe(2);
    });

    it('changes the profile fields', async () => {
      const updated = await service.update(
        characterId,
        { species: 'Andorian', rank: 'Captain', isPrimary: true },
        ownerId,
      );

      expect(updated.species).toBe('Andorian');
      expect(updated.rank).toBe('Captain');
      expect(updated.isPrimary).toBe(true);
    });

    it('re-renders the biography when its source changes', async () => {
      const updated = await service.update(
        characterId,
        { biographySource: 'A *new* history.' },
        ownerId,
      );

      expect(updated.biographyHtml).toContain('<em>new</em>');
    });

    it('leaves the biography alone when it is not sent', async () => {
      characterRepository.findOne.mockResolvedValue(
        buildCharacter({ biographyHtml: '<p id="b1">Existing.</p>' }),
      );

      const updated = await service.update(
        characterId,
        { rank: 'Captain' },
        ownerId,
      );

      expect(updated.biographyHtml).toBe('<p id="b1">Existing.</p>');
    });

    it('tidies traits on update', async () => {
      const updated = await service.update(
        characterId,
        { traits: ['Loyal', ' '] },
        ownerId,
      );

      expect(updated.traits).toEqual(['Loyal']);
    });

    // Fan fiction gets linked from forums and Discord, and those links outlive
    // any rename.
    it('retires the old slug when the slug changes', async () => {
      await service.update(characterId, { slug: 'general-shran' }, ownerId);

      expect(slugService.recordRetiredSlug).toHaveBeenCalledWith(
        StorytimeTargetType.CHARACTER,
        characterId,
        'captain-shran',
        expect.any(String),
        storyId,
      );
    });

    it('retires nothing when the slug is unchanged', async () => {
      await service.update(characterId, { slug: 'captain-shran' }, ownerId);

      expect(slugService.recordRetiredSlug).not.toHaveBeenCalled();
    });

    it('retires nothing when no slug is sent', async () => {
      await service.update(characterId, { rank: 'Captain' }, ownerId);

      expect(slugService.recordRetiredSlug).not.toHaveBeenCalled();
    });

    it('refuses a stale edit', async () => {
      await expect(
        service.update(characterId, { name: 'Nope', version: 1 }, ownerId),
      ).resolves.toBeDefined();

      await expect(
        service.update(characterId, { name: 'Nope', version: 99 }, ownerId),
      ).rejects.toThrow(ConflictException);
    });

    it('accepts an edit that sends no version', async () => {
      await expect(
        service.update(characterId, { name: 'General Shran' }, ownerId),
      ).resolves.toBeDefined();
    });

    it('refuses an unknown Character', async () => {
      characterRepository.findOne.mockResolvedValue(null);

      await expect(
        service.update(characterId, { name: 'Nope' }, ownerId),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses when the caller does not own the Story', async () => {
      storyService.findEditableOrFail.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.update(characterId, { name: 'Nope' }, ownerId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('listing', () => {
    it('lists the managed cast in display order', async () => {
      await service.findManagedByStory(storyId, ownerId);

      expect(characterRepository.find).toHaveBeenCalledWith({
        where: { storyId },
        order: { displayOrder: 'ASC', name: 'ASC' },
      });
    });

    it('refuses to list a Story the caller does not own', async () => {
      storyService.findEditableOrFail.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.findManagedByStory(storyId, ownerId),
      ).rejects.toThrow(ForbiddenException);
    });

    // A Character has no publication state; the only thing hidden from readers
    // is one an administrator has removed.
    it('lists only active Characters publicly', async () => {
      await service.findPublicByStory(storyId);

      expect(characterRepository.find).toHaveBeenCalledWith({
        where: { storyId, moderationStatus: StorytimeModerationStatus.ACTIVE },
        order: { displayOrder: 'ASC', name: 'ASC' },
      });
    });

    it('finds a public Character by slug', async () => {
      characterRepository.findOne.mockResolvedValue(buildCharacter());

      await expect(
        service.findPublicBySlug(storyId, 'captain-shran'),
      ).resolves.toBeDefined();
    });

    it('hides a removed Character from readers', async () => {
      characterRepository.findOne.mockResolvedValue(
        buildCharacter({
          moderationStatus: StorytimeModerationStatus.REMOVED,
        }),
      );

      await expect(
        service.findPublicBySlug(storyId, 'captain-shran'),
      ).resolves.toBeNull();
    });

    it('reports nothing for an unknown slug', async () => {
      await expect(
        service.findPublicBySlug(storyId, 'nobody'),
      ).resolves.toBeNull();
    });

    it('finds several Characters by identifier', async () => {
      await service.findByIds(['a', 'b']);

      expect(characterRepository.find).toHaveBeenCalled();
    });

    // Asking the database for nothing would return every Character.
    it('asks for nothing when given no identifiers', async () => {
      await expect(service.findByIds([])).resolves.toEqual([]);
      expect(characterRepository.find).not.toHaveBeenCalled();
    });
  });

  describe('reorder', () => {
    const first = buildCharacter({ id: 'a', displayOrder: 1000 });
    const second = buildCharacter({ id: 'b', displayOrder: 2000 });

    beforeEach(() => {
      characterRepository.find.mockResolvedValue([first, second]);
    });

    it('renumbers the cast into the given order', async () => {
      const reordered = await service.reorder(storyId, ['b', 'a'], ownerId);

      expect(reordered.map(character => character.id)).toEqual(['b', 'a']);
      expect(reordered[0].displayOrder).toBeLessThan(reordered[1].displayOrder);
    });

    // A partial list would leave the rest at positions that no longer mean
    // anything relative to the ones that moved.
    it('refuses a partial order', async () => {
      await expect(service.reorder(storyId, ['a'], ownerId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses an order naming the same Character twice', async () => {
      await expect(
        service.reorder(storyId, ['a', 'a'], ownerId),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses an order naming a Character from elsewhere', async () => {
      await expect(
        service.reorder(storyId, ['a', 'z'], ownerId),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses when the caller does not own the Story', async () => {
      storyService.findEditableOrFail.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.reorder(storyId, ['a', 'b'], ownerId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('remove', () => {
    beforeEach(() => {
      characterRepository.findOne.mockResolvedValue(buildCharacter());
    });

    // Soft-deleted so appearances survive as history and the slug is not
    // immediately reissued to somebody else.
    it('soft-deletes the Character and records who did it', async () => {
      await service.remove(characterId, ownerId);

      expect(characterRepository.softDelete).toHaveBeenCalledWith(characterId);
      expect(characterRepository.save.mock.calls[0][0].deletedByUserId).toBe(
        ownerId,
      );
    });

    it('refuses when the caller does not own the Story', async () => {
      storyService.findEditableOrFail.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(service.remove(characterId, ownerId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('refuses an unknown Character', async () => {
      characterRepository.findOne.mockResolvedValue(null);

      await expect(service.remove(characterId, ownerId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

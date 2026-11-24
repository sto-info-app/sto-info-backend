import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { In } from 'typeorm';

import { LimitService } from '../../access-control/limit.service';
import { StoryCapability } from '../collaboration/storytime-story-capability.enum';
import { STORYTIME_DELETION_REASONS } from '../constants/storytime-deletion.constants';
import { STORYTIME_LIMITS } from '../constants/storytime-limits.constants';
import { StorytimeMarkdownService } from '../content/storytime-markdown.service';
import { StorytimeImageSlot } from '../enums/storytime-image-slot.enum';
import { StorytimeModerationStatus } from '../enums/storytime-moderation-status.enum';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeImageService } from '../images/storytime-image.service';
import { StorytimeOrderingService } from '../shared/storytime-ordering.service';
import {
  SlugRequest,
  StorytimeSlugService,
} from '../shared/storytime-slug.service';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeTagEntity } from '../tags/entities/storytime-tag.entity';
import { StorytimeTaggingService } from '../tags/storytime-tagging.service';
import { StorytimeCharacterCopyEntity } from './entities/storytime-character-copy.entity';
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
    manager: { transaction: jest.Mock };
  };
  let transactionManager: { save: jest.Mock; insert: jest.Mock };
  let storyService: {
    findEditableOrFail: jest.Mock;
    findWithCapabilityForUser: jest.Mock;
  };
  let taggingService: { findFor: jest.Mock; setTags: jest.Mock };
  let slugService: {
    generateUniqueSlug: jest.Mock;
    recordRetiredSlug: jest.Mock;
  };
  let limitService: { assertWithinLimit: jest.Mock };
  let imageService: {
    accept: jest.Mock;
    withdraw: jest.Mock;
  };

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
    // The upload pipeline is stubbed: what a real Cloudflare call would do is
    // its own service's business, and these tests are about what the work
    // records afterwards.
    imageService = {
      accept: jest
        .fn()
        .mockResolvedValue({ assetId: 'asset-1', status: 'SCANNING' }),
      withdraw: jest.fn().mockResolvedValue(undefined),
    };

    // The copy and its Security Log record are saved in one transaction; the
    // stub runs the work against a manager the tests can inspect.
    transactionManager = {
      save: jest.fn(input => Promise.resolve(input)),
      insert: jest.fn().mockResolvedValue(undefined),
    };

    characterRepository = {
      manager: {
        transaction: jest.fn(
          (work: (manager: typeof transactionManager) => Promise<unknown>) =>
            work(transactionManager),
        ),
      },
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
      findWithCapabilityForUser: jest.fn().mockResolvedValue([]),
    };

    taggingService = {
      findFor: jest.fn().mockResolvedValue([]),
      setTags: jest.fn().mockResolvedValue([]),
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
        { provide: StorytimeImageService, useValue: imageService },
        { provide: StorytimeTaggingService, useValue: taggingService },
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

  // sc-1483: copying a Character from another of the creator's Stories.
  describe('copying from another Story', () => {
    const sourceStoryId = 'e6d3a1b2-0000-4000-8000-0000000000bb';
    const sourceCharacterId = 'e6d3a1b2-0000-4000-8000-0000000000dd';
    const copyId = 'e6d3a1b2-0000-4000-8000-0000000000ee';

    /**
     * Builds a Story with sensible defaults.
     *
     * @param overrides - Fields to change.
     * @returns The Story entity.
     */
    const buildStory = (
      overrides: Partial<StorytimeStoryEntity> = {},
    ): StorytimeStoryEntity =>
      Object.assign(new StorytimeStoryEntity(), {
        id: storyId,
        ownerUserId: ownerId,
        title: 'The Long Way Home',
        moderationStatus: StorytimeModerationStatus.ACTIVE,
        ...overrides,
      });

    /** The Character being copied, with every descriptive field filled. */
    const buildOriginal = (
      overrides: Partial<StorytimeCharacterEntity> = {},
    ): StorytimeCharacterEntity =>
      buildCharacter({
        id: sourceCharacterId,
        storyId: sourceStoryId,
        name: 'Captain Shran',
        slug: 'captain-shran',
        shortBio: 'An Andorian officer.',
        biographySource: 'An **Andorian** officer.',
        biographyHtml: '<p>Stale HTML</p>',
        portraitImageId: 'portrait-image-id',
        portraitImageAlt: 'Shran on the bridge',
        species: 'Andorian',
        faction: 'Imperial Guard',
        rank: 'Commander',
        occupation: 'Captain',
        affiliation: 'Andorian Empire',
        shipAssignment: 'Kumari',
        traits: ['Stubborn', 'Loyal'],
        isPrimary: true,
        displayOrder: 2000,
        ...overrides,
      });

    let original: StorytimeCharacterEntity;

    beforeEach(() => {
      original = buildOriginal();
      storyService.findEditableOrFail.mockImplementation((id: string) =>
        Promise.resolve(buildStory({ id })),
      );
      // The original is found by its identifier; the end of the target's cast
      // by its Story.
      characterRepository.findOne.mockImplementation(
        (options: { where: { id?: string } }) =>
          Promise.resolve(
            options.where.id === sourceCharacterId
              ? original
              : buildCharacter({ displayOrder: 3000 }),
          ),
      );
      transactionManager.save.mockImplementation(
        (input: StorytimeCharacterEntity) =>
          Promise.resolve(Object.assign(input, { id: copyId })),
      );
    });

    describe('copyFrom', () => {
      it('copies every descriptive field into the target Story', async () => {
        const { copy } = await service.copyFrom(
          storyId,
          sourceCharacterId,
          ownerId,
        );

        expect(copy).toMatchObject({
          storyId,
          name: 'Captain Shran',
          shortBio: 'An Andorian officer.',
          biographySource: 'An **Andorian** officer.',
          species: 'Andorian',
          faction: 'Imperial Guard',
          rank: 'Commander',
          occupation: 'Captain',
          affiliation: 'Andorian Empire',
          shipAssignment: 'Kumari',
          traits: ['Stubborn', 'Loyal'],
          isPrimary: true,
          createdByUserId: ownerId,
          updatedByUserId: ownerId,
        });
      });

      it('renders the biography afresh rather than copying its HTML', async () => {
        const { copy } = await service.copyFrom(
          storyId,
          sourceCharacterId,
          ownerId,
        );

        expect(copy.biographyHtml).toContain('<strong>Andorian</strong>');
        expect(copy.biographyHtml).not.toContain('Stale HTML');
      });

      it('takes no portrait, so the two never share an image', async () => {
        const { copy, original: returned } = await service.copyFrom(
          storyId,
          sourceCharacterId,
          ownerId,
        );

        expect(copy.portraitImageId ?? null).toBeNull();
        expect(copy.portraitImageAlt ?? null).toBeNull();
        expect(returned).toBe(original);
        expect(imageService.accept).not.toHaveBeenCalled();
      });

      it('gives the copy its own traits list, so editing one leaves the other', async () => {
        const { copy } = await service.copyFrom(
          storyId,
          sourceCharacterId,
          ownerId,
        );

        copy.traits?.push('Changed');

        expect(original.traits).toEqual(['Stubborn', 'Loyal']);
      });

      it('copies an original with no traits as having none', async () => {
        original = buildOriginal({ traits: null });

        const { copy } = await service.copyFrom(
          storyId,
          sourceCharacterId,
          ownerId,
        );

        expect(copy.traits).toBeNull();
      });

      it('asks for the original slug, unique within the target Story', async () => {
        await service.copyFrom(storyId, sourceCharacterId, ownerId);

        expect(slugService.generateUniqueSlug).toHaveBeenCalledWith(
          expect.objectContaining({
            desiredSlug: 'captain-shran',
            title: 'Captain Shran',
            targetType: StorytimeTargetType.CHARACTER,
            storyId,
          }),
        );
        expect(characterRepository.count).toHaveBeenCalledWith({
          where: expect.objectContaining({
            storyId,
            slug: 'candidate-slug',
          }),
        });
      });

      it('puts the copy at the end of the target cast', async () => {
        const { copy } = await service.copyFrom(
          storyId,
          sourceCharacterId,
          ownerId,
        );

        expect(characterRepository.findOne).toHaveBeenCalledWith({
          where: { storyId },
          order: { displayOrder: 'DESC' },
        });
        expect(copy.displayOrder).toBe(4000);
      });

      it('saves the copy and its Security Log record together', async () => {
        await service.copyFrom(storyId, sourceCharacterId, ownerId);

        expect(characterRepository.manager.transaction).toHaveBeenCalledTimes(
          1,
        );
        expect(characterRepository.save).not.toHaveBeenCalled();
        expect(transactionManager.insert).toHaveBeenCalledWith(
          StorytimeCharacterCopyEntity,
          {
            actorUserId: ownerId,
            sourceCharacterId,
            sourceStoryId,
            copyCharacterId: copyId,
            targetStoryId: storyId,
          },
        );
      });

      it('gives the copy the tags the original carries', async () => {
        taggingService.findFor.mockResolvedValue([
          Object.assign(new StorytimeTagEntity(), { id: 'tag-1' }),
          Object.assign(new StorytimeTagEntity(), { id: 'tag-2' }),
        ]);

        await service.copyFrom(storyId, sourceCharacterId, ownerId);

        expect(taggingService.findFor).toHaveBeenCalledWith(
          StorytimeTargetType.CHARACTER,
          sourceCharacterId,
        );
        expect(taggingService.setTags).toHaveBeenCalledWith(
          StorytimeTargetType.CHARACTER,
          copyId,
          ['tag-1', 'tag-2'],
        );
      });

      it('sets no tags when the original has none', async () => {
        await service.copyFrom(storyId, sourceCharacterId, ownerId);

        expect(taggingService.setTags).not.toHaveBeenCalled();
      });

      it('needs Manage Characters on both Stories', async () => {
        await service.copyFrom(storyId, sourceCharacterId, ownerId);

        expect(storyService.findEditableOrFail).toHaveBeenCalledWith(
          storyId,
          ownerId,
          StoryCapability.MANAGE_CHARACTERS,
        );
        expect(storyService.findEditableOrFail).toHaveBeenCalledWith(
          sourceStoryId,
          ownerId,
          StoryCapability.MANAGE_CHARACTERS,
        );
      });

      it('refuses when the caller may not manage the target cast', async () => {
        storyService.findEditableOrFail.mockRejectedValue(
          new ForbiddenException(),
        );

        await expect(
          service.copyFrom(storyId, sourceCharacterId, ownerId),
        ).rejects.toThrow(ForbiddenException);
        expect(characterRepository.manager.transaction).not.toHaveBeenCalled();
      });

      it('refuses when the caller may not manage the original cast', async () => {
        storyService.findEditableOrFail.mockImplementation((id: string) =>
          id === sourceStoryId
            ? Promise.reject(new ForbiddenException())
            : Promise.resolve(buildStory({ id })),
        );

        await expect(
          service.copyFrom(storyId, sourceCharacterId, ownerId),
        ).rejects.toThrow(ForbiddenException);
        expect(characterRepository.manager.transaction).not.toHaveBeenCalled();
      });

      it('reports a Character that does not exist', async () => {
        characterRepository.findOne.mockResolvedValue(null);

        await expect(
          service.copyFrom(storyId, sourceCharacterId, ownerId),
        ).rejects.toThrow(NotFoundException);
      });

      it('refuses a Character already in the target Story', async () => {
        original = buildOriginal({ storyId });

        await expect(
          service.copyFrom(storyId, sourceCharacterId, ownerId),
        ).rejects.toThrow(BadRequestException);
        expect(characterRepository.manager.transaction).not.toHaveBeenCalled();
      });

      it('refuses a Character an administrator has removed', async () => {
        original = buildOriginal({
          moderationStatus: StorytimeModerationStatus.REMOVED,
        });

        await expect(
          service.copyFrom(storyId, sourceCharacterId, ownerId),
        ).rejects.toThrow(
          'A Character an administrator has removed cannot be copied.',
        );
        expect(characterRepository.manager.transaction).not.toHaveBeenCalled();
      });

      it('refuses a Character whose Story an administrator has removed', async () => {
        storyService.findEditableOrFail.mockImplementation((id: string) =>
          Promise.resolve(
            buildStory({
              id,
              moderationStatus:
                id === sourceStoryId
                  ? StorytimeModerationStatus.REMOVED
                  : StorytimeModerationStatus.ACTIVE,
            }),
          ),
        );

        await expect(
          service.copyFrom(storyId, sourceCharacterId, ownerId),
        ).rejects.toThrow(BadRequestException);
        expect(characterRepository.manager.transaction).not.toHaveBeenCalled();
      });

      it('refuses once the target Story is at its Character limit', async () => {
        limitService.assertWithinLimit.mockRejectedValue(
          new BadRequestException('Too many Characters'),
        );

        await expect(
          service.copyFrom(storyId, sourceCharacterId, ownerId),
        ).rejects.toThrow('Too many Characters');
        expect(characterRepository.count).toHaveBeenCalledWith({
          where: { storyId },
        });
        expect(characterRepository.manager.transaction).not.toHaveBeenCalled();
      });
    });

    describe('findCopyable', () => {
      it('needs Manage Characters on the target Story', async () => {
        storyService.findEditableOrFail.mockRejectedValue(
          new ForbiddenException(),
        );

        await expect(service.findCopyable(storyId, ownerId)).rejects.toThrow(
          ForbiddenException,
        );
        expect(storyService.findWithCapabilityForUser).not.toHaveBeenCalled();
      });

      it('offers the Characters of every other Story the caller can manage', async () => {
        const otherStory = buildStory({ id: sourceStoryId, title: 'Shared' });
        const thirdStoryId = 'e6d3a1b2-0000-4000-8000-0000000000ff';
        const emptyStory = buildStory({ id: thirdStoryId, title: 'Empty' });
        storyService.findWithCapabilityForUser.mockResolvedValue([
          buildStory(),
          otherStory,
          emptyStory,
        ]);
        characterRepository.find.mockResolvedValue([original]);

        await expect(service.findCopyable(storyId, ownerId)).resolves.toEqual([
          { story: otherStory, characters: [original] },
        ]);

        expect(storyService.findWithCapabilityForUser).toHaveBeenCalledWith(
          ownerId,
          StoryCapability.MANAGE_CHARACTERS,
        );
        expect(characterRepository.find).toHaveBeenCalledWith({
          where: {
            storyId: In([sourceStoryId, thirdStoryId]),
            moderationStatus: StorytimeModerationStatus.ACTIVE,
          },
          order: { displayOrder: 'ASC', name: 'ASC' },
        });
      });

      it('offers nothing from a Story an administrator has removed', async () => {
        storyService.findWithCapabilityForUser.mockResolvedValue([
          buildStory({
            id: sourceStoryId,
            moderationStatus: StorytimeModerationStatus.REMOVED,
          }),
        ]);

        await expect(service.findCopyable(storyId, ownerId)).resolves.toEqual(
          [],
        );
        expect(characterRepository.find).not.toHaveBeenCalled();
      });
    });
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

    // A reader who followed a link deserves to know the Character was taken
    // down rather than being told it never existed. Its Story's readability is
    // the gate, and the caller has already passed it to get here.
    it('says a removed Character is gone rather than missing', async () => {
      characterRepository.findOne.mockResolvedValue(
        buildCharacter({
          moderationStatus: StorytimeModerationStatus.REMOVED,
        }),
      );

      await expect(
        service.findPublicBySlug(storyId, 'captain-shran'),
      ).rejects.toThrow(GoneException);
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

  describe('the portrait', () => {
    const file = { originalname: 'portrait.png' } as Express.Multer.File;

    it('sends the upload to be scanned, with what it shows', async () => {
      characterRepository.findOne.mockResolvedValue(buildCharacter());

      const accepted = await service.setPortraitImage(
        characterId,
        ownerId,
        file,
        'An Andorian in uniform',
      );

      expect(imageService.accept).toHaveBeenCalledWith({
        slot: StorytimeImageSlot.CHARACTER_PORTRAIT,
        userId: ownerId,
        entityId: characterId,
        file,
        altText: 'An Andorian in uniform',
      });
      expect(accepted).toEqual({ assetId: 'asset-1', status: 'SCANNING' });
    });

    it('leaves the cast list untouched while the upload is scanned', async () => {
      characterRepository.findOne.mockResolvedValue(
        buildCharacter({ portraitImageId: 'old-portrait' }),
      );

      await service.setPortraitImage(characterId, ownerId, file, 'An Andorian');

      expect(characterRepository.save).not.toHaveBeenCalled();
    });

    it('refuses somebody who may not manage this cast', async () => {
      characterRepository.findOne.mockResolvedValue(buildCharacter());
      storyService.findEditableOrFail.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.setPortraitImage(characterId, ownerId, file, 'An Andorian'),
      ).rejects.toThrow(ForbiddenException);

      expect(imageService.accept).not.toHaveBeenCalled();
    });

    it('clears the description along with the portrait', async () => {
      characterRepository.findOne.mockResolvedValue(
        buildCharacter({
          portraitImageId: 'portrait-1',
          portraitImageAlt: 'An Andorian',
        }),
      );

      const saved = await service.clearPortraitImage(characterId, ownerId);

      expect(saved.portraitImageId).toBeNull();
      expect(saved.portraitImageAlt).toBeNull();
      expect(imageService.withdraw).toHaveBeenCalledWith(
        StorytimeImageSlot.CHARACTER_PORTRAIT,
        characterId,
        'portrait-1',
      );
    });

    it('refuses a removal from somebody who may not manage it', async () => {
      characterRepository.findOne.mockResolvedValue(buildCharacter());
      storyService.findEditableOrFail.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.clearPortraitImage(characterId, ownerId),
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

    // A deleted Character cannot be brought back, so the portrait goes too.
    it('withdraws their portrait once deleted', async () => {
      characterRepository.findOne.mockResolvedValue(
        buildCharacter({ portraitImageId: 'portrait-1' }),
      );
      imageService.withdraw.mockImplementation(() => {
        expect(characterRepository.softDelete).toHaveBeenCalledWith(
          characterId,
        );

        return Promise.resolve(undefined);
      });

      await service.remove(characterId, ownerId);

      expect(imageService.withdraw).toHaveBeenCalledWith(
        StorytimeImageSlot.CHARACTER_PORTRAIT,
        characterId,
        'portrait-1',
        STORYTIME_DELETION_REASONS.CHARACTER,
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

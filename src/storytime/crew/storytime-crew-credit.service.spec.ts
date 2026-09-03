import {
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { StorytimeCharacterEntity } from '../characters/entities/storytime-character.entity';
import { StoryCapability } from '../collaboration/storytime-story-capability.enum';
import { CrewCreditScope } from '../enums/crew-credit-scope.enum';
import { StorytimeModerationStatus } from '../enums/storytime-moderation-status.enum';
import { StorytimeOrderingService } from '../shared/storytime-ordering.service';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeCrewCreditEntity } from './entities/storytime-crew-credit.entity';
import { StorytimeCrewRoleEntity } from './entities/storytime-crew-role.entity';
import { StorytimeCrewCreditService } from './storytime-crew-credit.service';

describe('StorytimeCrewCreditService', () => {
  let service: StorytimeCrewCreditService;
  let creditRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    count: jest.Mock;
    softDelete: jest.Mock;
  };
  let roleRepository: { find: jest.Mock; count: jest.Mock };
  let chapterRepository: { findOne: jest.Mock };
  let characterRepository: { findOne: jest.Mock };
  let storyService: { findEditableOrFail: jest.Mock };

  const ownerId = 'e6d3a1b2-0000-4000-8000-000000000001';
  const memberId = 'e6d3a1b2-0000-4000-8000-000000000002';
  const storyId = 'e6d3a1b2-0000-4000-8000-0000000000aa';
  const otherStoryId = 'e6d3a1b2-0000-4000-8000-0000000000ab';
  const chapterId = 'e6d3a1b2-0000-4000-8000-0000000000bb';
  const characterId = 'e6d3a1b2-0000-4000-8000-0000000000cc';
  const roleId = 'e6d3a1b2-0000-4000-8000-0000000000ee';
  const creditId = 'e6d3a1b2-0000-4000-8000-0000000000ff';

  /**
   * Builds a credit.
   *
   * @param overrides - Fields to change.
   * @returns The credit entity.
   */
  const buildCredit = (
    overrides: Partial<StorytimeCrewCreditEntity> = {},
  ): StorytimeCrewCreditEntity =>
    Object.assign(new StorytimeCrewCreditEntity(), {
      id: creditId,
      storyId,
      chapterId: null,
      characterId: null,
      userId: memberId,
      roleId,
      creditLabel: null,
      notes: null,
      orderIndex: 1000,
      moderationStatus: StorytimeModerationStatus.ACTIVE,
      ...overrides,
    });

  beforeEach(async () => {
    creditRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(input =>
        Object.assign(new StorytimeCrewCreditEntity(), input),
      ),
      save: jest.fn(input => Promise.resolve(input)),
      count: jest.fn().mockResolvedValue(0),
      softDelete: jest.fn().mockResolvedValue(undefined),
    };
    roleRepository = {
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(1),
    };
    chapterRepository = {
      findOne: jest.fn().mockResolvedValue(
        Object.assign(new StorytimeChapterEntity(), {
          id: chapterId,
          storyId,
        }),
      ),
    };
    characterRepository = {
      findOne: jest.fn().mockResolvedValue(
        Object.assign(new StorytimeCharacterEntity(), {
          id: characterId,
          storyId,
        }),
      ),
    };
    storyService = {
      findEditableOrFail: jest.fn().mockResolvedValue({ id: storyId }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeCrewCreditService,
        {
          provide: getRepositoryToken(StorytimeCrewCreditEntity),
          useValue: creditRepository,
        },
        {
          provide: getRepositoryToken(StorytimeCrewRoleEntity),
          useValue: roleRepository,
        },
        {
          provide: getRepositoryToken(StorytimeChapterEntity),
          useValue: chapterRepository,
        },
        {
          provide: getRepositoryToken(StorytimeCharacterEntity),
          useValue: characterRepository,
        },
        { provide: StorytimeStoryService, useValue: storyService },
        StorytimeOrderingService,
      ],
    }).compile();

    service = module.get<StorytimeCrewCreditService>(
      StorytimeCrewCreditService,
    );
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('crediting somebody', () => {
    it('credits them on the Story', async () => {
      const credit = await service.create(
        storyId,
        { userId: memberId, roleId },
        ownerId,
      );

      expect(credit.userId).toBe(memberId);
      expect(credit.storyId).toBe(storyId);
      expect(credit.createdByUserId).toBe(ownerId);
    });

    // Crediting is public thanks, so it needs the crew capability rather than
    // the far heavier one that hands somebody the Story.
    it('needs permission to manage crew', async () => {
      await service.create(storyId, { userId: memberId, roleId }, ownerId);

      expect(storyService.findEditableOrFail).toHaveBeenCalledWith(
        storyId,
        ownerId,
        StoryCapability.MANAGE_CREW,
      );
    });

    it('refuses when the caller may not manage crew', async () => {
      storyService.findEditableOrFail.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.create(storyId, { userId: memberId, roleId }, ownerId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('places a later credit after the last', async () => {
      creditRepository.findOne.mockResolvedValue(
        buildCredit({ orderIndex: 3000 }),
      );

      const credit = await service.create(
        storyId,
        { userId: memberId, roleId },
        ownerId,
      );

      expect(credit.orderIndex).toBe(4000);
    });

    it('refuses a role that does not exist', async () => {
      roleRepository.count.mockResolvedValue(0);

      await expect(
        service.create(storyId, { userId: memberId, roleId }, ownerId),
      ).rejects.toThrow(/role does not exist/);
    });

    // Caught here as well as by the unique index, so a creator adding the same
    // credit twice gets a sentence rather than a constraint violation.
    it('refuses the same credit twice', async () => {
      creditRepository.count.mockResolvedValue(1);

      await expect(
        service.create(storyId, { userId: memberId, roleId }, ownerId),
      ).rejects.toThrow(/already credited/);
    });
  });

  describe('what a credit may be attached to', () => {
    it('credits the whole Story when nothing else is named', async () => {
      const credit = await service.create(
        storyId,
        { userId: memberId, roleId },
        ownerId,
      );

      expect(credit.chapterId).toBeNull();
      expect(credit.characterId).toBeNull();
      expect(credit.scope).toBe(CrewCreditScope.STORY);
    });

    it('credits a Chapter when one is named', async () => {
      const credit = await service.create(
        storyId,
        { userId: memberId, roleId, chapterId },
        ownerId,
      );

      expect(credit.scope).toBe(CrewCreditScope.CHAPTER);
    });

    it('credits a Character when one is named', async () => {
      const credit = await service.create(
        storyId,
        { userId: memberId, roleId, characterId },
        ownerId,
      );

      expect(credit.scope).toBe(CrewCreditScope.CHARACTER);
    });

    // A voice credit for a single scene names both.
    it('credits a Character within a Chapter', async () => {
      const credit = await service.create(
        storyId,
        { userId: memberId, roleId, chapterId, characterId },
        ownerId,
      );

      expect(credit.scope).toBe(CrewCreditScope.CHARACTER);
      expect(credit.chapterId).toBe(chapterId);
    });

    // Crediting against another Story's Chapter would put a name in a credits
    // roll its owner never wrote and cannot remove.
    it('refuses a Chapter from another Story', async () => {
      chapterRepository.findOne.mockResolvedValue(
        Object.assign(new StorytimeChapterEntity(), {
          id: chapterId,
          storyId: otherStoryId,
        }),
      );

      await expect(
        service.create(
          storyId,
          { userId: memberId, roleId, chapterId },
          ownerId,
        ),
      ).rejects.toThrow(/Chapter does not belong/);
    });

    it('refuses a Chapter that does not exist', async () => {
      chapterRepository.findOne.mockResolvedValue(null);

      await expect(
        service.create(
          storyId,
          { userId: memberId, roleId, chapterId },
          ownerId,
        ),
      ).rejects.toThrow(/Chapter does not belong/);
    });

    it('refuses a Character from another Story', async () => {
      characterRepository.findOne.mockResolvedValue(
        Object.assign(new StorytimeCharacterEntity(), {
          id: characterId,
          storyId: otherStoryId,
        }),
      );

      await expect(
        service.create(
          storyId,
          { userId: memberId, roleId, characterId },
          ownerId,
        ),
      ).rejects.toThrow(/Character does not belong/);
    });

    it('refuses a Character that does not exist', async () => {
      characterRepository.findOne.mockResolvedValue(null);

      await expect(
        service.create(
          storyId,
          { userId: memberId, roleId, characterId },
          ownerId,
        ),
      ).rejects.toThrow(/Character does not belong/);
    });
  });

  describe('changing a credit', () => {
    beforeEach(() => {
      creditRepository.findOne.mockResolvedValue(buildCredit());
    });

    it('rewords it', async () => {
      const updated = await service.update(
        creditId,
        { creditLabel: 'Additional dialogue' },
        ownerId,
      );

      expect(updated.creditLabel).toBe('Additional dialogue');
      expect(updated.updatedByUserId).toBe(ownerId);
    });

    it('needs permission to manage crew', async () => {
      await service.update(creditId, { notes: 'Chapters 1–4' }, ownerId);

      expect(storyService.findEditableOrFail).toHaveBeenCalledWith(
        storyId,
        ownerId,
        StoryCapability.MANAGE_CREW,
      );
    });

    it('reports a credit that does not exist', async () => {
      creditRepository.findOne.mockResolvedValue(null);

      await expect(service.update(creditId, {}, ownerId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('removing a credit', () => {
    beforeEach(() => {
      creditRepository.findOne.mockResolvedValue(buildCredit());
    });

    // Soft-deleted, so the same person may be credited in the same role again
    // later without colliding with the row that used to say so.
    it('soft-deletes it', async () => {
      await service.remove(creditId, ownerId);

      expect(creditRepository.softDelete).toHaveBeenCalledWith(creditId);
    });

    it('needs permission to manage crew', async () => {
      storyService.findEditableOrFail.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(service.remove(creditId, ownerId)).rejects.toThrow(
        ForbiddenException,
      );
      expect(creditRepository.softDelete).not.toHaveBeenCalled();
    });

    it('reports a credit that does not exist', async () => {
      creditRepository.findOne.mockResolvedValue(null);

      await expect(service.remove(creditId, ownerId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reading credits', () => {
    it('lists a Story’s credits in credits-roll order', async () => {
      await service.findByStory(storyId);

      expect(creditRepository.find).toHaveBeenCalledWith({
        where: {
          storyId,
          moderationStatus: StorytimeModerationStatus.ACTIVE,
        },
        order: { orderIndex: 'ASC' },
      });
    });

    it('lists somebody’s own credits', async () => {
      await service.findByUser(memberId);

      expect(creditRepository.find).toHaveBeenCalledWith({
        where: {
          userId: memberId,
          moderationStatus: StorytimeModerationStatus.ACTIVE,
        },
        order: { createdAt: 'DESC' },
      });
    });

    it('loads the roles a set of credits names', async () => {
      await service.findRolesByIds([roleId]);

      expect(roleRepository.find).toHaveBeenCalled();
    });

    // Asking the database for nothing would return every role.
    it('asks for nothing when given no roles', async () => {
      await expect(service.findRolesByIds([])).resolves.toEqual([]);
      expect(roleRepository.find).not.toHaveBeenCalled();
    });
  });

  it('refuses a credit whose role check throws', async () => {
    roleRepository.count.mockResolvedValue(0);

    await expect(
      service.create(storyId, { userId: memberId, roleId }, ownerId),
    ).rejects.toThrow(BadRequestException);
  });
});

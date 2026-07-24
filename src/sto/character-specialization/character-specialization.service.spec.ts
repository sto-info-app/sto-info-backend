import { jest } from '@jest/globals';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CharacterOwnershipService } from 'src/sto/character/character-ownership.service';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';
import { Not } from 'typeorm';
import { CharacterSpecializationService } from './character-specialization.service';
import { UpdateCharacterSpecializationProgressDto } from './dto/update-character-specialization-progress.dto';
import { CharacterSpecializationProgressEntity } from './entities/character-specialization-progress.entity';
import { CharacterSpecializationEntity } from './entities/character-specialization.entity';

describe('CharacterSpecializationService', () => {
  let service: CharacterSpecializationService;

  let specializationRepository: any;
  let progressRepository: any;
  let characterRepository: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CharacterSpecializationService,
        CharacterOwnershipService,
        {
          provide: getRepositoryToken(CharacterSpecializationEntity),
          useValue: {
            find: jest.fn<(...args: any[]) => Promise<any>>(),
            findOne: jest.fn<(...args: any[]) => Promise<any>>(),
          },
        },
        {
          provide: getRepositoryToken(CharacterSpecializationProgressEntity),
          useValue: {
            find: jest.fn<(...args: any[]) => Promise<any>>(),
            findOne: jest.fn<(...args: any[]) => Promise<any>>(),
            create: jest.fn<(...args: any[]) => any>(),
            save: jest.fn<(...args: any[]) => Promise<any>>(),
            update: jest.fn<(...args: any[]) => Promise<any>>(),
          },
        },
        {
          provide: getRepositoryToken(CharacterEntity),
          useValue: {
            findOne: jest.fn<(...args: any[]) => Promise<any>>(),
          },
        },
      ],
    }).compile();

    service = module.get<CharacterSpecializationService>(
      CharacterSpecializationService,
    );
    specializationRepository = module.get(
      getRepositoryToken(CharacterSpecializationEntity),
    );
    progressRepository = module.get(
      getRepositoryToken(CharacterSpecializationProgressEntity),
    );
    characterRepository = module.get(getRepositoryToken(CharacterEntity));

    characterRepository.findOne.mockResolvedValue({
      id: 'character-1',
      account: { id: 'account-1', userId: 'user-1' },
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSpecializations', () => {
    it('should query all specializations ordered by sortOrder then name', async () => {
      specializationRepository.find.mockResolvedValue([{ id: 'spec-1' }]);

      const result = await service.getSpecializations();

      expect(result).toEqual([{ id: 'spec-1' }]);
      expect(specializationRepository.find).toHaveBeenCalledWith({
        order: { sortOrder: 'ASC', name: 'ASC' },
      });
    });
  });

  describe('getProgress', () => {
    const specializations = [
      { id: 'spec-a', name: 'Pilot', type: 'primary', maxPoints: 30 },
      { id: 'spec-b', name: 'Strategist', type: 'secondary', maxPoints: 15 },
    ];

    it('should throw NotFoundException when character does not exist', async () => {
      characterRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getProgress('missing-character', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when character belongs to another user', async () => {
      characterRepository.findOne.mockResolvedValue({
        id: 'character-1',
        account: { id: 'account-1', userId: 'other-user' },
      });

      await expect(
        service.getProgress('character-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should return existing and synthetic entries for all specializations', async () => {
      specializationRepository.find.mockResolvedValue(specializations);
      progressRepository.find.mockResolvedValue([
        {
          id: 'progress-1',
          characterId: 'character-1',
          specializationId: 'spec-b',
          specialization: specializations[1],
          pointsSpent: 9,
          slot: 'secondary',
        },
      ]);

      const result = await service.getProgress('character-1', 'user-1');

      expect(result).toHaveLength(2);
      expect(
        result.find((item: any) => item.specializationId === 'spec-a'),
      ).toMatchObject({
        id: '',
        characterId: 'character-1',
        specializationId: 'spec-a',
        pointsSpent: 0,
        slot: null,
      });
      expect(
        result.find((item: any) => item.specializationId === 'spec-b'),
      ).toMatchObject({
        id: 'progress-1',
        pointsSpent: 9,
        slot: 'secondary',
      });
      expect(progressRepository.find).toHaveBeenCalledWith({
        where: { characterId: 'character-1' },
        relations: { specialization: true },
      });
    });
  });

  describe('updateProgress', () => {
    const dto: UpdateCharacterSpecializationProgressDto = { pointsSpent: 20 };

    it('should throw NotFoundException when the specialization does not exist', async () => {
      specializationRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateProgress('character-1', 'user-1', 'missing-spec', dto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject points above the specialization maximum', async () => {
      specializationRepository.findOne.mockResolvedValue({
        id: 'spec-b',
        name: 'Strategist',
        type: 'secondary',
        maxPoints: 15,
      });

      await expect(
        service.updateProgress('character-1', 'user-1', 'spec-b', dto),
      ).rejects.toThrow(BadRequestException);
      expect(progressRepository.save).not.toHaveBeenCalled();
    });

    it('should create and save a new progress record when one does not exist', async () => {
      const specialization = {
        id: 'spec-a',
        name: 'Pilot',
        type: 'primary',
        maxPoints: 30,
      };
      const created = {
        characterId: 'character-1',
        specializationId: 'spec-a',
        pointsSpent: 0,
        slot: null,
      };

      specializationRepository.findOne.mockResolvedValue(specialization);
      progressRepository.findOne.mockResolvedValue(null);
      progressRepository.create.mockReturnValue(created);
      progressRepository.save.mockResolvedValue(created);

      const result = await service.updateProgress(
        'character-1',
        'user-1',
        'spec-a',
        dto,
      );

      expect(progressRepository.create).toHaveBeenCalledWith({
        characterId: 'character-1',
        specializationId: 'spec-a',
        pointsSpent: 0,
        slot: null,
      });
      expect(progressRepository.save).toHaveBeenCalledWith(created);
      expect(result.pointsSpent).toBe(20);
      expect(result.specialization).toEqual(specialization);
    });

    it('should update and save an existing progress record', async () => {
      const specialization = {
        id: 'spec-a',
        name: 'Pilot',
        type: 'primary',
        maxPoints: 30,
      };
      const existing = {
        id: 'progress-existing',
        characterId: 'character-1',
        specializationId: 'spec-a',
        pointsSpent: 3,
        slot: null,
        specialization,
      };

      specializationRepository.findOne.mockResolvedValue(specialization);
      progressRepository.findOne.mockResolvedValue(existing);
      progressRepository.save.mockResolvedValue(existing);

      const result = await service.updateProgress(
        'character-1',
        'user-1',
        'spec-a',
        dto,
      );

      expect(progressRepository.create).not.toHaveBeenCalled();
      expect(existing.pointsSpent).toBe(20);
      expect(progressRepository.save).toHaveBeenCalledWith(existing);
      expect(result.specialization).toEqual(specialization);
    });
  });

  describe('updateSlot', () => {
    const primarySpec = {
      id: 'spec-a',
      name: 'Pilot',
      type: 'primary',
      maxPoints: 30,
    };
    const secondarySpec = {
      id: 'spec-b',
      name: 'Strategist',
      type: 'secondary',
      maxPoints: 15,
    };

    it('should throw NotFoundException when the specialization does not exist', async () => {
      specializationRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateSlot('character-1', 'user-1', 'missing-spec', {
          slot: 'primary',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject slotting a secondary-only specialization as primary', async () => {
      specializationRepository.findOne.mockResolvedValue(secondarySpec);

      await expect(
        service.updateSlot('character-1', 'user-1', 'spec-b', {
          slot: 'primary',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(progressRepository.save).not.toHaveBeenCalled();
    });

    it('should release the slot from any other specialization before claiming it', async () => {
      const existing = {
        id: 'progress-1',
        characterId: 'character-1',
        specializationId: 'spec-a',
        pointsSpent: 12,
        slot: null,
        specialization: primarySpec,
      };

      specializationRepository.findOne.mockResolvedValue(primarySpec);
      progressRepository.findOne.mockResolvedValue(existing);
      progressRepository.save.mockResolvedValue(existing);

      const result = await service.updateSlot(
        'character-1',
        'user-1',
        'spec-a',
        { slot: 'primary' },
      );

      expect(progressRepository.update).toHaveBeenCalledWith(
        {
          characterId: 'character-1',
          slot: 'primary',
          specializationId: Not('spec-a'),
        },
        { slot: null },
      );
      expect(result.slot).toBe('primary');
      expect(progressRepository.save).toHaveBeenCalledWith(existing);
    });

    it('should clear the slot without touching other rows', async () => {
      const existing = {
        id: 'progress-1',
        characterId: 'character-1',
        specializationId: 'spec-b',
        pointsSpent: 15,
        slot: 'secondary',
        specialization: secondarySpec,
      };

      specializationRepository.findOne.mockResolvedValue(secondarySpec);
      progressRepository.findOne.mockResolvedValue(existing);
      progressRepository.save.mockResolvedValue(existing);

      const result = await service.updateSlot(
        'character-1',
        'user-1',
        'spec-b',
        { slot: null },
      );

      expect(progressRepository.update).not.toHaveBeenCalled();
      expect(result.slot).toBeNull();
    });
  });

  describe('getSummary', () => {
    it('should return zero percentages when no specializations exist', async () => {
      specializationRepository.find.mockResolvedValue([]);
      progressRepository.find.mockResolvedValue([]);

      const result = await service.getSummary('character-1', 'user-1');

      expect(result).toEqual({
        totalPoints: 0,
        maxPossiblePoints: 0,
        overallCompletionPercentage: 0,
        completedSpecializations: 0,
        totalSpecializations: 0,
        primarySpecializationName: null,
        secondarySpecializationName: null,
      });
    });

    it('should total points against each specialization maximum and report the active slots', async () => {
      specializationRepository.find.mockResolvedValue([
        { id: 'spec-1', name: 'Pilot', type: 'primary', maxPoints: 30 },
        {
          id: 'spec-2',
          name: 'Command Officer',
          type: 'primary',
          maxPoints: 30,
        },
        { id: 'spec-3', name: 'Strategist', type: 'secondary', maxPoints: 15 },
      ]);
      progressRepository.find.mockResolvedValue([
        { specializationId: 'spec-1', pointsSpent: 30, slot: 'primary' },
        { specializationId: 'spec-3', pointsSpent: 7, slot: 'secondary' },
      ]);

      const result = await service.getSummary('character-1', 'user-1');

      expect(result).toEqual({
        totalPoints: 37,
        maxPossiblePoints: 75,
        overallCompletionPercentage: 49,
        completedSpecializations: 1,
        totalSpecializations: 3,
        primarySpecializationName: 'Pilot',
        secondarySpecializationName: 'Strategist',
      });
      expect(progressRepository.find).toHaveBeenCalledWith({
        where: { characterId: 'character-1' },
      });
    });
  });
});

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { jest } from '@jest/globals';

import { CharacterOwnershipService } from 'src/sto/character/character-ownership.service';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';

import { CharacterReputationService } from './character-reputation.service';
import { UpdateCharacterReputationProgressDto } from './dto/update-character-reputation-progress.dto';
import { CharacterReputationProgressEntity } from './entities/character-reputation-progress.entity';
import { CharacterReputationEntity } from './entities/character-reputation.entity';

describe('CharacterReputationService', () => {
  let service: CharacterReputationService;

  let reputationRepository: any;
  let progressRepository: any;
  let characterRepository: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CharacterReputationService,
        CharacterOwnershipService,
        {
          provide: getRepositoryToken(CharacterReputationEntity),
          useValue: {
            find: jest.fn<(...args: any[]) => Promise<any>>(),
            findOne: jest.fn<(...args: any[]) => Promise<any>>(),
          },
        },
        {
          provide: getRepositoryToken(CharacterReputationProgressEntity),
          useValue: {
            find: jest.fn<(...args: any[]) => Promise<any>>(),
            findOne: jest.fn<(...args: any[]) => Promise<any>>(),
            create: jest.fn<(...args: any[]) => any>(),
            save: jest.fn<(...args: any[]) => Promise<any>>(),
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

    service = module.get<CharacterReputationService>(
      CharacterReputationService,
    );
    reputationRepository = module.get(
      getRepositoryToken(CharacterReputationEntity),
    );
    progressRepository = module.get(
      getRepositoryToken(CharacterReputationProgressEntity),
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

  describe('getReputations', () => {
    it('should query all reputations ordered by sortOrder then name', async () => {
      reputationRepository.find.mockResolvedValue([{ id: 'rep-1' }]);

      const result = await service.getReputations();

      expect(result).toEqual([{ id: 'rep-1' }]);
      expect(reputationRepository.find).toHaveBeenCalledWith({
        order: { sortOrder: 'ASC', name: 'ASC' },
      });
    });
  });

  describe('getProgress', () => {
    const reputations = [
      { id: 'rep-a', name: 'Task Force Omega' },
      { id: 'rep-b', name: 'New Romulus' },
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

    it('should return existing and synthetic entries for all reputations', async () => {
      reputationRepository.find.mockResolvedValue(reputations);
      progressRepository.find.mockResolvedValue([
        {
          id: 'progress-1',
          characterId: 'character-1',
          reputationId: 'rep-b',
          reputation: { id: 'rep-b', name: 'New Romulus' },
          currentTier: 4,
        },
      ]);

      const result = await service.getProgress('character-1', 'user-1');

      expect(result).toHaveLength(2);
      expect(
        result.find((item: any) => item.reputationId === 'rep-a'),
      ).toMatchObject({
        id: '',
        characterId: 'character-1',
        reputationId: 'rep-a',
        currentTier: 0,
      });
      expect(
        result.find((item: any) => item.reputationId === 'rep-b'),
      ).toMatchObject({
        id: 'progress-1',
        currentTier: 4,
      });
      expect(progressRepository.find).toHaveBeenCalledWith({
        where: { characterId: 'character-1' },
        relations: { reputation: true },
      });
    });
  });

  describe('updateProgress', () => {
    const dto: UpdateCharacterReputationProgressDto = { currentTier: 5 };

    it('should throw NotFoundException when reputation does not exist', async () => {
      reputationRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateProgress('character-1', 'user-1', 'missing-rep', dto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should create and save a new progress record when one does not exist', async () => {
      const reputation = {
        id: 'rep-1',
        name: 'Task Force Omega',
      };
      const created = {
        id: 'progress-1',
        characterId: 'character-1',
        reputationId: 'rep-1',
        currentTier: dto.currentTier,
      };

      reputationRepository.findOne.mockResolvedValue(reputation);
      progressRepository.findOne.mockResolvedValue(null);
      progressRepository.create.mockReturnValue(created);
      progressRepository.save.mockResolvedValue(created);

      const result = await service.updateProgress(
        'character-1',
        'user-1',
        'rep-1',
        dto,
      );

      expect(progressRepository.create).toHaveBeenCalledWith({
        characterId: 'character-1',
        reputationId: 'rep-1',
        currentTier: 5,
      });
      expect(progressRepository.save).toHaveBeenCalledWith(created);
      expect(result.reputation).toEqual(reputation);
    });

    it('should update and save an existing progress record', async () => {
      const reputation = {
        id: 'rep-2',
        name: 'New Romulus',
      };
      const existing = {
        id: 'progress-existing',
        characterId: 'character-1',
        reputationId: 'rep-2',
        currentTier: 1,
        reputation,
      };

      reputationRepository.findOne.mockResolvedValue(reputation);
      progressRepository.findOne.mockResolvedValue(existing);
      progressRepository.save.mockResolvedValue(existing);

      const result = await service.updateProgress(
        'character-1',
        'user-1',
        'rep-2',
        { currentTier: 5 },
      );

      expect(progressRepository.create).not.toHaveBeenCalled();
      expect(existing.currentTier).toBe(5);
      expect(progressRepository.save).toHaveBeenCalledWith(existing);
      expect(result.reputation).toEqual(reputation);
    });
  });

  describe('getSummary', () => {
    it('should return zero percentages when no reputations exist', async () => {
      reputationRepository.find.mockResolvedValue([]);
      progressRepository.find.mockResolvedValue([]);

      const result = await service.getSummary('character-1', 'user-1');

      expect(result).toEqual({
        totalTiers: 0,
        maxPossibleTiers: 0,
        overallCompletionPercentage: 0,
        completedReputations: 0,
        totalReputations: 0,
      });
    });

    it('should calculate totals, percentages, and completed reputations', async () => {
      reputationRepository.find.mockResolvedValue([
        { id: 'rep-1' },
        { id: 'rep-2' },
        { id: 'rep-3' },
      ]);
      progressRepository.find.mockResolvedValue([
        { reputationId: 'rep-1', currentTier: 6 },
        { reputationId: 'rep-2', currentTier: 3 },
      ]);

      const result = await service.getSummary('character-1', 'user-1');

      expect(result).toEqual({
        totalTiers: 9,
        maxPossibleTiers: 18,
        overallCompletionPercentage: 50,
        completedReputations: 1,
        totalReputations: 3,
      });
      expect(progressRepository.find).toHaveBeenCalledWith({
        where: { characterId: 'character-1' },
      });
    });
  });
});

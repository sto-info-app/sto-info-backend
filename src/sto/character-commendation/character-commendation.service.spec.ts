import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { jest } from '@jest/globals';
import { IsNull } from 'typeorm';

import { CharacterOwnershipService } from 'src/sto/character/character-ownership.service';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';

import { CharacterCommendationService } from './character-commendation.service';
import { UpdateCharacterCommendationProgressDto } from './dto/update-character-commendation-progress.dto';
import { CharacterCommendationProgressEntity } from './entities/character-commendation-progress.entity';
import { CharacterCommendationEntity } from './entities/character-commendation.entity';

describe('CharacterCommendationService', () => {
  let service: CharacterCommendationService;

  let commendationRepository: any;
  let progressRepository: any;
  let characterRepository: any;

  const order = { sortOrder: 'ASC', name: 'ASC' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CharacterCommendationService,
        CharacterOwnershipService,
        {
          provide: getRepositoryToken(CharacterCommendationEntity),
          useValue: {
            find: jest.fn<(...args: any[]) => Promise<any>>(),
            findOne: jest.fn<(...args: any[]) => Promise<any>>(),
          },
        },
        {
          provide: getRepositoryToken(CharacterCommendationProgressEntity),
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

    service = module.get<CharacterCommendationService>(
      CharacterCommendationService,
    );
    commendationRepository = module.get(
      getRepositoryToken(CharacterCommendationEntity),
    );
    progressRepository = module.get(
      getRepositoryToken(CharacterCommendationProgressEntity),
    );
    characterRepository = module.get(getRepositoryToken(CharacterEntity));

    characterRepository.findOne.mockResolvedValue({
      id: 'character-1',
      account: { id: 'account-1', userId: 'user-1' },
      generalFaction: { id: 'faction-1', name: 'Federation' },
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getCommendations', () => {
    it('should query the whole catalogue ordered by sortOrder then name', async () => {
      commendationRepository.find.mockResolvedValue([{ id: 'commendation-1' }]);

      const result = await service.getCommendations();

      expect(result).toEqual([{ id: 'commendation-1' }]);
      expect(commendationRepository.find).toHaveBeenCalledWith({ order });
    });
  });

  describe('getCommendationsForFaction', () => {
    it('should return only unrestricted categories when no allegiance is given', async () => {
      commendationRepository.find.mockResolvedValue([{ id: 'science' }]);

      const result = await service.getCommendationsForFaction();

      expect(result).toEqual([{ id: 'science' }]);
      expect(commendationRepository.find).toHaveBeenCalledWith({
        where: { factionRestriction: IsNull() },
        order,
      });
    });

    it('should return only unrestricted categories for an undecided allegiance', async () => {
      commendationRepository.find.mockResolvedValue([{ id: 'science' }]);

      await service.getCommendationsForFaction('Undecided');

      expect(commendationRepository.find).toHaveBeenCalledWith({
        where: { factionRestriction: IsNull() },
        order,
      });
    });

    it('should include the Federation category for a Federation captain', async () => {
      commendationRepository.find.mockResolvedValue([
        { id: 'diplomacy' },
        { id: 'science' },
      ]);

      await service.getCommendationsForFaction('Federation');

      expect(commendationRepository.find).toHaveBeenCalledWith({
        where: [
          { factionRestriction: IsNull() },
          { factionRestriction: 'Federation' },
        ],
        order,
      });
    });

    it('should include the Klingon category for a Klingon captain', async () => {
      commendationRepository.find.mockResolvedValue([
        { id: 'marauding' },
        { id: 'science' },
      ]);

      await service.getCommendationsForFaction('Klingon');

      expect(commendationRepository.find).toHaveBeenCalledWith({
        where: [
          { factionRestriction: IsNull() },
          { factionRestriction: 'Klingon' },
        ],
        order,
      });
    });
  });

  describe('getProgress', () => {
    const commendations = [
      { id: 'diplomacy', name: 'Diplomacy', factionRestriction: 'Federation' },
      { id: 'science', name: 'Science', factionRestriction: null },
    ];

    it('should throw NotFoundException when the character does not exist', async () => {
      characterRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getProgress('missing-character', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when the character belongs to another user', async () => {
      characterRepository.findOne.mockResolvedValue({
        id: 'character-1',
        account: { id: 'account-1', userId: 'other-user' },
      });

      await expect(
        service.getProgress('character-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should return existing and synthetic entries for the applicable categories', async () => {
      commendationRepository.find.mockResolvedValue(commendations);
      progressRepository.find.mockResolvedValue([
        {
          id: 'progress-1',
          characterId: 'character-1',
          commendationId: 'science',
          commendation: commendations[1],
          currentRank: 3,
        },
      ]);

      const result = await service.getProgress('character-1', 'user-1');

      expect(result).toHaveLength(2);
      expect(
        result.find((item: any) => item.commendationId === 'diplomacy'),
      ).toMatchObject({
        id: '',
        characterId: 'character-1',
        commendationId: 'diplomacy',
        commendation: commendations[0],
        currentRank: 0,
      });
      expect(
        result.find((item: any) => item.commendationId === 'science'),
      ).toMatchObject({ id: 'progress-1', currentRank: 3 });
      expect(commendationRepository.find).toHaveBeenCalledWith({
        where: [
          { factionRestriction: IsNull() },
          { factionRestriction: 'Federation' },
        ],
        order,
      });
      expect(progressRepository.find).toHaveBeenCalledWith({
        where: { characterId: 'character-1' },
        relations: { commendation: true },
      });
    });

    it('should fall back to the shared categories when no allegiance is recorded', async () => {
      characterRepository.findOne.mockResolvedValue({
        id: 'character-1',
        account: { id: 'account-1', userId: 'user-1' },
      });
      commendationRepository.find.mockResolvedValue([commendations[1]]);
      progressRepository.find.mockResolvedValue([]);

      const result = await service.getProgress('character-1', 'user-1');

      expect(result).toHaveLength(1);
      expect(commendationRepository.find).toHaveBeenCalledWith({
        where: { factionRestriction: IsNull() },
        order,
      });
    });
  });

  describe('updateProgress', () => {
    const dto: UpdateCharacterCommendationProgressDto = { currentRank: 3 };

    it('should throw NotFoundException when the commendation does not exist', async () => {
      commendationRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateProgress('character-1', 'user-1', 'missing', dto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should create and save a new progress record when one does not exist', async () => {
      const commendation = { id: 'science', name: 'Science' };
      const created = {
        id: 'progress-1',
        characterId: 'character-1',
        commendationId: 'science',
        currentRank: 3,
      };

      commendationRepository.findOne.mockResolvedValue(commendation);
      progressRepository.findOne.mockResolvedValue(null);
      progressRepository.create.mockReturnValue(created);
      progressRepository.save.mockResolvedValue(created);

      const result = await service.updateProgress(
        'character-1',
        'user-1',
        'science',
        dto,
      );

      expect(progressRepository.create).toHaveBeenCalledWith({
        characterId: 'character-1',
        commendationId: 'science',
        currentRank: 3,
      });
      expect(progressRepository.save).toHaveBeenCalledWith(created);
      expect(result.currentRank).toBe(3);
      expect(result.commendation).toEqual(commendation);
    });

    it('should update and save an existing progress record', async () => {
      const commendation = { id: 'trade', name: 'Trade' };
      const existing = {
        id: 'progress-2',
        characterId: 'character-1',
        commendationId: 'trade',
        currentRank: 1,
      };

      commendationRepository.findOne.mockResolvedValue(commendation);
      progressRepository.findOne.mockResolvedValue(existing);
      progressRepository.save.mockResolvedValue(existing);

      const result = await service.updateProgress(
        'character-1',
        'user-1',
        'trade',
        { currentRank: 4 },
      );

      expect(progressRepository.create).not.toHaveBeenCalled();
      expect(progressRepository.save).toHaveBeenCalledWith(existing);
      expect(result.currentRank).toBe(4);
      expect(result.commendation).toEqual(commendation);
    });
  });

  describe('getSummary', () => {
    it('should total the ranks earned across the applicable categories', async () => {
      commendationRepository.find.mockResolvedValue([
        { id: 'diplomacy' },
        { id: 'science' },
        { id: 'trade' },
      ]);
      progressRepository.find.mockResolvedValue([
        { commendationId: 'diplomacy', currentRank: 4 },
        { commendationId: 'science', currentRank: 2 },
      ]);

      const result = await service.getSummary('character-1', 'user-1');

      expect(result).toEqual({
        totalRanks: 6,
        maxPossibleRanks: 12,
        overallCompletionPercentage: 50,
        completedCommendations: 1,
        totalCommendations: 3,
      });
      expect(progressRepository.find).toHaveBeenCalledWith({
        where: { characterId: 'character-1' },
      });
    });

    it('should report zero completion when the catalogue is empty', async () => {
      commendationRepository.find.mockResolvedValue([]);
      progressRepository.find.mockResolvedValue([]);

      const result = await service.getSummary('character-1', 'user-1');

      expect(result).toEqual({
        totalRanks: 0,
        maxPossibleRanks: 0,
        overallCompletionPercentage: 0,
        completedCommendations: 0,
        totalCommendations: 0,
      });
    });

    it('should throw ForbiddenException when the character belongs to another user', async () => {
      characterRepository.findOne.mockResolvedValue({
        id: 'character-1',
        account: { id: 'account-1', userId: 'other-user' },
      });

      await expect(service.getSummary('character-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});

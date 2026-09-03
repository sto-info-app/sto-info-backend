import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { jest } from '@jest/globals';

import { CharacterOwnershipService } from 'src/sto/character/character-ownership.service';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';

import { CharacterAdmiraltyService } from './character-admiralty.service';
import { UpdateCharacterAdmiraltyProgressDto } from './dto/update-character-admiralty-progress.dto';
import { CharacterAdmiraltyCampaignEntity } from './entities/character-admiralty-campaign.entity';
import { CharacterAdmiraltyProgressEntity } from './entities/character-admiralty-progress.entity';

describe('CharacterAdmiraltyService', () => {
  let service: CharacterAdmiraltyService;

  let campaignRepository: any;
  let progressRepository: any;
  let characterRepository: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CharacterAdmiraltyService,
        CharacterOwnershipService,
        {
          provide: getRepositoryToken(CharacterAdmiraltyCampaignEntity),
          useValue: {
            find: jest.fn<(...args: any[]) => Promise<any>>(),
            findOne: jest.fn<(...args: any[]) => Promise<any>>(),
          },
        },
        {
          provide: getRepositoryToken(CharacterAdmiraltyProgressEntity),
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

    service = module.get<CharacterAdmiraltyService>(CharacterAdmiraltyService);
    campaignRepository = module.get(
      getRepositoryToken(CharacterAdmiraltyCampaignEntity),
    );
    progressRepository = module.get(
      getRepositoryToken(CharacterAdmiraltyProgressEntity),
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

  describe('getCampaigns', () => {
    it('should query all campaigns ordered by sortOrder then name', async () => {
      campaignRepository.find.mockResolvedValue([{ id: 'campaign-1' }]);

      const result = await service.getCampaigns();

      expect(result).toEqual([{ id: 'campaign-1' }]);
      expect(campaignRepository.find).toHaveBeenCalledWith({
        order: { sortOrder: 'ASC', name: 'ASC' },
      });
    });
  });

  describe('getProgress', () => {
    const campaigns = [
      { id: 'campaign-a', name: 'United Federation of Planets' },
      { id: 'campaign-b', name: 'Klingon Empire' },
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

    it('should return existing and synthetic entries for all campaigns', async () => {
      campaignRepository.find.mockResolvedValue(campaigns);
      progressRepository.find.mockResolvedValue([
        {
          id: 'progress-1',
          characterId: 'character-1',
          campaignId: 'campaign-b',
          campaign: campaigns[1],
          currentTier: 6,
          tourOfDutyStep: 3,
        },
      ]);

      const result = await service.getProgress('character-1', 'user-1');

      expect(result).toHaveLength(2);
      expect(
        result.find((item: any) => item.campaignId === 'campaign-a'),
      ).toMatchObject({
        id: '',
        characterId: 'character-1',
        campaignId: 'campaign-a',
        campaign: campaigns[0],
        currentTier: 0,
        tourOfDutyStep: 0,
      });
      expect(
        result.find((item: any) => item.campaignId === 'campaign-b'),
      ).toMatchObject({
        id: 'progress-1',
        currentTier: 6,
        tourOfDutyStep: 3,
      });
      expect(progressRepository.find).toHaveBeenCalledWith({
        where: { characterId: 'character-1' },
        relations: { campaign: true },
      });
    });
  });

  describe('updateProgress', () => {
    const dto: UpdateCharacterAdmiraltyProgressDto = {
      currentTier: 8,
      tourOfDutyStep: 4,
    };

    it('should throw NotFoundException when campaign does not exist', async () => {
      campaignRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateProgress(
          'character-1',
          'user-1',
          'missing-campaign',
          dto,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should create and save a new progress record when one does not exist', async () => {
      const campaign = {
        id: 'campaign-1',
        name: 'United Federation of Planets',
      };
      const created = {
        id: 'progress-1',
        characterId: 'character-1',
        campaignId: 'campaign-1',
        currentTier: 0,
        tourOfDutyStep: 0,
      };

      campaignRepository.findOne.mockResolvedValue(campaign);
      progressRepository.findOne.mockResolvedValue(null);
      progressRepository.create.mockReturnValue(created);
      progressRepository.save.mockResolvedValue(created);

      const result = await service.updateProgress(
        'character-1',
        'user-1',
        'campaign-1',
        dto,
      );

      expect(progressRepository.create).toHaveBeenCalledWith({
        characterId: 'character-1',
        campaignId: 'campaign-1',
      });
      expect(progressRepository.save).toHaveBeenCalledWith(created);
      expect(result.currentTier).toBe(8);
      expect(result.tourOfDutyStep).toBe(4);
      expect(result.campaign).toEqual(campaign);
    });

    it('should update and save an existing progress record', async () => {
      const campaign = { id: 'campaign-2', name: 'Klingon Empire' };
      const existing = {
        id: 'progress-existing',
        characterId: 'character-1',
        campaignId: 'campaign-2',
        currentTier: 2,
        tourOfDutyStep: 1,
        campaign,
      };

      campaignRepository.findOne.mockResolvedValue(campaign);
      progressRepository.findOne.mockResolvedValue(existing);
      progressRepository.save.mockResolvedValue(existing);

      const result = await service.updateProgress(
        'character-1',
        'user-1',
        'campaign-2',
        dto,
      );

      expect(progressRepository.create).not.toHaveBeenCalled();
      expect(existing.currentTier).toBe(8);
      expect(existing.tourOfDutyStep).toBe(4);
      expect(progressRepository.save).toHaveBeenCalledWith(existing);
      expect(result.campaign).toEqual(campaign);
    });
  });

  describe('getSummary', () => {
    it('should return zero percentages when no campaigns exist', async () => {
      campaignRepository.find.mockResolvedValue([]);
      progressRepository.find.mockResolvedValue([]);

      const result = await service.getSummary('character-1', 'user-1');

      expect(result).toEqual({
        totalTiers: 0,
        maxPossibleTiers: 0,
        completedCampaigns: 0,
        totalCampaigns: 0,
        totalTourSteps: 0,
        maxPossibleTourSteps: 0,
        overallCompletionPercentage: 0,
      });
    });

    it('should total tiers and tour steps and count completed campaigns', async () => {
      campaignRepository.find.mockResolvedValue([
        { id: 'campaign-1' },
        { id: 'campaign-2' },
        { id: 'campaign-3' },
      ]);
      progressRepository.find.mockResolvedValue([
        { campaignId: 'campaign-1', currentTier: 10, tourOfDutyStep: 7 },
        { campaignId: 'campaign-2', currentTier: 5, tourOfDutyStep: 2 },
      ]);

      const result = await service.getSummary('character-1', 'user-1');

      expect(result).toEqual({
        totalTiers: 15,
        maxPossibleTiers: 30,
        completedCampaigns: 1,
        totalCampaigns: 3,
        totalTourSteps: 9,
        maxPossibleTourSteps: 30,
        overallCompletionPercentage: 50,
      });
      expect(progressRepository.find).toHaveBeenCalledWith({
        where: { characterId: 'character-1' },
      });
    });

    it('should round the overall percentage to the nearest whole number', async () => {
      campaignRepository.find.mockResolvedValue([
        { id: 'campaign-1' },
        { id: 'campaign-2' },
        { id: 'campaign-3' },
      ]);
      progressRepository.find.mockResolvedValue([
        { campaignId: 'campaign-1', currentTier: 4, tourOfDutyStep: 0 },
      ]);

      const result = await service.getSummary('character-1', 'user-1');

      // 4 of 30 tiers is 13.33%.
      expect(result.overallCompletionPercentage).toBe(13);
    });
  });
});

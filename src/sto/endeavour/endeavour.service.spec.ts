import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { jest } from '@jest/globals';

import { AccountEntity } from 'src/sto/account/entities/account.entity';

import { EndeavourProgressQueryDto } from './dto/endeavour-progress-query.dto';
import { UpdateEndeavourProgressDto } from './dto/update-endeavour-progress.dto';
import { EndeavourService } from './endeavour.service';
import { AccountEndeavourProgressEntity } from './entities/account-endeavour-progress.entity';
import { EndeavourPerkEntity } from './entities/endeavour-perk.entity';

describe('EndeavourService', () => {
  let service: EndeavourService;

  let perkRepository: any;
  let progressRepository: any;
  let accountRepository: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EndeavourService,
        {
          provide: getRepositoryToken(EndeavourPerkEntity),
          useValue: {
            find: jest.fn<(...args: any[]) => Promise<any>>(),
            findOne: jest.fn<(...args: any[]) => Promise<any>>(),
          },
        },
        {
          provide: getRepositoryToken(AccountEndeavourProgressEntity),
          useValue: {
            find: jest.fn<(...args: any[]) => Promise<any>>(),
            findOne: jest.fn<(...args: any[]) => Promise<any>>(),
            create: jest.fn<(...args: any[]) => any>(),
            save: jest.fn<(...args: any[]) => Promise<any>>(),
          },
        },
        {
          provide: getRepositoryToken(AccountEntity),
          useValue: {
            findOne: jest.fn<(...args: any[]) => Promise<any>>(),
          },
        },
      ],
    }).compile();

    service = module.get<EndeavourService>(EndeavourService);
    perkRepository = module.get(getRepositoryToken(EndeavourPerkEntity));
    progressRepository = module.get(
      getRepositoryToken(AccountEndeavourProgressEntity),
    );
    accountRepository = module.get(getRepositoryToken(AccountEntity));

    accountRepository.findOne.mockResolvedValue({
      id: 'account-1',
      userId: 'user-1',
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getPerks', () => {
    it('should query all perks when category is omitted', async () => {
      perkRepository.find.mockResolvedValue([{ id: 'perk-1' }]);

      const result = await service.getPerks();

      expect(result).toEqual([{ id: 'perk-1' }]);
      expect(perkRepository.find).toHaveBeenCalledWith({
        where: {},
        order: { sortOrder: 'ASC', name: 'ASC' },
      });
    });

    it('should query perks by category when provided', async () => {
      perkRepository.find.mockResolvedValue([{ id: 'perk-2' }]);

      const result = await service.getPerks('Space');

      expect(result).toEqual([{ id: 'perk-2' }]);
      expect(perkRepository.find).toHaveBeenCalledWith({
        where: { category: 'Space' },
        order: { sortOrder: 'ASC', name: 'ASC' },
      });
    });
  });

  describe('getProgress', () => {
    const perks = [
      { id: 'perk-a', name: 'Alpha' },
      { id: 'perk-b', name: 'Beta' },
      { id: 'perk-c', name: 'Gamma' },
    ];

    it('should throw NotFoundException when account does not exist', async () => {
      accountRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getProgress('missing-account', 'user-1', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when account belongs to another user', async () => {
      accountRepository.findOne.mockResolvedValue({
        id: 'account-1',
        userId: 'other-user',
      });

      await expect(
        service.getProgress('account-1', 'user-1', {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should return existing and synthetic entries sorted by name asc by default', async () => {
      perkRepository.find.mockResolvedValue(perks);
      progressRepository.find.mockResolvedValue([
        {
          id: 'progress-1',
          accountId: 'account-1',
          endeavourPerkId: 'perk-b',
          endeavourPerk: { id: 'perk-b', name: 'Beta' },
          currentNodes: 7,
        },
      ]);

      const result = await service.getProgress(
        'account-1',
        'user-1',
        {} as EndeavourProgressQueryDto,
      );

      expect(result.map((item: any) => item.endeavourPerk.name)).toEqual([
        'Alpha',
        'Beta',
        'Gamma',
      ]);
      expect(
        result.find((item: any) => item.endeavourPerkId === 'perk-a'),
      ).toMatchObject({
        id: '',
        accountId: 'account-1',
        endeavourPerkId: 'perk-a',
        currentNodes: 0,
      });
      expect(
        result.find((item: any) => item.endeavourPerkId === 'perk-b'),
      ).toMatchObject({
        id: 'progress-1',
        currentNodes: 7,
      });
    });

    it('should sort by nodes and use name tie-breaker', async () => {
      perkRepository.find.mockResolvedValue(perks);
      progressRepository.find.mockResolvedValue([
        {
          id: 'progress-b',
          accountId: 'account-1',
          endeavourPerkId: 'perk-b',
          endeavourPerk: { id: 'perk-b', name: 'Beta' },
          currentNodes: 2,
        },
        {
          id: 'progress-c',
          accountId: 'account-1',
          endeavourPerkId: 'perk-c',
          endeavourPerk: { id: 'perk-c', name: 'Gamma' },
          currentNodes: 2,
        },
      ]);

      const query: EndeavourProgressQueryDto = {
        sortBy: 'nodes',
        sortOrder: 'DESC',
      };

      const result = await service.getProgress('account-1', 'user-1', query);

      expect(result.map((item: any) => item.endeavourPerk.name)).toEqual([
        'Beta',
        'Gamma',
        'Alpha',
      ]);
      expect(perkRepository.find).toHaveBeenCalledWith({
        where: {},
        order: { sortOrder: 'ASC', name: 'ASC' },
      });
      expect(progressRepository.find).toHaveBeenCalledWith({
        where: { accountId: 'account-1' },
        relations: { endeavourPerk: true },
      });
    });

    it('should pass category filter through to getPerks', async () => {
      perkRepository.find.mockResolvedValue(perks);
      progressRepository.find.mockResolvedValue([]);

      await service.getProgress('account-1', 'user-1', {
        category: 'Ground',
      });

      expect(perkRepository.find).toHaveBeenCalledWith({
        where: { category: 'Ground' },
        order: { sortOrder: 'ASC', name: 'ASC' },
      });
    });
  });

  describe('updateProgress', () => {
    const dto: UpdateEndeavourProgressDto = { currentNodes: 11 };

    it('should throw NotFoundException when perk does not exist', async () => {
      perkRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateProgress('account-1', 'user-1', 'missing-perk', dto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should create and save a new progress record when one does not exist', async () => {
      const perk = {
        id: 'perk-1',
        name: 'Alpha',
      };
      const created = {
        id: 'progress-1',
        accountId: 'account-1',
        endeavourPerkId: 'perk-1',
        currentNodes: dto.currentNodes,
      };

      perkRepository.findOne.mockResolvedValue(perk);
      progressRepository.findOne.mockResolvedValue(null);
      progressRepository.create.mockReturnValue(created);
      progressRepository.save.mockResolvedValue(created);

      const result = await service.updateProgress(
        'account-1',
        'user-1',
        'perk-1',
        dto,
      );

      expect(progressRepository.create).toHaveBeenCalledWith({
        accountId: 'account-1',
        endeavourPerkId: 'perk-1',
        currentNodes: 11,
      });
      expect(progressRepository.save).toHaveBeenCalledWith(created);
      expect(result.endeavourPerk).toEqual(perk);
    });

    it('should update and save an existing progress record', async () => {
      const perk = {
        id: 'perk-2',
        name: 'Beta',
      };
      const existing = {
        id: 'progress-existing',
        accountId: 'account-1',
        endeavourPerkId: 'perk-2',
        currentNodes: 1,
        endeavourPerk: perk,
      };

      perkRepository.findOne.mockResolvedValue(perk);
      progressRepository.findOne.mockResolvedValue(existing);
      progressRepository.save.mockResolvedValue(existing);

      const result = await service.updateProgress(
        'account-1',
        'user-1',
        'perk-2',
        dto,
      );

      expect(progressRepository.create).not.toHaveBeenCalled();
      expect(existing.currentNodes).toBe(11);
      expect(progressRepository.save).toHaveBeenCalledWith(existing);
      expect(result.endeavourPerk).toEqual(perk);
    });
  });

  describe('getSummary', () => {
    it('should return zero percentages when no perks exist', async () => {
      perkRepository.find.mockResolvedValue([]);
      progressRepository.find.mockResolvedValue([]);

      const result = await service.getSummary('account-1', 'user-1');

      expect(result).toEqual({
        totalNodes: 0,
        maxPossibleNodes: 0,
        overallCompletionPercentage: 0,
        maxedPerks: 0,
        totalPerks: 0,
        spaceNodes: 0,
        spaceMaxNodes: 0,
        spaceCompletionPercentage: 0,
        groundNodes: 0,
        groundMaxNodes: 0,
        groundCompletionPercentage: 0,
      });
    });

    it('should calculate totals, percentages, and maxed perks', async () => {
      perkRepository.find.mockResolvedValue([
        {
          id: 'space-1',
          category: 'Space',
          maxNodes: 20,
        },
        {
          id: 'ground-1',
          category: 'Ground',
          maxNodes: 10,
        },
        {
          id: 'space-2',
          category: 'Space',
          maxNodes: 5,
        },
      ]);
      progressRepository.find.mockResolvedValue([
        { endeavourPerkId: 'space-1', currentNodes: 20 },
        { endeavourPerkId: 'ground-1', currentNodes: 5 },
      ]);

      const result = await service.getSummary('account-1', 'user-1');

      expect(result).toEqual({
        totalNodes: 25,
        maxPossibleNodes: 35,
        overallCompletionPercentage: 71,
        maxedPerks: 1,
        totalPerks: 3,
        spaceNodes: 20,
        spaceMaxNodes: 25,
        spaceCompletionPercentage: 80,
        groundNodes: 5,
        groundMaxNodes: 10,
        groundCompletionPercentage: 50,
      });
      expect(progressRepository.find).toHaveBeenCalledWith({
        where: { accountId: 'account-1' },
      });
    });
  });
});

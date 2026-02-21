import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformLauncherEntity } from './entities/platform-launcher.entity';
import { PlatformLauncherService } from './platform-launcher.service';

describe('PlatformLauncherService', () => {
  let service: PlatformLauncherService;
  let repository: Repository<PlatformLauncherEntity>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformLauncherService,
        {
          provide: getRepositoryToken(PlatformLauncherEntity),
          useValue: {
            save: jest.fn(),
            findOne: jest.fn(),
            find: jest.fn(),
            remove: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PlatformLauncherService>(PlatformLauncherService);
    repository = module.get<Repository<PlatformLauncherEntity>>(
      getRepositoryToken(PlatformLauncherEntity),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('addPlatformLauncherRelation', () => {
    it('should create and save a platform-launcher relation', async () => {
      const relation = {
        id: '1',
        platformId: 'platform-1',
        launcherId: 'launcher-1',
      };
      (repository.save as jest.Mock).mockResolvedValue(relation);

      const result = await service.addPlatformLauncherRelation(
        'platform-1',
        'launcher-1',
      );

      expect(result.platformId).toBe('platform-1');
      expect(result.launcherId).toBe('launcher-1');
      expect(repository.save).toHaveBeenCalled();
    });

    it('should throw InternalServerErrorException on save failure', async () => {
      (repository.save as jest.Mock).mockRejectedValue(new Error('DB Error'));

      await expect(
        service.addPlatformLauncherRelation('platform-1', 'launcher-1'),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should throw BadRequestException if platformId is missing', async () => {
      await expect(
        service.addPlatformLauncherRelation('', 'launcher-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if launcherId is missing', async () => {
      await expect(
        service.addPlatformLauncherRelation('platform-1', ''),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('removePlatformLauncherRelation', () => {
    it('should remove a platform-launcher relation', async () => {
      const relation = {
        id: '1',
        platformId: 'platform-1',
        launcherId: 'launcher-1',
      };
      (repository.findOne as jest.Mock).mockResolvedValue(relation);
      (repository.remove as jest.Mock).mockResolvedValue(relation);

      await service.removePlatformLauncherRelation('platform-1', 'launcher-1');

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { platformId: 'platform-1', launcherId: 'launcher-1' },
      });
      expect(repository.remove).toHaveBeenCalledWith(relation);
    });

    it('should throw NotFoundException if relation not found', async () => {
      (repository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.removePlatformLauncherRelation('platform-1', 'launcher-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw InternalServerErrorException on remove failure', async () => {
      const relation = { id: '1' };
      (repository.findOne as jest.Mock).mockResolvedValue(relation);
      (repository.remove as jest.Mock).mockRejectedValue(new Error('DB Error'));

      await expect(
        service.removePlatformLauncherRelation('platform-1', 'launcher-1'),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should throw BadRequestException if platformId is missing', async () => {
      await expect(
        service.removePlatformLauncherRelation('', 'launcher-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if launcherId is missing', async () => {
      await expect(
        service.removePlatformLauncherRelation('platform-1', ''),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll', () => {
    it('should return all platform-launcher relations with relations loaded', async () => {
      const relations = [
        {
          id: '1',
          platformId: 'p1',
          launcherId: 'l1',
          platform: { name: 'Windows' },
          launcher: { name: 'Steam' },
        },
      ];
      (repository.find as jest.Mock).mockResolvedValue(relations);

      const result = await service.findAll();

      expect(result).toEqual(relations);
      expect(repository.find).toHaveBeenCalledWith({
        relations: ['platform', 'launcher'],
      });
    });
  });

  describe('findAllLaunchersForPlatform', () => {
    it('should return all launchers for a specific platform', async () => {
      const launchers = [
        { id: '1', platformId: 'platform-1', launcherId: 'launcher-1' },
        { id: '2', platformId: 'platform-1', launcherId: 'launcher-2' },
      ];
      (repository.find as jest.Mock).mockResolvedValue(launchers);

      const result = await service.findAllLaunchersForPlatform('platform-1');

      expect(result).toEqual(launchers);
      expect(repository.find).toHaveBeenCalledWith({
        where: { platformId: 'platform-1' },
      });
    });

    it('should throw BadRequestException if platformId is missing', async () => {
      await expect(service.findAllLaunchersForPlatform('')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('findOne', () => {
    it('should return a specific platform-launcher relation', async () => {
      const relation = {
        id: '1',
        platformId: 'platform-1',
        launcherId: 'launcher-1',
      };
      (repository.findOne as jest.Mock).mockResolvedValue(relation);

      const result = await service.findOne('platform-1', 'launcher-1');

      expect(result).toEqual(relation);
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { platformId: 'platform-1', launcherId: 'launcher-1' },
      });
    });

    it('should throw NotFoundException if relation not found', async () => {
      (repository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.findOne('platform-1', 'launcher-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if platformId is missing', async () => {
      await expect(service.findOne('', 'launcher-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if launcherId is missing', async () => {
      await expect(service.findOne('platform-1', '')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});

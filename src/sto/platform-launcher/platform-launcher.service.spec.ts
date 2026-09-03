import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { jest } from '@jest/globals';
import { Repository } from 'typeorm';

import { PlatformLauncherEntity } from './entities/platform-launcher.entity';
import { PlatformLauncherService } from './platform-launcher.service';

describe('PlatformLauncherService', () => {
  let service: PlatformLauncherService;
  let repository: Repository<PlatformLauncherEntity>;

  beforeAll(() => {
    process.env.CLOUDFLARE_CDN_ROOT_URL = 'https://cdn.startrekonline.info';
    process.env.CLOUDFLARE_IMAGES_HASH = 'jQ0uSdJ3ty-KasNpXGxyuA';
  });

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
      (
        repository.save as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(relation);

      const result = await service.addPlatformLauncherRelation(
        'platform-1',
        'launcher-1',
      );

      expect(result.platformId).toBe('platform-1');
      expect(result.launcherId).toBe('launcher-1');
      expect(repository.save).toHaveBeenCalled();
    });

    it('should throw InternalServerErrorException on save failure', async () => {
      (
        repository.save as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockRejectedValue(new Error('DB Error'));

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
      (
        repository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(relation);
      (
        repository.remove as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(relation);

      await service.removePlatformLauncherRelation('platform-1', 'launcher-1');

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { platformId: 'platform-1', launcherId: 'launcher-1' },
      });
      expect(repository.remove).toHaveBeenCalledWith(relation);
    });

    it('should throw NotFoundException if relation not found', async () => {
      (
        repository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(null);

      await expect(
        service.removePlatformLauncherRelation('platform-1', 'launcher-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw InternalServerErrorException on remove failure', async () => {
      const relation = { id: '1' };
      (
        repository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(relation);
      (
        repository.remove as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockRejectedValue(new Error('DB Error'));

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
      (
        repository.find as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(relations);

      const result = await service.findAll();

      expect(result).toEqual(relations);
      expect(repository.find).toHaveBeenCalledWith({
        relations: { platform: true, launcher: true },
      });
    });

    it('should null invalid background image URLs', async () => {
      const relations = [
        {
          id: '1',
          platformId: 'p1',
          launcherId: 'l1',
          backgroundImageUrl: 'https://example.com/not-cloudflare.jpg',
        },
      ];
      (
        repository.find as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(relations);

      const result = await service.findAll();

      expect(result[0].backgroundImageUrl).toBeNull();
    });
  });

  describe('findAllLaunchersForPlatform', () => {
    it('should return all launchers for a specific platform', async () => {
      const launchers = [
        { id: '1', platformId: 'platform-1', launcherId: 'launcher-1' },
        { id: '2', platformId: 'platform-1', launcherId: 'launcher-2' },
      ];
      (
        repository.find as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(launchers);

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
        backgroundImageUrl:
          'https://cdn.startrekonline.info/cdn-cgi/imagedelivery/jQ0uSdJ3ty-KasNpXGxyuA/8ab52131-6f11-408a-d9df-3c1acaa46d00/public',
      };
      (
        repository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(relation);

      const result = await service.findOne('platform-1', 'launcher-1');

      expect(result).toEqual(relation);
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { platformId: 'platform-1', launcherId: 'launcher-1' },
      });
    });

    it('should null an invalid background image URL', async () => {
      const relation = {
        id: '1',
        platformId: 'platform-1',
        launcherId: 'launcher-1',
        backgroundImageUrl: 'https://example.com/not-cloudflare.jpg',
      };
      (
        repository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(relation);

      const result = await service.findOne('platform-1', 'launcher-1');

      expect(result.backgroundImageUrl).toBeNull();
    });

    it('should throw NotFoundException if relation not found', async () => {
      (
        repository.findOne as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue(null);

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

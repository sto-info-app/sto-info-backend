import { jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { LauncherService } from 'src/sto/launcher/launcher.service';
import { PlatformLauncherService } from 'src/sto/platform-launcher/platform-launcher.service';
import { PlatformService } from 'src/sto/platform/platform.service';
import { AccountSeederService } from './account-seeder.service';

describe('AccountSeederService', () => {
  let service: AccountSeederService;
  let platformService: PlatformService;
  let launcherService: LauncherService;
  let platformLauncherService: PlatformLauncherService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountSeederService,
        {
          provide: PlatformService,
          useValue: {
            findOneByName: jest.fn(),
            create: jest.fn(),
          },
        },
        {
          provide: LauncherService,
          useValue: {
            findOneByName: jest.fn(),
            create: jest.fn(),
          },
        },
        {
          provide: PlatformLauncherService,
          useValue: {
            findOne: jest.fn(),
            addPlatformLauncherRelation: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AccountSeederService>(AccountSeederService);
    platformService = module.get<PlatformService>(PlatformService);
    launcherService = module.get<LauncherService>(LauncherService);
    platformLauncherService = module.get<PlatformLauncherService>(
      PlatformLauncherService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('seed', () => {
    it('should call all seeding methods', async () => {
      const seedPlatformsSpy = jest
        .spyOn(service as any, 'seedPlatforms')
        .mockResolvedValue(undefined);
      const seedLaunchersSpy = jest
        .spyOn(service as any, 'seedLaunchers')
        .mockResolvedValue(undefined);
      const seedPlatformLaunchersSpy = jest
        .spyOn(service as any, 'seedPlatformLaunchers')
        .mockResolvedValue(undefined);

      await service.seed();

      expect(seedPlatformsSpy).toHaveBeenCalled();
      expect(seedLaunchersSpy).toHaveBeenCalled();
      expect(seedPlatformLaunchersSpy).toHaveBeenCalled();

      seedPlatformsSpy.mockRestore();
      seedLaunchersSpy.mockRestore();
      seedPlatformLaunchersSpy.mockRestore();
    });
  });

  describe('seedPlatforms', () => {
    it('should create platforms that do not exist', async () => {
      (
        platformService.findOneByName as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockRejectedValue(new NotFoundException('Platform not found'));
      (
        platformService.create as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({});

      await (service as any).seedPlatforms();

      expect(platformService.findOneByName).toHaveBeenCalledTimes(3);
      expect(platformService.create).toHaveBeenCalledWith({
        name: 'Windows',
      });
      expect(platformService.create).toHaveBeenCalledWith({
        name: 'PlayStation',
      });
      expect(platformService.create).toHaveBeenCalledWith({ name: 'Xbox' });
    });

    it('should not create platforms that already exist', async () => {
      (
        platformService.findOneByName as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue({
        id: '1',
        name: 'Windows',
      });

      await (service as any).seedPlatforms();

      expect(platformService.findOneByName).toHaveBeenCalledTimes(3);
      expect(platformService.create).not.toHaveBeenCalled();
    });
  });

  describe('seedLaunchers', () => {
    it('should create launchers that do not exist', async () => {
      (
        launcherService.findOneByName as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockRejectedValue(new NotFoundException('Launcher not found'));
      (
        launcherService.create as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({});

      await (service as any).seedLaunchers();

      expect(launcherService.findOneByName).toHaveBeenCalledTimes(4);
      expect(launcherService.create).toHaveBeenCalledWith({ name: 'Arc' });
      expect(launcherService.create).toHaveBeenCalledWith({ name: 'Epic' });
      expect(launcherService.create).toHaveBeenCalledWith({ name: 'Steam' });
      expect(launcherService.create).toHaveBeenCalledWith({ name: 'N/A' });
    });

    it('should not create launchers that already exist', async () => {
      (
        launcherService.findOneByName as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue({
        id: '1',
        name: 'Steam',
      });

      await (service as any).seedLaunchers();

      expect(launcherService.findOneByName).toHaveBeenCalledTimes(4);
      expect(launcherService.create).not.toHaveBeenCalled();
    });
  });

  describe('seedPlatformLaunchers', () => {
    it('should create platform-launcher combinations that do not exist', async () => {
      const platform = { id: 'platform-id', name: 'Windows' };
      const launcher = { id: 'launcher-id', name: 'Steam' };

      (
        platformService.findOneByName as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(platform);
      (
        launcherService.findOneByName as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(launcher);
      (
        platformLauncherService.findOne as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockRejectedValue(
        new NotFoundException('PlatformLauncherEntity relation not found'),
      );
      (
        platformLauncherService.addPlatformLauncherRelation as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue({});

      await (service as any).seedPlatformLaunchers();

      expect(platformLauncherService.findOne).toHaveBeenCalledWith(
        'platform-id',
        'launcher-id',
      );
      expect(
        platformLauncherService.addPlatformLauncherRelation,
      ).toHaveBeenCalledWith('platform-id', 'launcher-id');
    });

    it('should not create combinations that already exist', async () => {
      const platform = { id: 'platform-id', name: 'Windows' };
      const launcher = { id: 'launcher-id', name: 'Steam' };
      const existingCombo = { id: 'combo-id' };

      (
        platformService.findOneByName as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(platform);
      (
        launcherService.findOneByName as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(launcher);
      (
        platformLauncherService.findOne as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(existingCombo);

      await (service as any).seedPlatformLaunchers();

      expect(
        platformLauncherService.addPlatformLauncherRelation,
      ).not.toHaveBeenCalled();
    });

    it('should skip combinations if platform or launcher not found', async () => {
      (
        platformService.findOneByName as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockRejectedValue(new NotFoundException('Platform not found'));
      (
        launcherService.findOneByName as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue({
        id: 'launcher-id',
      });

      await (service as any).seedPlatformLaunchers();

      expect(platformLauncherService.findOne).not.toHaveBeenCalled();
      expect(
        platformLauncherService.addPlatformLauncherRelation,
      ).not.toHaveBeenCalled();
    });
  });
});

import { Logger, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { jest } from '@jest/globals';

import { LauncherService } from 'src/sto/launcher/launcher.service';
import { PlatformLauncherService } from 'src/sto/platform-launcher/platform-launcher.service';
import { PlatformService } from 'src/sto/platform/platform.service';

import { ACCOUNT_BACKGROUNDS } from './account-backgrounds.constants';
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
            ensureBackground: jest.fn(),
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
      const seedBackgroundsSpy = jest
        .spyOn(service as any, 'seedBackgrounds')
        .mockResolvedValue(undefined);

      await service.seed();

      expect(seedPlatformsSpy).toHaveBeenCalled();
      expect(seedLaunchersSpy).toHaveBeenCalled();
      expect(seedPlatformLaunchersSpy).toHaveBeenCalled();
      // After the pairings, which the pictures are given to.
      expect(seedBackgroundsSpy).toHaveBeenCalled();
      expect(seedPlatformLaunchersSpy.mock.invocationCallOrder[0]).toBeLessThan(
        seedBackgroundsSpy.mock.invocationCallOrder[0],
      );

      seedPlatformsSpy.mockRestore();
      seedLaunchersSpy.mockRestore();
      seedPlatformLaunchersSpy.mockRestore();
      seedBackgroundsSpy.mockRestore();
    });
  });

  // On a database built from nothing the migration that added the pictures ran
  // before these rows existed, so every account card showed the global default
  // (tribble, 18 October 2026). The seeder gives them once it has made the rows.
  describe('seedBackgrounds', () => {
    /** Answers a name with an id made from it, as the catalogue would. */
    const catalogue = (prefix: string) => (name: string) =>
      Promise.resolve({ id: `${prefix}-${name}`, name });

    const ensure = () =>
      platformLauncherService.ensureBackground as jest.Mock<
        (...args: any[]) => Promise<any>
      >;

    beforeEach(() => {
      (
        platformService.findOneByName as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockImplementation(catalogue('platform'));
      (
        launcherService.findOneByName as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockImplementation(catalogue('launcher'));
      ensure().mockResolvedValue('kept');
    });

    it('gives every pairing, platform default and the global default its picture', async () => {
      await (service as any).seedBackgrounds();

      expect(ensure()).toHaveBeenCalledTimes(ACCOUNT_BACKGROUNDS.length);
      expect(ensure()).toHaveBeenCalledWith(
        'platform-Windows',
        'launcher-Arc',
        expect.stringContaining('/f7f4c0dc-6137-481d-86b9-d96b74737600/public'),
      );
      expect(ensure()).toHaveBeenCalledWith(
        'platform-Xbox',
        null,
        expect.stringContaining('/df1a3c6f-25bd-4bfc-4541-8a4b097a9e00/public'),
      );
      expect(ensure()).toHaveBeenCalledWith(
        null,
        null,
        expect.stringContaining('/8ab52131-6f11-408a-d9df-3c1acaa46d00/public'),
      );
    });

    it('matches the pictures production and Development were given', () => {
      expect(
        ACCOUNT_BACKGROUNDS.map(
          each =>
            `${each.platform ?? '*'}|${each.launcher ?? '*'}|${each.url.split('/').slice(-2)[0]}`,
        ),
      ).toEqual([
        'Windows|Arc|f7f4c0dc-6137-481d-86b9-d96b74737600',
        'Windows|Epic|65f8c1b1-72cc-4de0-21cc-74791b6f3900',
        'Windows|Steam|3e4517f1-6a07-4b68-bf80-710a70d8ff00',
        'Windows|N/A|4730a67a-1277-4cec-0792-7d858d875d00',
        'PlayStation|N/A|4a3443c5-1430-4139-0167-3eb19d135a00',
        'Xbox|N/A|df1a3c6f-25bd-4bfc-4541-8a4b097a9e00',
        'Windows|*|4730a67a-1277-4cec-0792-7d858d875d00',
        'PlayStation|*|4a3443c5-1430-4139-0167-3eb19d135a00',
        'Xbox|*|df1a3c6f-25bd-4bfc-4541-8a4b097a9e00',
        '*|*|8ab52131-6f11-408a-d9df-3c1acaa46d00',
      ]);
    });

    it('skips a picture whose platform is not in the catalogue', async () => {
      (
        platformService.findOneByName as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockImplementation((name: string) =>
        name === 'Xbox'
          ? Promise.reject(new NotFoundException('Platform not found'))
          : catalogue('platform')(name),
      );

      await (service as any).seedBackgrounds();

      expect(ensure()).toHaveBeenCalledTimes(ACCOUNT_BACKGROUNDS.length - 2);
      expect(ensure()).not.toHaveBeenCalledWith(
        'platform-Xbox',
        expect.anything(),
        expect.anything(),
      );
    });

    it('skips a picture whose launcher is not in the catalogue', async () => {
      (
        launcherService.findOneByName as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockImplementation((name: string) =>
        name === 'Steam'
          ? Promise.reject(new NotFoundException('Launcher not found'))
          : catalogue('launcher')(name),
      );

      await (service as any).seedBackgrounds();

      expect(ensure()).toHaveBeenCalledTimes(ACCOUNT_BACKGROUNDS.length - 1);
      expect(ensure()).not.toHaveBeenCalledWith(
        expect.anything(),
        'launcher-Steam',
        expect.anything(),
      );
    });

    it('says how many pictures it set', async () => {
      const log = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);

      ensure()
        .mockResolvedValueOnce('created')
        .mockResolvedValueOnce('filled')
        .mockResolvedValueOnce('filled');

      await (service as any).seedBackgrounds();

      expect(log).toHaveBeenCalledWith(
        '[seedBackgrounds] Account card pictures set - Created: 1, Filled: 2',
      );
      log.mockRestore();
    });

    it('says nothing when every picture was already set', async () => {
      const log = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);

      await (service as any).seedBackgrounds();

      expect(log).not.toHaveBeenCalledWith(
        expect.stringContaining('[seedBackgrounds]'),
      );
      log.mockRestore();
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
        providesRosterExport: true,
      });
      expect(platformService.create).toHaveBeenCalledWith({
        name: 'PlayStation',
        providesRosterExport: false,
      });
      expect(platformService.create).toHaveBeenCalledWith({
        name: 'Xbox',
        providesRosterExport: false,
      });
    });

    /*
     * The game provides the fleet roster export on Windows and on neither
     * console, so a seeded catalogue says so from the start rather than
     * waiting for somebody to notice that every console import fails.
     */
    it('should record the roster export as available on Windows alone', async () => {
      (
        platformService.findOneByName as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockRejectedValue(new NotFoundException('Platform not found'));
      (
        platformService.create as jest.Mock<(...args: any[]) => Promise<any>>
      ).mockResolvedValue({});

      await (service as any).seedPlatforms();

      const exporting = (platformService.create as jest.Mock).mock.calls
        .map(
          ([platform]) =>
            platform as { name: string; providesRosterExport: boolean },
        )
        .filter(platform => platform.providesRosterExport)
        .map(platform => platform.name);

      expect(exporting).toEqual(['Windows']);
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

  describe('findPlatformByName', () => {
    it('should return platform when found', async () => {
      const platform = { id: 'platform-id', name: 'Windows' };
      (
        platformService.findOneByName as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(platform);

      const result = await (service as any).findPlatformByName('Windows');

      expect(result).toEqual(platform);
      expect(platformService.findOneByName).toHaveBeenCalledWith('Windows');
    });

    it('should return null when platform not found', async () => {
      (
        platformService.findOneByName as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockRejectedValue(new NotFoundException('Platform not found'));

      const result = await (service as any).findPlatformByName('Windows');

      expect(result).toBeNull();
    });

    it('should rethrow non-NotFoundException errors', async () => {
      const databaseError = new Error('Database connection failed');
      (
        platformService.findOneByName as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockRejectedValue(databaseError);

      await expect(
        (service as any).findPlatformByName('Windows'),
      ).rejects.toThrow(databaseError);
    });
  });

  describe('findLauncherByName', () => {
    it('should return launcher when found', async () => {
      const launcher = { id: 'launcher-id', name: 'Steam' };
      (
        launcherService.findOneByName as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(launcher);

      const result = await (service as any).findLauncherByName('Steam');

      expect(result).toEqual(launcher);
      expect(launcherService.findOneByName).toHaveBeenCalledWith('Steam');
    });

    it('should return null when launcher not found', async () => {
      (
        launcherService.findOneByName as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockRejectedValue(new NotFoundException('Launcher not found'));

      const result = await (service as any).findLauncherByName('Steam');

      expect(result).toBeNull();
    });

    it('should rethrow non-NotFoundException errors', async () => {
      const databaseError = new Error('Database connection failed');
      (
        launcherService.findOneByName as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockRejectedValue(databaseError);

      await expect(
        (service as any).findLauncherByName('Steam'),
      ).rejects.toThrow(databaseError);
    });
  });

  describe('findPlatformLauncherRelation', () => {
    it('should return relation when found', async () => {
      const relation = { platformId: 'platform-id', launcherId: 'launcher-id' };
      (
        platformLauncherService.findOne as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockResolvedValue(relation);

      const result = await (service as any).findPlatformLauncherRelation(
        'platform-id',
        'launcher-id',
      );

      expect(result).toEqual(relation);
      expect(platformLauncherService.findOne).toHaveBeenCalledWith(
        'platform-id',
        'launcher-id',
      );
    });

    it('should return null when relation not found', async () => {
      (
        platformLauncherService.findOne as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockRejectedValue(
        new NotFoundException('PlatformLauncherEntity relation not found'),
      );

      const result = await (service as any).findPlatformLauncherRelation(
        'platform-id',
        'launcher-id',
      );

      expect(result).toBeNull();
    });

    it('should rethrow non-NotFoundException errors', async () => {
      const databaseError = new Error('Database connection failed');
      (
        platformLauncherService.findOne as jest.Mock<
          (...args: any[]) => Promise<any>
        >
      ).mockRejectedValue(databaseError);

      await expect(
        (service as any).findPlatformLauncherRelation(
          'platform-id',
          'launcher-id',
        ),
      ).rejects.toThrow(databaseError);
    });
  });
});

import { Logger, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AppSettingEntity } from './entities/app-setting.entity';
import { SETTING_CACHE_TTL_MS, SettingsService } from './settings.service';

describe('SettingsService', () => {
  let service: SettingsService;
  let settingRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
  };

  const adminId = 'e6d3a1b2-0000-4000-8000-0000000000ad';
  const key = 'STORYTIME_ENABLED';

  beforeEach(async () => {
    settingRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        {
          provide: getRepositoryToken(AppSettingEntity),
          useValue: settingRepository,
        },
      ],
    }).compile();

    service = module.get<SettingsService>(SettingsService);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('getBoolean', () => {
    it('reads a true value', async () => {
      settingRepository.findOne.mockResolvedValue({ value: 'true' });

      await expect(service.getBoolean(key, false)).resolves.toBe(true);
    });

    it('reads a false value', async () => {
      settingRepository.findOne.mockResolvedValue({ value: 'false' });

      await expect(service.getBoolean(key, true)).resolves.toBe(false);
    });

    it('ignores surrounding whitespace and casing', async () => {
      settingRepository.findOne.mockResolvedValue({ value: '  TRUE  ' });

      await expect(service.getBoolean(key, false)).resolves.toBe(true);
    });

    it('falls back to the default when the setting is absent', async () => {
      await expect(service.getBoolean(key, true)).resolves.toBe(true);
    });

    // A mistyped value must not leave a feature in an indeterminate state.
    it('falls back to the default when the value is unreadable', async () => {
      settingRepository.findOne.mockResolvedValue({ value: 'yes please' });

      await expect(service.getBoolean(key, false)).resolves.toBe(false);
    });
  });

  describe('caching', () => {
    it('reuses a freshly read value instead of querying again', async () => {
      settingRepository.findOne.mockResolvedValue({ value: 'true' });

      await service.getBoolean(key, false);
      await service.getBoolean(key, false);

      expect(settingRepository.findOne).toHaveBeenCalledTimes(1);
    });

    it('re-reads once the cached value has expired', async () => {
      jest.useFakeTimers();
      settingRepository.findOne.mockResolvedValue({ value: 'true' });

      await service.getBoolean(key, false);
      jest.advanceTimersByTime(SETTING_CACHE_TTL_MS + 1);
      await service.getBoolean(key, false);

      expect(settingRepository.findOne).toHaveBeenCalledTimes(2);
    });

    it('caches the absence of a setting so a missing key is not queried repeatedly', async () => {
      await service.getBoolean(key, true);
      await service.getBoolean(key, true);

      expect(settingRepository.findOne).toHaveBeenCalledTimes(1);
    });

    it('clears every cached value on request', async () => {
      settingRepository.findOne.mockResolvedValue({ value: 'true' });
      await service.getBoolean(key, false);

      service.clearCache();
      await service.getBoolean(key, false);

      expect(settingRepository.findOne).toHaveBeenCalledTimes(2);
    });
  });

  describe('setValue', () => {
    it('updates the value and records the administrator', async () => {
      settingRepository.findOne.mockResolvedValue({ id: 'setting-1' });

      await service.setValue(key, 'true', adminId);

      expect(settingRepository.update).toHaveBeenCalledWith('setting-1', {
        value: 'true',
        updatedByUserId: adminId,
      });
    });

    // The next read must see what actually landed in the database, not a value
    // this process assumed it wrote.
    it('drops the cached value so the next read goes to the database', async () => {
      settingRepository.findOne.mockResolvedValue({
        id: 'setting-1',
        value: 'false',
      });
      await service.getBoolean(key, true);

      await service.setValue(key, 'true', adminId);
      settingRepository.findOne.mockResolvedValue({ value: 'true' });

      await expect(service.getBoolean(key, false)).resolves.toBe(true);
    });

    it('throws when the setting does not exist', async () => {
      await expect(service.setValue(key, 'true', adminId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('list', () => {
    it('returns every setting ordered by key', async () => {
      settingRepository.find.mockResolvedValue([{ key }]);

      await expect(service.list()).resolves.toEqual([{ key }]);
      expect(settingRepository.find).toHaveBeenCalledWith({
        order: { key: 'ASC' },
      });
    });
  });
});

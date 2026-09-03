import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { SettingsService } from '../settings/settings.service';
import { STORYTIME_FEATURE_FLAGS } from './constants/storytime-feature.constants';
import { StorytimeFeatureService } from './storytime-feature.service';

describe('StorytimeFeatureService', () => {
  let service: StorytimeFeatureService;
  let settingsService: { getBoolean: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    settingsService = { getBoolean: jest.fn().mockResolvedValue(true) };
    configService = { get: jest.fn().mockReturnValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeFeatureService,
        { provide: SettingsService, useValue: settingsService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<StorytimeFeatureService>(StorytimeFeatureService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('isEnabled', () => {
    it('reports the runtime master switch', async () => {
      await expect(service.isEnabled()).resolves.toBe(true);
    });

    // An environment missing the setting must keep unfinished work hidden.
    it('defaults to disabled', async () => {
      await service.isEnabled();

      expect(settingsService.getBoolean).toHaveBeenCalledWith(
        'STORYTIME_ENABLED',
        false,
      );
    });
  });

  describe('isFlagEnabled', () => {
    it('is true when the feature is on and the flag is unset', async () => {
      await expect(
        service.isFlagEnabled(STORYTIME_FEATURE_FLAGS.CREATION_ENABLED),
      ).resolves.toBe(true);
    });

    it('is false when configuration explicitly disables the flag', async () => {
      configService.get.mockReturnValue('false');

      await expect(
        service.isFlagEnabled(STORYTIME_FEATURE_FLAGS.CREATION_ENABLED),
      ).resolves.toBe(false);
    });

    it('accepts a boolean false from configuration', async () => {
      configService.get.mockReturnValue(false);

      await expect(
        service.isFlagEnabled(STORYTIME_FEATURE_FLAGS.YOUTUBE_ENABLED),
      ).resolves.toBe(false);
    });

    it('ignores whitespace and casing when reading a flag', async () => {
      configService.get.mockReturnValue('  FALSE  ');

      await expect(
        service.isFlagEnabled(STORYTIME_FEATURE_FLAGS.YOUTUBE_ENABLED),
      ).resolves.toBe(false);
    });

    it('treats any other value as enabled', async () => {
      configService.get.mockReturnValue('true');

      await expect(
        service.isFlagEnabled(STORYTIME_FEATURE_FLAGS.SPOTLIGHT_ENABLED),
      ).resolves.toBe(true);
    });

    it('treats a null configured value as enabled', async () => {
      configService.get.mockReturnValue(null);

      await expect(
        service.isFlagEnabled(STORYTIME_FEATURE_FLAGS.SPOTLIGHT_ENABLED),
      ).resolves.toBe(true);
    });

    // The master switch has to win, or an incident could not be contained.
    it('is false for every flag when the master switch is off', async () => {
      settingsService.getBoolean.mockResolvedValue(false);
      configService.get.mockReturnValue('true');

      await expect(
        service.isFlagEnabled(STORYTIME_FEATURE_FLAGS.PUBLIC_READ_ENABLED),
      ).resolves.toBe(false);
    });
  });

  describe('assertFlagEnabled', () => {
    it('resolves when the capability is available', async () => {
      await expect(
        service.assertFlagEnabled(STORYTIME_FEATURE_FLAGS.CREATION_ENABLED),
      ).resolves.toBeUndefined();
    });

    // A switched-off feature should look like one that does not exist, so a
    // staged rollout does not advertise what is coming.
    it('throws NotFound rather than a disabled error', async () => {
      settingsService.getBoolean.mockResolvedValue(false);

      await expect(
        service.assertFlagEnabled(STORYTIME_FEATURE_FLAGS.CREATION_ENABLED),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getState', () => {
    it('reports every capability as available when enabled', async () => {
      await expect(service.getState()).resolves.toEqual({
        isEnabled: true,
        publicReadEnabled: true,
        creationEnabled: true,
        youTubeEnabled: true,
        spotlightEnabled: true,
      });
    });

    it('reports every capability as unavailable when the master switch is off', async () => {
      settingsService.getBoolean.mockResolvedValue(false);

      await expect(service.getState()).resolves.toEqual({
        isEnabled: false,
        publicReadEnabled: false,
        creationEnabled: false,
        youTubeEnabled: false,
        spotlightEnabled: false,
      });
    });

    it('reports an individually disabled capability', async () => {
      configService.get.mockImplementation((flag: string) =>
        flag === STORYTIME_FEATURE_FLAGS.YOUTUBE_ENABLED ? 'false' : undefined,
      );

      const state = await service.getState();

      expect(state.youTubeEnabled).toBe(false);
      expect(state.creationEnabled).toBe(true);
    });
  });
});

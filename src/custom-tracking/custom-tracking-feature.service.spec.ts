import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { jest } from '@jest/globals';

import { SettingsService } from '../settings/settings.service';
import { CUSTOM_TRACKING_FEATURE_FLAGS } from './constants/custom-tracking-feature.constants';
import { CustomTrackingFeatureService } from './custom-tracking-feature.service';

describe('CustomTrackingFeatureService', () => {
  let service: CustomTrackingFeatureService;
  let getBoolean: jest.Mock<
    (key: string, fallback: boolean) => Promise<boolean>
  >;
  let get: jest.Mock<(key: string) => string | boolean | undefined>;

  beforeEach(() => {
    getBoolean =
      jest.fn<(key: string, fallback: boolean) => Promise<boolean>>();
    get = jest.fn<(key: string) => string | boolean | undefined>();

    service = new CustomTrackingFeatureService(
      { getBoolean } as unknown as SettingsService,
      { get } as unknown as ConfigService,
    );
  });

  const masterSwitch = (on: boolean): void => {
    getBoolean.mockResolvedValue(on);
  };

  describe('isEnabled', () => {
    it('reports the master switch', async () => {
      masterSwitch(true);

      await expect(service.isEnabled()).resolves.toBe(true);
    });

    // A fresh environment, or one where the setting has been lost, should keep
    // an unfinished feature hidden rather than exposing it.
    it('asks for a default of off', async () => {
      masterSwitch(false);

      await service.isEnabled();

      expect(getBoolean).toHaveBeenCalledWith('CUSTOM_TRACKING_ENABLED', false);
    });
  });

  describe('isFlagEnabled', () => {
    it('reports a capability as available when nothing disables it', async () => {
      masterSwitch(true);
      get.mockReturnValue(undefined);

      await expect(
        service.isFlagEnabled(CUSTOM_TRACKING_FEATURE_FLAGS.IMAGES_ENABLED),
      ).resolves.toBe(true);
    });

    // The master switch wins, so a caller need only ask about the specific
    // thing it is about to do.
    it('reports every capability as unavailable when the feature is off', async () => {
      masterSwitch(false);
      get.mockReturnValue('true');

      await expect(
        service.isFlagEnabled(CUSTOM_TRACKING_FEATURE_FLAGS.IMAGES_ENABLED),
      ).resolves.toBe(false);
      expect(get).not.toHaveBeenCalled();
    });

    it.each([
      ['the string false', 'false'],
      ['the string false in capitals', 'FALSE'],
      ['the string false with whitespace', '  false  '],
      ['a genuine boolean false', false],
    ])('treats %s as disabled', async (_description, configured) => {
      masterSwitch(true);
      get.mockReturnValue(configured);

      await expect(
        service.isFlagEnabled(CUSTOM_TRACKING_FEATURE_FLAGS.YOUTUBE_ENABLED),
      ).resolves.toBe(false);
    });

    it.each([
      ['an absent setting', undefined],
      ['a null setting', null],
      ['the string true', 'true'],
      ['a genuine boolean true', true],
      ['anything else', 'yes'],
    ])('treats %s as enabled', async (_description, configured) => {
      masterSwitch(true);
      get.mockReturnValue(configured as string | boolean | undefined);

      await expect(
        service.isFlagEnabled(CUSTOM_TRACKING_FEATURE_FLAGS.YOUTUBE_ENABLED),
      ).resolves.toBe(true);
    });
  });

  describe('assertFlagEnabled', () => {
    it('allows an available capability through', async () => {
      masterSwitch(true);
      get.mockReturnValue(undefined);

      await expect(
        service.assertFlagEnabled(
          CUSTOM_TRACKING_FEATURE_FLAGS.VALUE_EDITING_ENABLED,
        ),
      ).resolves.toBeUndefined();
    });

    // A feature that is switched off should be indistinguishable from one that
    // does not exist, so a staged rollout does not advertise what is coming.
    it('reports an unavailable capability as absent rather than disabled', async () => {
      masterSwitch(false);

      await expect(
        service.assertFlagEnabled(
          CUSTOM_TRACKING_FEATURE_FLAGS.VALUE_EDITING_ENABLED,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getState', () => {
    it('reports every capability as available when the feature is on', async () => {
      masterSwitch(true);
      get.mockReturnValue(undefined);

      await expect(service.getState()).resolves.toEqual({
        isEnabled: true,
        publicReadEnabled: true,
        definitionEditingEnabled: true,
        valueEditingEnabled: true,
        imagesEnabled: true,
        youTubeEnabled: true,
      });
    });

    it('reports every capability as unavailable when the feature is off', async () => {
      masterSwitch(false);
      get.mockReturnValue('true');

      await expect(service.getState()).resolves.toEqual({
        isEnabled: false,
        publicReadEnabled: false,
        definitionEditingEnabled: false,
        valueEditingEnabled: false,
        imagesEnabled: false,
        youTubeEnabled: false,
      });
    });

    it('reports one capability as unavailable without affecting the rest', async () => {
      masterSwitch(true);
      get.mockImplementation(key =>
        key === CUSTOM_TRACKING_FEATURE_FLAGS.IMAGES_ENABLED
          ? 'false'
          : undefined,
      );

      await expect(service.getState()).resolves.toMatchObject({
        isEnabled: true,
        imagesEnabled: false,
        youTubeEnabled: true,
      });
    });
  });
});

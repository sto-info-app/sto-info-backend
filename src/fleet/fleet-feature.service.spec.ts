import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { jest } from '@jest/globals';

import { SettingsService } from '../settings/settings.service';
import {
  FLEET_COMMUNITIES_ENABLED_SETTING_KEY,
  FLEET_FEATURE_FLAGS,
} from './constants/fleet-feature.constants';
import { FleetFeatureService } from './fleet-feature.service';

describe('FleetFeatureService', () => {
  let service: FleetFeatureService;
  let settingsService: { getBoolean: jest.Mock<(...args: any[]) => any> };
  let configService: { get: jest.Mock<(...args: any[]) => any> };

  beforeEach(async () => {
    settingsService = {
      getBoolean: jest.fn<(...args: any[]) => any>().mockResolvedValue(true),
    };
    configService = { get: jest.fn<(...args: any[]) => any>() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FleetFeatureService,
        { provide: SettingsService, useValue: settingsService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(FleetFeatureService);
  });

  describe('isEnabled', () => {
    it('reads the runtime master switch', async () => {
      await service.isEnabled();

      expect(settingsService.getBoolean).toHaveBeenCalledWith(
        FLEET_COMMUNITIES_ENABLED_SETTING_KEY,
        false,
      );
    });

    /**
     * The default matters more than the lookup. Plan section 10 requires
     * production v1 to be enabled only once the full scope is ready, so an
     * environment where the setting is missing — a fresh database, a restore
     * that lost the row — must hide a half-built feature rather than reveal it.
     */
    it('defaults to disabled', async () => {
      settingsService.getBoolean.mockImplementation(
        async (_key: string, fallback: boolean) => fallback,
      );

      await expect(service.isEnabled()).resolves.toBe(false);
    });
  });

  describe('isFlagEnabled', () => {
    it('is false for every capability while the master switch is off', async () => {
      settingsService.getBoolean.mockResolvedValue(false);
      configService.get.mockReturnValue('true');

      for (const flag of Object.values(FLEET_FEATURE_FLAGS)) {
        await expect(service.isFlagEnabled(flag)).resolves.toBe(false);
      }
    });

    it('treats an unset capability as enabled', async () => {
      configService.get.mockReturnValue(undefined);

      await expect(
        service.isFlagEnabled(FLEET_FEATURE_FLAGS.IMPORTS_ENABLED),
      ).resolves.toBe(true);
    });

    it('treats a null capability as enabled', async () => {
      configService.get.mockReturnValue(null);

      await expect(
        service.isFlagEnabled(FLEET_FEATURE_FLAGS.IMPORTS_ENABLED),
      ).resolves.toBe(true);
    });

    it.each([
      ['false', false],
      ['FALSE', false],
      ['  false  ', false],
      ['true', true],
      ['anything else', true],
    ])('reads %s as %s', async (configured, expected) => {
      configService.get.mockReturnValue(configured);

      await expect(
        service.isFlagEnabled(FLEET_FEATURE_FLAGS.CHAT_ENABLED),
      ).resolves.toBe(expected);
    });
  });

  describe('assertEnabled', () => {
    /**
     * For the routes that belong to the feature without belonging to any one
     * capability flag — reading a Community, resolving a URL segment. Same
     * answer as {@link assertFlagEnabled} and for the same reason: switched
     * off should look like never built.
     */
    it('throws NotFoundException when the feature is switched off', async () => {
      settingsService.getBoolean.mockResolvedValue(false);

      await expect(service.assertEnabled()).rejects.toThrow(NotFoundException);
    });

    it('resolves when the feature is switched on', async () => {
      await expect(service.assertEnabled()).resolves.toBeUndefined();
    });
  });

  describe('assertFlagEnabled', () => {
    /**
     * Not found rather than forbidden, matching Storytime and the Fleet
     * authorisation policy: a feature that is switched off should be
     * indistinguishable from one that does not exist, so a staged rollout does
     * not advertise what is coming.
     */
    it('throws NotFoundException when a capability is unavailable', async () => {
      settingsService.getBoolean.mockResolvedValue(false);

      await expect(
        service.assertFlagEnabled(FLEET_FEATURE_FLAGS.REGISTRATION_ENABLED),
      ).rejects.toThrow(NotFoundException);
    });

    it('resolves when the capability is available', async () => {
      configService.get.mockReturnValue('true');

      await expect(
        service.assertFlagEnabled(FLEET_FEATURE_FLAGS.REGISTRATION_ENABLED),
      ).resolves.toBeUndefined();
    });
  });

  describe('getState', () => {
    it('reports every capability off while the master switch is off', async () => {
      settingsService.getBoolean.mockResolvedValue(false);
      configService.get.mockReturnValue('true');

      await expect(service.getState()).resolves.toEqual({
        isEnabled: false,
        registrationEnabled: false,
        importsEnabled: false,
        chatEnabled: false,
      });
    });

    it('reports each capability as configured when enabled', async () => {
      configService.get.mockImplementation((key: string) =>
        key === FLEET_FEATURE_FLAGS.CHAT_ENABLED ? 'false' : 'true',
      );

      await expect(service.getState()).resolves.toEqual({
        isEnabled: true,
        registrationEnabled: true,
        importsEnabled: true,
        chatEnabled: false,
      });
    });
  });

  /**
   * FC-006's third acceptance criterion: disabling the Fleet feature must not
   * stop the file gate or the retention jobs.
   *
   * Asserted structurally rather than behaviourally, for the same reason
   * FC-005's CSV criteria were: the strongest form of "this switch cannot stand
   * that job down" is that the job has no way to ask about the switch. A
   * behavioural test would prove that today's cron ignores it; this proves that
   * tomorrow's cannot consult it without the test failing.
   */
  describe('site-wide services cannot consult the switch', () => {
    const sourcesUnder = (directory: string): string[] => {
      const entries = readdirSync(directory, { withFileTypes: true });

      return entries.flatMap(entry => {
        const path = join(directory, entry.name);

        if (entry.isDirectory()) {
          return sourcesUnder(path);
        }

        return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
          ? [path]
          : [];
      });
    };

    const cronSources = sourcesUnder(join(__dirname, '..', 'cron'));

    it('finds the cron sources it is asserting about', () => {
      expect(cronSources.length).toBeGreaterThan(0);
    });

    it.each(cronSources)('%s does not reach the Fleet switch', path => {
      const source = readFileSync(path, 'utf8');

      expect(source).not.toMatch(/fleet-feature/);
      expect(source).not.toMatch(/FleetFeatureService/);
      expect(source).not.toMatch(/FLEET_COMMUNITIES_ENABLED/);
    });

    /**
     * The other direction. A feature switch that knew about scanning or
     * retention would be one somebody could wire into them later; this service
     * reads a setting and a handful of environment variables and knows nothing
     * about what the application does with the answer.
     */
    it('knows nothing about scanning, quarantine or retention', () => {
      const source = readFileSync(
        join(__dirname, 'fleet-feature.service.ts'),
        'utf8',
      );
      const imports = [
        ...source.matchAll(/^import[^;]*?from '([^']+)';$/gm),
      ].map(match => match[1]);

      expect(
        imports.filter(specifier =>
          /scan|quarantine|retention|cron|asset|file/i.test(specifier),
        ),
      ).toEqual([]);
    });
  });
});

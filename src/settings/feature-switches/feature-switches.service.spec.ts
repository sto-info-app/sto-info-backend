import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { DataSource, EntityManager } from 'typeorm';

import { SiteAdminActionEntity } from 'src/audit/site-admin/site-admin-action.entity';
import { SiteAdminActionKind } from 'src/audit/site-admin/site-admin-action.enum';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';

import { AppSettingEntity } from '../entities/app-setting.entity';
import { SettingsService } from '../settings.service';
import { FEATURE_SWITCHES, FeatureSwitch } from './feature-switch.constants';
import { FeatureSwitchesService } from './feature-switches.service';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const CHANGED_AT = new Date('2026-10-06T09:00:00.000Z');
const REASON = 'Fleet Community v1 accepted';

/**
 * A stored switch.
 *
 * @param key - Its setting key.
 * @param value - Its value.
 * @param updatedByUserId - Who last changed it.
 * @returns The row.
 */
function row(
  key: string,
  value: string,
  updatedByUserId: string | null = null,
): AppSettingEntity {
  return {
    id: `id-${key}`,
    key,
    value,
    description: null,
    updatedByUserId,
    createdAt: CHANGED_AT,
    updatedAt: CHANGED_AT,
  };
}

describe('FeatureSwitchesService', () => {
  let rows: AppSettingEntity[];
  let environment: Record<string, string | boolean | undefined>;
  let find: jest.Mock<(entity: unknown, options: unknown) => Promise<unknown>>;
  let findOne: jest.Mock<
    (entity: unknown, options: unknown) => Promise<unknown>
  >;
  let insert: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  let setValue: jest.Mock<
    (
      key: string,
      value: string,
      userId: string,
      manager?: EntityManager,
    ) => Promise<void>
  >;
  let transaction: jest.Mock<
    (work: (inner: EntityManager) => Promise<unknown>) => Promise<unknown>
  >;
  let warn: jest.SpiedFunction<Logger['warn']>;
  let service: FeatureSwitchesService;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    warn.mockClear();

    rows = [
      row('FLEET_COMMUNITIES_ENABLED', 'false'),
      row('STORYTIME_ENABLED', 'true', ADMIN_ID),
      row('CUSTOM_TRACKING_ENABLED', 'TRUE '),
    ];
    environment = {};
    find = jest.fn((entity: unknown) =>
      Promise.resolve(
        entity === UserProfileEntity
          ? [{ userId: ADMIN_ID, username: 'Steve' }]
          : rows,
      ),
    );
    findOne = jest.fn((_entity: unknown, options: unknown) => {
      const { key } = (options as { where: { key: string } }).where;

      return Promise.resolve(rows.find(entry => entry.key === key) ?? null);
    });
    insert = jest.fn(() => Promise.resolve(undefined));
    setValue = jest.fn((key: string, value: string, userId: string) => {
      const stored = rows.find(entry => entry.key === key)!;

      stored.value = value;
      stored.updatedByUserId = userId;

      return Promise.resolve();
    });

    const manager = { find, findOne, insert } as unknown as EntityManager;

    transaction = jest.fn((work: (inner: EntityManager) => Promise<unknown>) =>
      work(manager),
    );

    service = new FeatureSwitchesService(
      { manager, transaction } as unknown as DataSource,
      { setValue } as unknown as SettingsService,
      {
        get: (key: string) => environment[key],
      } as unknown as ConfigService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('list', () => {
    it('lists Fleet Communities, Storytime and Custom Tracking, in that order', async () => {
      const switches = await service.list();

      expect(switches.map(entry => entry.feature)).toEqual([
        FeatureSwitch.FLEET_COMMUNITIES,
        FeatureSwitch.STORYTIME,
        FeatureSwitch.CUSTOM_TRACKING,
      ]);
      expect(switches.map(entry => entry.label)).toEqual([
        'Fleet Communities',
        'Storytime',
        'Custom Tracking',
      ]);
    });

    it('reads only "true" as on, as the features themselves do', async () => {
      rows[0].value = 'yes';

      const switches = await service.list();

      expect(switches.map(entry => entry.isEnabled)).toEqual([
        false,
        true,
        true,
      ]);
    });

    it('reads every switch from the database, not the settings cache', async () => {
      await service.list();

      expect(find).toHaveBeenCalledWith(AppSettingEntity, {
        where: {
          key: expect.objectContaining({
            _value: [
              'FLEET_COMMUNITIES_ENABLED',
              'STORYTIME_ENABLED',
              'CUSTOM_TRACKING_ENABLED',
            ],
          }),
        },
      });
    });

    it('names who last changed a switch, and nobody for a seeded one', async () => {
      const [fleet, storytime] = await service.list();

      expect(storytime.changedByUsername).toBe('Steve');
      expect(storytime.changedAt).toEqual(CHANGED_AT);
      expect(fleet.changedByUsername).toBeNull();
    });

    it('names nobody when the account that changed it has gone', async () => {
      find.mockImplementation((entity: unknown) =>
        Promise.resolve(entity === UserProfileEntity ? [] : rows),
      );

      const [, storytime] = await service.list();

      expect(storytime.changedByUsername).toBeNull();
    });

    it('shows a missing switch as off, changed by nobody, never', async () => {
      rows = rows.slice(1);

      const [fleet] = await service.list();

      expect(fleet).toEqual(
        expect.objectContaining({
          isEnabled: false,
          changedAt: null,
          changedByUsername: null,
        }),
      );
    });

    it('shows each capability flag as the environment sets it, unset counting as allowed', async () => {
      environment = {
        FLEET_CHAT_ENABLED: 'false',
        FLEET_IMPORTS_ENABLED: ' FALSE ',
        FLEET_REGISTRATION_ENABLED: 'anything',
        STORYTIME_SPOTLIGHT_ENABLED: false,
        CUSTOM_TRACKING_IMAGES_ENABLED: null as unknown as undefined,
      };

      const [fleet, storytime, customTracking] = await service.list();

      expect(fleet.subFlags).toEqual([
        {
          key: 'FLEET_REGISTRATION_ENABLED',
          label: 'Registering Communities, Fleets and Armadas',
          isEnabled: true,
        },
        {
          key: 'FLEET_IMPORTS_ENABLED',
          label: 'Roster imports',
          isEnabled: false,
        },
        {
          key: 'FLEET_CHAT_ENABLED',
          label: 'Chat and direct messages',
          isEnabled: false,
        },
      ]);
      expect(
        storytime.subFlags.map(flag => [flag.key, flag.isEnabled]),
      ).toEqual([
        ['STORYTIME_PUBLIC_READ_ENABLED', true],
        ['STORYTIME_CREATION_ENABLED', true],
        ['STORYTIME_YOUTUBE_ENABLED', true],
        ['STORYTIME_SPOTLIGHT_ENABLED', false],
      ]);
      expect(customTracking.subFlags.every(flag => flag.isEnabled)).toBe(true);
    });

    it('shows a capability flag even while its feature is off', async () => {
      const [fleet] = await service.list();

      expect(fleet.isEnabled).toBe(false);
      expect(fleet.subFlags.every(flag => flag.isEnabled)).toBe(true);
    });
  });

  describe('set', () => {
    it('switches a feature on and logs it with the reason, in one transaction', async () => {
      const result = await service.set(
        FeatureSwitch.FLEET_COMMUNITIES,
        true,
        ADMIN_ID,
        REASON,
      );

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(findOne).toHaveBeenCalledWith(AppSettingEntity, {
        where: { key: 'FLEET_COMMUNITIES_ENABLED' },
        lock: { mode: 'pessimistic_write' },
      });
      expect(setValue).toHaveBeenCalledWith(
        'FLEET_COMMUNITIES_ENABLED',
        'true',
        ADMIN_ID,
        expect.anything(),
      );
      expect(insert).toHaveBeenCalledWith(
        SiteAdminActionEntity,
        expect.objectContaining({
          action: SiteAdminActionKind.FEATURE_SWITCHED_ON,
          actorUserId: ADMIN_ID,
          targetUserId: null,
          subjectKind: 'FEATURE_SWITCH',
          subjectId: 'FLEET_COMMUNITIES',
          reason: REASON,
          detail: null,
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          feature: FeatureSwitch.FLEET_COMMUNITIES,
          isEnabled: true,
          changedByUsername: 'Steve',
        }),
      );
      expect(warn).toHaveBeenCalledWith(
        `[set] FLEET_COMMUNITIES switched on - AdminId: ${ADMIN_ID}`,
      );
    });

    it('switches a feature off, logging it as switched off', async () => {
      const result = await service.set(
        FeatureSwitch.STORYTIME,
        false,
        ADMIN_ID,
        REASON,
      );

      expect(setValue).toHaveBeenCalledWith(
        'STORYTIME_ENABLED',
        'false',
        ADMIN_ID,
        expect.anything(),
      );
      expect(insert).toHaveBeenCalledWith(
        SiteAdminActionEntity,
        expect.objectContaining({
          action: SiteAdminActionKind.FEATURE_SWITCHED_OFF,
          subjectId: 'STORYTIME',
        }),
      );
      expect(result.isEnabled).toBe(false);
      expect(warn).toHaveBeenCalledWith(
        `[set] STORYTIME switched off - AdminId: ${ADMIN_ID}`,
      );
    });

    it.each([
      [
        FeatureSwitch.FLEET_COMMUNITIES,
        false,
        'Fleet Communities is already switched off.',
      ],
      [FeatureSwitch.STORYTIME, true, 'Storytime is already switched on.'],
      // A spelling the features read as on is on here too.
      [
        FeatureSwitch.CUSTOM_TRACKING,
        true,
        'Custom Tracking is already switched on.',
      ],
    ])(
      'refuses to switch %s to where it already is, writing and logging nothing',
      async (feature, isEnabled, message) => {
        await expect(
          service.set(feature, isEnabled, ADMIN_ID, REASON),
        ).rejects.toThrow(new ConflictException(message));
        expect(setValue).not.toHaveBeenCalled();
        expect(insert).not.toHaveBeenCalled();
      },
    );

    it('refuses when the switch is missing from the database', async () => {
      rows = rows.slice(1);

      await expect(
        service.set(FeatureSwitch.FLEET_COMMUNITIES, true, ADMIN_ID, REASON),
      ).rejects.toThrow(
        new NotFoundException(
          "Fleet Communities's switch is missing from the database.",
        ),
      );
      expect(setValue).not.toHaveBeenCalled();
    });

    it('refuses a feature it has no switch for', async () => {
      await expect(
        service.set('NEWS' as FeatureSwitch, true, ADMIN_ID, REASON),
      ).rejects.toThrow(
        new NotFoundException('There is no such feature switch.'),
      );
      expect(transaction).not.toHaveBeenCalled();
    });

    it('logs nothing when the write fails', async () => {
      setValue.mockRejectedValue(new Error('database gone'));

      await expect(
        service.set(FeatureSwitch.FLEET_COMMUNITIES, true, ADMIN_ID, REASON),
      ).rejects.toThrow('database gone');
      expect(insert).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    });
  });

  it('defines a switch for each feature, each with capability flags of its own', () => {
    expect(FEATURE_SWITCHES.map(entry => entry.feature)).toEqual(
      Object.values(FeatureSwitch),
    );

    const keys = FEATURE_SWITCHES.flatMap(entry =>
      entry.subFlags.map(flag => flag.key),
    );

    expect(new Set(keys).size).toBe(keys.length);
  });
});

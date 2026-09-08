import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { AppSettingEntity } from './entities/app-setting.entity';

/**
 * How long a read value is reused before the database is consulted again.
 *
 * A runtime switch is checked on a great many requests, so reading it from the
 * database every time would be a needless query per request. Ten seconds keeps
 * that cost negligible while still making a change feel immediate to the
 * administrator who made it — the deliberate trade is that a toggle can take up
 * to this long to reach every instance.
 */
export const SETTING_CACHE_TTL_MS = 10_000;

/** A value held in the short-lived cache. */
interface CachedSetting {
  value: string | null;
  readAt: number;
}

/**
 * Reads and writes the handful of operational settings that must be changeable
 * while the site is running.
 *
 * Not a general configuration store: anything that varies only between
 * environments belongs in environment variables, which are simpler to reason
 * about and cannot be changed by accident from a web page.
 */
@Injectable()
export class SettingsService {
  private readonly _logger = new Logger(SettingsService.name);
  private readonly _cache = new Map<string, CachedSetting>();

  /**
   * Creates an instance of SettingsService.
   *
   * @param _settingRepository - Repository of operational settings.
   */
  constructor(
    @InjectRepository(AppSettingEntity)
    private readonly _settingRepository: Repository<AppSettingEntity>,
  ) {}

  /**
   * Reads a boolean setting.
   *
   * Anything other than a recognised truthy or falsy spelling falls back to the
   * supplied default, so a mistyped value cannot leave a feature in an
   * indeterminate state.
   *
   * @param key - The setting key.
   * @param defaultValue - The value to assume when unset or unreadable.
   * @returns The effective boolean value.
   */
  async getBoolean(key: string, defaultValue: boolean): Promise<boolean> {
    const raw = await this.getRaw(key);

    if (raw === null) {
      return defaultValue;
    }

    const normalised = raw.trim().toLowerCase();

    if (normalised === 'true') {
      return true;
    }

    if (normalised === 'false') {
      return false;
    }

    this._logger.warn(
      `Ignoring unreadable ${key} value '${raw}'; using ${String(defaultValue)}`,
    );
    return defaultValue;
  }

  /**
   * Replaces a setting's value.
   *
   * @param key - The setting key.
   * @param value - The new value.
   * @param actingUserId - The administrator making the change.
   * @throws NotFoundException when the setting does not exist.
   */
  async setValue(
    key: string,
    value: string,
    actingUserId: string,
  ): Promise<void> {
    const setting = await this._settingRepository.findOne({ where: { key } });

    if (!setting) {
      throw new NotFoundException('Setting not found');
    }

    await this._settingRepository.update(setting.id, {
      value,
      updatedByUserId: actingUserId,
    });

    // Dropped rather than replaced so the next read goes to the database and
    // sees whatever actually landed there.
    this._cache.delete(key);

    this._logger.log(
      `Setting '${key}' changed to '${value}' by ${actingUserId}`,
    );
  }

  /**
   * Lists every operational setting.
   *
   * @returns The settings, ordered by key.
   */
  list(): Promise<AppSettingEntity[]> {
    return this._settingRepository.find({ order: { key: 'ASC' } });
  }

  /**
   * Discards every cached value.
   *
   * Exists for tests and for administrative actions that need a change to be
   * visible immediately rather than within the cache window.
   */
  clearCache(): void {
    this._cache.clear();
  }

  /**
   * Reads a setting's raw value, using the short-lived cache when it is fresh.
   *
   * @param key - The setting key.
   * @returns The stored value, or null when the setting does not exist.
   */
  private async getRaw(key: string): Promise<string | null> {
    const cached = this._cache.get(key);
    const now = Date.now();

    if (cached && now - cached.readAt < SETTING_CACHE_TTL_MS) {
      return cached.value;
    }

    const setting = await this._settingRepository.findOne({ where: { key } });
    const value = setting?.value ?? null;

    this._cache.set(key, { value, readAt: now });

    return value;
  }
}

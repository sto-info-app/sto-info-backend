import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.service';
import {
  STORYTIME_ENABLED_SETTING_KEY,
  STORYTIME_FEATURE_FLAGS,
  StorytimeFeatureFlag,
} from './constants/storytime-feature.constants';

/**
 * Whether Storytime, and each part of it, is currently switched on.
 *
 * Two layers, deliberately different in kind. The master switch lives in the
 * database so it can be thrown during an incident without a deployment; the
 * capability flags live in environment variables because they stage a rollout
 * and vary by environment rather than by minute.
 *
 * The master switch wins: with Storytime disabled every capability reports as
 * off, so callers need only ask about the specific thing they are about to do.
 */
@Injectable()
export class StorytimeFeatureService {
  /**
   * Creates an instance of StorytimeFeatureService.
   *
   * @param _settingsService - Reads the runtime master switch.
   * @param _configService - Reads the per-environment capability flags.
   */
  constructor(
    private readonly _settingsService: SettingsService,
    private readonly _configService: ConfigService,
  ) {}

  /**
   * Determines whether Storytime is switched on at all.
   *
   * Defaults to disabled, so an environment missing the setting keeps an
   * unfinished feature hidden rather than exposing it.
   *
   * @returns True when the feature is enabled.
   */
  isEnabled(): Promise<boolean> {
    return this._settingsService.getBoolean(
      STORYTIME_ENABLED_SETTING_KEY,
      false,
    );
  }

  /**
   * Determines whether a specific capability is available.
   *
   * @param flag - The capability to check.
   * @returns True when Storytime is enabled and the capability is not disabled.
   */
  async isFlagEnabled(flag: StorytimeFeatureFlag): Promise<boolean> {
    if (!(await this.isEnabled())) {
      return false;
    }

    return this.readFlag(flag);
  }

  /**
   * Requires that a capability is available.
   *
   * Throws {@link NotFoundException} rather than a "disabled" error on purpose:
   * a feature that is switched off should be indistinguishable from one that
   * does not exist, so a staged rollout does not advertise what is coming.
   *
   * @param flag - The capability required.
   * @throws NotFoundException when the capability is unavailable.
   */
  async assertFlagEnabled(flag: StorytimeFeatureFlag): Promise<void> {
    if (!(await this.isFlagEnabled(flag))) {
      throw new NotFoundException('Not found');
    }
  }

  /**
   * Reports the state of every capability.
   *
   * @returns Each capability flag and whether it is currently available.
   */
  async getState(): Promise<{
    isEnabled: boolean;
    publicReadEnabled: boolean;
    creationEnabled: boolean;
    youTubeEnabled: boolean;
    spotlightEnabled: boolean;
  }> {
    const isEnabled = await this.isEnabled();

    return {
      isEnabled,
      publicReadEnabled:
        isEnabled && this.readFlag(STORYTIME_FEATURE_FLAGS.PUBLIC_READ_ENABLED),
      creationEnabled:
        isEnabled && this.readFlag(STORYTIME_FEATURE_FLAGS.CREATION_ENABLED),
      youTubeEnabled:
        isEnabled && this.readFlag(STORYTIME_FEATURE_FLAGS.YOUTUBE_ENABLED),
      spotlightEnabled:
        isEnabled && this.readFlag(STORYTIME_FEATURE_FLAGS.SPOTLIGHT_ENABLED),
    };
  }

  /**
   * Reads a capability flag from configuration.
   *
   * Absent or unreadable values are treated as enabled: once Storytime itself
   * is on, its parts should work unless an environment has deliberately said
   * otherwise.
   *
   * @param flag - The capability to read.
   * @returns True unless configuration explicitly disables the capability.
   */
  private readFlag(flag: StorytimeFeatureFlag): boolean {
    const configured = this._configService.get<string | boolean>(flag);

    if (configured === undefined || configured === null) {
      return true;
    }

    return String(configured).trim().toLowerCase() !== 'false';
  }
}

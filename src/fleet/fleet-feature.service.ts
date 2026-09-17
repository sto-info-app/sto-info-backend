import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SettingsService } from '../settings/settings.service';
import {
  FLEET_COMMUNITIES_ENABLED_SETTING_KEY,
  FLEET_FEATURE_FLAGS,
  FleetFeatureFlag,
} from './constants/fleet-feature.constants';

/**
 * Whether Fleet Community, and each part of it, is currently switched on.
 *
 * The same two-layer arrangement Storytime uses, for the same reasons: the
 * master switch lives in the database so it can be thrown during an incident,
 * and the capability flags live in environment variables because they stage a
 * rollout rather than respond to one. The master switch wins, so a caller need
 * only ask about the specific thing it is about to do.
 *
 * **What this service must never be asked about.** File scanning, quarantine,
 * asset revocation and every retention or cleanup job are site-wide and run
 * regardless of this switch. A disabled Fleet feature stops new Fleet activity;
 * it does not stop a scanner finishing a job already queued, and it does not
 * stop a cron deleting what policy says must be deleted. Requirement R24 makes
 * the file gate unconditional, and a switch that could stand it down would be a
 * way to make unscanned files reachable — so those services do not inject this
 * class at all, which is the only form of "cannot" worth relying on.
 */
@Injectable()
export class FleetFeatureService {
  /**
   * Creates an instance of FleetFeatureService.
   *
   * @param _settingsService - Reads the runtime master switch.
   * @param _configService - Reads the per-environment capability flags.
   */
  constructor(
    private readonly _settingsService: SettingsService,
    private readonly _configService: ConfigService,
  ) {}

  /**
   * Determines whether Fleet Community is switched on at all.
   *
   * Defaults to disabled, so an environment missing the setting keeps an
   * unfinished feature hidden rather than exposing it.
   *
   * @returns True when the feature is enabled.
   */
  isEnabled(): Promise<boolean> {
    return this._settingsService.getBoolean(
      FLEET_COMMUNITIES_ENABLED_SETTING_KEY,
      false,
    );
  }

  /**
   * Determines whether a specific capability is available.
   *
   * @param flag - The capability to check.
   * @returns True when Fleet Community is enabled and the capability is not disabled.
   */
  async isFlagEnabled(flag: FleetFeatureFlag): Promise<boolean> {
    if (!(await this.isEnabled())) {
      return false;
    }

    return this.readFlag(flag);
  }

  /**
   * Requires that a capability is available.
   *
   * Throws {@link NotFoundException} rather than a "disabled" error on purpose,
   * matching both Storytime and the Fleet authorisation policy: a feature that
   * is switched off should be indistinguishable from one that does not exist,
   * so a staged rollout does not advertise what is coming.
   *
   * @param flag - The capability required.
   * @throws NotFoundException when the capability is unavailable.
   */
  async assertFlagEnabled(flag: FleetFeatureFlag): Promise<void> {
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
    registrationEnabled: boolean;
    importsEnabled: boolean;
    chatEnabled: boolean;
  }> {
    const isEnabled = await this.isEnabled();

    return {
      isEnabled,
      registrationEnabled:
        isEnabled && this.readFlag(FLEET_FEATURE_FLAGS.REGISTRATION_ENABLED),
      importsEnabled:
        isEnabled && this.readFlag(FLEET_FEATURE_FLAGS.IMPORTS_ENABLED),
      chatEnabled: isEnabled && this.readFlag(FLEET_FEATURE_FLAGS.CHAT_ENABLED),
    };
  }

  /**
   * Reads a capability flag from configuration.
   *
   * Absent or unreadable values are treated as enabled: once Fleet Community
   * itself is on, its parts should work unless an environment has deliberately
   * said otherwise.
   *
   * @param flag - The capability to read.
   * @returns True unless configuration explicitly disables the capability.
   */
  private readFlag(flag: FleetFeatureFlag): boolean {
    const configured = this._configService.get<string | boolean>(flag);

    if (configured === undefined || configured === null) {
      return true;
    }

    return String(configured).trim().toLowerCase() !== 'false';
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SettingsService } from '../settings/settings.service';
import {
  CUSTOM_TRACKING_ENABLED_SETTING_KEY,
  CUSTOM_TRACKING_FEATURE_FLAGS,
  CustomTrackingFeatureFlag,
} from './constants/custom-tracking-feature.constants';

/**
 * Which parts of Custom Tracking are currently available.
 */
export interface CustomTrackingFeatureState {
  /** Whether the feature is switched on at all. */
  isEnabled: boolean;
  /** Whether anonymous visitors may read public custom content. */
  publicReadEnabled: boolean;
  /** Whether users may create and edit definitions. */
  definitionEditingEnabled: boolean;
  /** Whether users may record and edit values. */
  valueEditingEnabled: boolean;
  /** Whether image Fields may be uploaded to and rendered. */
  imagesEnabled: boolean;
  /** Whether YouTube Fields may be filled in and rendered. */
  youTubeEnabled: boolean;
}

/**
 * Whether Custom Tracking, and each part of it, is currently switched on.
 *
 * Two layers, deliberately different in kind, following the pattern Storytime
 * established. The master switch lives in the database so the feature can be
 * taken offline during an incident without a deployment — which matters here
 * because the feature stores content users write themselves. The capability
 * flags live in environment variables because they stage a rollout and vary by
 * environment rather than by minute.
 *
 * The master switch wins: with Custom Tracking disabled every capability
 * reports as off, so callers need only ask about the specific thing they are
 * about to do.
 */
@Injectable()
export class CustomTrackingFeatureService {
  /**
   * Creates an instance of CustomTrackingFeatureService.
   *
   * @param _settingsService - Reads the runtime master switch.
   * @param _configService - Reads the per-environment capability flags.
   */
  constructor(
    private readonly _settingsService: SettingsService,
    private readonly _configService: ConfigService,
  ) {}

  /**
   * Determines whether Custom Tracking is switched on at all.
   *
   * Defaults to disabled, so an environment missing the setting keeps an
   * unfinished feature hidden rather than exposing it.
   *
   * @returns True when the feature is enabled.
   */
  isEnabled(): Promise<boolean> {
    return this._settingsService.getBoolean(
      CUSTOM_TRACKING_ENABLED_SETTING_KEY,
      false,
    );
  }

  /**
   * Determines whether a specific capability is available.
   *
   * @param flag - The capability to check.
   * @returns True when the feature is enabled and the capability is not
   *   disabled.
   */
  async isFlagEnabled(flag: CustomTrackingFeatureFlag): Promise<boolean> {
    if (!(await this.isEnabled())) {
      return false;
    }

    return this.readFlag(flag);
  }

  /**
   * Requires that a capability is available.
   *
   * Throws {@link NotFoundException} rather than a "disabled" error on
   * purpose: a feature that is switched off should be indistinguishable from
   * one that does not exist, so a staged rollout does not advertise what is
   * coming.
   *
   * @param flag - The capability the caller is about to use.
   * @throws NotFoundException when the capability is unavailable.
   */
  async assertFlagEnabled(flag: CustomTrackingFeatureFlag): Promise<void> {
    if (!(await this.isFlagEnabled(flag))) {
      throw new NotFoundException('Not found');
    }
  }

  /**
   * Reads a capability flag from configuration.
   *
   * Absent or unreadable values are treated as enabled: once Custom Tracking
   * itself is on, its parts should work unless an environment has deliberately
   * said otherwise.
   *
   * Configuration may hand back a string or a boolean depending on how the
   * environment was loaded, and either may carry surrounding whitespace, so
   * both are reduced to text before the comparison. Testing a raw value
   * against the string 'false' would read a genuine boolean false as enabled.
   *
   * @param flag - The capability to read.
   * @returns True unless configuration explicitly disables the capability.
   */
  private readFlag(flag: CustomTrackingFeatureFlag): boolean {
    const configured = this._configService.get<string | boolean>(flag);

    if (configured === undefined || configured === null) {
      return true;
    }

    return String(configured).trim().toLowerCase() !== 'false';
  }

  /**
   * Reports the state of every capability.
   *
   * Served to the interface so it can hide what it cannot do, in one request
   * rather than one per flag.
   *
   * @returns Each capability flag and whether it is currently available.
   */
  async getState(): Promise<CustomTrackingFeatureState> {
    const isEnabled = await this.isEnabled();

    return {
      isEnabled,
      publicReadEnabled:
        isEnabled &&
        this.readFlag(CUSTOM_TRACKING_FEATURE_FLAGS.PUBLIC_READ_ENABLED),
      definitionEditingEnabled:
        isEnabled &&
        this.readFlag(CUSTOM_TRACKING_FEATURE_FLAGS.DEFINITION_EDITING_ENABLED),
      valueEditingEnabled:
        isEnabled &&
        this.readFlag(CUSTOM_TRACKING_FEATURE_FLAGS.VALUE_EDITING_ENABLED),
      imagesEnabled:
        isEnabled &&
        this.readFlag(CUSTOM_TRACKING_FEATURE_FLAGS.IMAGES_ENABLED),
      youTubeEnabled:
        isEnabled &&
        this.readFlag(CUSTOM_TRACKING_FEATURE_FLAGS.YOUTUBE_ENABLED),
    };
  }
}

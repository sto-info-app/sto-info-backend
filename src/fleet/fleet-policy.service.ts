import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  CHAT_MEMBER_HISTORY_HOURS,
  CHAT_TRANSCRIPT_HISTORY_DAYS,
  FLEET_CUSTOM_CHANNEL_LIMIT,
  PUBLISHED_CHAT_RETENTION_DAYS,
  PUBLISHED_IMPORT_SOURCE_RETENTION_DAYS,
} from './constants/fleet-policy.constants';

/**
 * The access and retention figures in force, as one answer.
 *
 * Three of the five are constants and are returned unchanged; two read from the
 * environment because R22 calls chat retention "environment configurable" and
 * R27 says import-source retention "starts at" 180 days. `ConfigCheckService`
 * has already refused a chat retention shorter than the transcript window at
 * startup, so by the time anything asks here the set is known to hold together.
 *
 * Deliberately separate from `FleetFeatureService`. Whether the feature is
 * switched on and how long a message is kept are different questions with
 * different audiences: a retention job must never be able to ask the first, and
 * must always be able to ask the second. Keeping them in one class would put
 * the kill switch within reach of everything that needs a retention window.
 */
@Injectable()
export class FleetPolicyService {
  private readonly _logger = new Logger(FleetPolicyService.name);

  /**
   * Creates an instance of FleetPolicyService.
   *
   * @param _configService - Reads the two configurable retention windows.
   */
  constructor(private readonly _configService: ConfigService) {}

  /** How far back ordinary chat history may be read, in hours (R22). */
  get chatMemberHistoryHours(): number {
    return CHAT_MEMBER_HISTORY_HOURS;
  }

  /** How far back a scope admin may export a transcript, in days (R22). */
  get chatTranscriptHistoryDays(): number {
    return CHAT_TRANSCRIPT_HISTORY_DAYS;
  }

  /** How many custom channels one scope may have, at each level (R20). */
  get customChannelLimit(): number {
    return FLEET_CUSTOM_CHANNEL_LIMIT;
  }

  /** How long ordinary chat messages are retained, in days (R22). */
  get chatRetentionDays(): number {
    return this.readDays('CHAT_RETENTION_DAYS', PUBLISHED_CHAT_RETENTION_DAYS);
  }

  /** How long a sanitised import source is retained, in days (R27). */
  get importSourceRetentionDays(): number {
    return this.readDays(
      'IMPORT_SOURCE_RETENTION_DAYS',
      PUBLISHED_IMPORT_SOURCE_RETENTION_DAYS,
    );
  }

  /**
   * Reads a configured number of days.
   *
   * An unreadable value falls back to the published figure rather than
   * throwing, because a mistyped environment variable must not be able to stop
   * a retention job from running — but it is logged, since a deployment silently
   * ignoring its own configuration is its own kind of failure. Startup
   * validation has already refused the values that would actually be unsafe.
   *
   * @param key - The environment variable.
   * @param publishedValue - The figure the policy states.
   * @returns The number of days in force.
   */
  private readDays(key: string, publishedValue: number): number {
    const configured = this._configService.get<string | number>(key);

    if (configured === undefined || configured === null) {
      return publishedValue;
    }

    const parsed = Number(configured);

    if (!Number.isInteger(parsed) || parsed < 1) {
      this._logger.warn(
        `Ignoring unreadable ${key} value '${String(configured)}'; using ${publishedValue}`,
      );

      return publishedValue;
    }

    return parsed;
  }
}

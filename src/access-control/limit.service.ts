import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { UserLimitOverrideEntity } from './entities/user-limit-override.entity';

/**
 * Resolves the numeric limits that apply to an individual user.
 *
 * Limits such as the maximum number of Stories a user may own are configured
 * globally, which is the right default and the wrong answer for a prolific
 * creator. An administrator may therefore grant a named user a different
 * ceiling, and every limit check in the application goes through this service
 * so an exemption applies everywhere rather than only where someone remembered
 * to look for one.
 *
 * Callers must not read limit values from configuration directly.
 */
@Injectable()
export class LimitService {
  private readonly _logger = new Logger(LimitService.name);

  /**
   * Creates an instance of LimitService.
   *
   * @param _overrideRepository - Repository used to read per-user exemptions.
   * @param _configService - Provides the deployment-wide default values.
   */
  constructor(
    @InjectRepository(UserLimitOverrideEntity)
    private readonly _overrideRepository: Repository<UserLimitOverrideEntity>,
    private readonly _configService: ConfigService,
  ) {}

  /**
   * Resolves the limit that applies to a user.
   *
   * A live, unexpired override wins. Otherwise the configured value is used,
   * falling back to the supplied default when configuration does not set one
   * or sets something that is not a non-negative integer.
   *
   * @param userId - The user the limit applies to.
   * @param key - The configuration key, such as `STORYTIME_MAX_STORIES_PER_USER`.
   * @param defaultValue - The value to use when nothing else is configured.
   * @returns The effective limit for this user.
   */
  async resolve(
    userId: string,
    key: string,
    defaultValue: number,
  ): Promise<number> {
    // Expressed as a query builder rather than find options because the
    // expiry test is a disjunction: an override applies when it has no expiry
    // at all, or when its expiry is still in the future.
    const override = await this._overrideRepository
      .createQueryBuilder('override')
      .select('override.limitValue', 'limitValue')
      .where('override."userId" = :userId', { userId })
      .andWhere('override."limitKey" = :key', { key })
      .andWhere('override."deletedAt" IS NULL')
      .andWhere(
        '(override."expiresAt" IS NULL OR override."expiresAt" > now())',
      )
      .getRawOne<{ limitValue: number }>();

    if (override) {
      return override.limitValue;
    }

    return this.readConfiguredValue(key, defaultValue);
  }

  /**
   * Requires that adding one more item would not exceed a user's limit.
   *
   * @param userId - The user the limit applies to.
   * @param key - The configuration key.
   * @param defaultValue - The value to use when nothing else is configured.
   * @param currentCount - How many the user already has.
   * @throws ForbiddenException when the limit has already been reached.
   */
  async assertWithinLimit(
    userId: string,
    key: string,
    defaultValue: number,
    currentCount: number,
  ): Promise<void> {
    const limit = await this.resolve(userId, key, defaultValue);

    if (currentCount < limit) {
      return;
    }

    this._logger.warn(
      `Limit reached: user ${userId} is at the ${key} limit of ${limit}`,
    );
    throw new ForbiddenException(
      `You have reached the maximum of ${limit} allowed. Contact an administrator if you need this raised.`,
    );
  }

  /**
   * Reads a limit from configuration.
   *
   * A misconfigured value falls back to the caller's default rather than
   * throwing, because a malformed environment variable must not be able to
   * take a feature offline — but it is logged, because silently ignoring
   * configuration is its own kind of failure.
   *
   * @param key - The configuration key.
   * @param defaultValue - The value to use when configuration is absent or invalid.
   * @returns The configured limit, or the default.
   */
  private readConfiguredValue(key: string, defaultValue: number): number {
    const configured = this._configService.get<string | number>(key);

    if (configured === undefined || configured === null) {
      return defaultValue;
    }

    const parsed = Number(configured);

    if (!Number.isInteger(parsed) || parsed < 0) {
      this._logger.warn(
        `Ignoring invalid ${key} value '${String(configured)}'; using ${defaultValue}`,
      );
      return defaultValue;
    }

    return parsed;
  }
}

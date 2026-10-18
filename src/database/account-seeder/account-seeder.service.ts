import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { LauncherEntity } from 'src/sto/launcher/entities/launcher.entity';
import { LauncherService } from 'src/sto/launcher/launcher.service';
import { PlatformLauncherService } from 'src/sto/platform-launcher/platform-launcher.service';
import { CreatePlatformDto } from 'src/sto/platform/dto/create-platform.dto';
import { PlatformEntity } from 'src/sto/platform/entities/platform.entity';
import { PlatformService } from 'src/sto/platform/platform.service';

import { ACCOUNT_BACKGROUNDS } from './account-backgrounds.constants';

/**
 * Handles seeding of account-related reference data.
 *
 * This service is responsible for populating the database with platform, launcher,
 * and platform-launcher relationship data during application initialization. It uses
 * an idempotent seeding approach, only creating records that do not already exist,
 * allowing the application to be restarted safely without duplicate data.
 *
 * Platforms: Windows, PlayStation, Xbox — each with whether the game
 * provides a fleet roster export on it
 * Launchers: Arc, Epic, Steam, N/A
 * Account card pictures: one for each pairing, each platform and everything
 * else, given to rows that have none
 *
 * @injectable
 */
@Injectable()
export class AccountSeederService {
  private readonly _logger = new Logger(AccountSeederService.name);

  /**
   * Creates an instance of AccountSeederService.
   *
   * @param _platformService - Service for managing platform entities.
   * @param _launcherService - Service for managing launcher entities.
   * @param _platformLauncherService - Service for managing platform-launcher relationships.
   */
  constructor(
    private readonly _platformService: PlatformService,
    private readonly _launcherService: LauncherService,
    private readonly _platformLauncherService: PlatformLauncherService,
  ) {}

  /**
   * Executes all account-related seeding operations.
   *
   * Seeds platforms, launchers, and platform-launcher relationships in order.
   * Each operation is idempotent and only creates missing records.
   *
   * @throws {Error} If any seeding operation encounters an unexpected database error.
   * @returns {Promise<void>}
   *
   * @example
   * ```typescript
   * await accountSeederService.seed();
   * // Platforms, launchers, and relationships are now in the database
   * ```
   */
  async seed() {
    await this.seedPlatforms();
    await this.seedLaunchers();
    await this.seedPlatformLaunchers();
    await this.seedBackgrounds();
  }

  /**
   * Seeds platform reference data.
   *
   * Creates Windows, PlayStation, and Xbox platforms if they do not already exist.
   * This is an idempotent operation and can be safely re-run.
   *
   * Each carries whether the game provides a fleet roster export on it, which
   * today is Windows and neither console. Only new rows are written: an
   * existing catalogue was corrected by the migration that added the column,
   * and a seeder that overwrote it on every boot would undo whoever changed
   * it when the game changed.
   *
   * @private
   * @throws {Error} If platform creation fails unexpectedly.
   * @returns {Promise<void>}
   */
  private async seedPlatforms() {
    const platforms: CreatePlatformDto[] = [
      { name: 'Windows', providesRosterExport: true },
      { name: 'PlayStation', providesRosterExport: false },
      { name: 'Xbox', providesRosterExport: false },
    ];
    for (const platform of platforms) {
      const existingPlatform = await this.findPlatformByName(platform.name);
      if (!existingPlatform) {
        await this._platformService.create(platform);
      }
    }
  }

  /**
   * Seeds launcher reference data.
   *
   * Creates Arc, Epic, Steam, and N/A launchers if they do not already exist.
   * This is an idempotent operation and can be safely re-run.
   *
   * @private
   * @throws {Error} If launcher creation fails unexpectedly.
   * @returns {Promise<void>}
   */
  private async seedLaunchers() {
    const launchers = ['Arc', 'Epic', 'Steam', 'N/A'];
    for (const launcher of launchers) {
      const existingLauncher = await this.findLauncherByName(launcher);
      if (!existingLauncher) {
        await this._launcherService.create({ name: launcher });
      }
    }
  }

  /**
   * Seeds platform-launcher relationship data.
   *
   * Creates associations between platforms and launchers:
   * - Windows: Arc, Epic, Steam, N/A
   * - PlayStation: N/A
   * - Xbox: N/A
   *
   * This is an idempotent operation and only creates relationships that do not already exist.
   *
   * @private
   * @throws {Error} If relationship creation fails unexpectedly.
   * @returns {Promise<void>}
   */
  private async seedPlatformLaunchers() {
    const platformLauncherCombinations = [
      { platform: 'Windows', launcher: 'Arc' },
      { platform: 'Windows', launcher: 'Epic' },
      { platform: 'Windows', launcher: 'Steam' },
      { platform: 'Windows', launcher: 'N/A' },
      { platform: 'PlayStation', launcher: 'N/A' },
      { platform: 'Xbox', launcher: 'N/A' },
    ];

    for (const combo of platformLauncherCombinations) {
      const platform = await this.findPlatformByName(combo.platform);
      const launcher = await this.findLauncherByName(combo.launcher);

      if (platform && launcher) {
        const existingCombo = await this.findPlatformLauncherRelation(
          platform.id,
          launcher.id,
        );
        if (!existingCombo) {
          await this._platformLauncherService.addPlatformLauncherRelation(
            platform.id,
            launcher.id,
          );
        }
      }
    }
  }

  /**
   * Gives each account card picture to its row.
   *
   * Runs after the pairings exist, which is what the migration that added
   * the pictures could not count on: on a new database it ran before them and
   * matched nothing. A row with no picture is given one and a missing default
   * row is made, while a picture already set is left alone, so one changed
   * by hand stays changed. A picture whose platform or launcher is not in the
   * catalogue is skipped.
   *
   * @private
   * @returns {Promise<void>}
   */
  private async seedBackgrounds() {
    let created = 0;
    let filled = 0;

    for (const background of ACCOUNT_BACKGROUNDS) {
      const platform =
        background.platform === null
          ? null
          : await this.findPlatformByName(background.platform);
      const launcher =
        background.launcher === null
          ? null
          : await this.findLauncherByName(background.launcher);

      if (
        (background.platform !== null && !platform) ||
        (background.launcher !== null && !launcher)
      ) {
        continue;
      }

      const outcome = await this._platformLauncherService.ensureBackground(
        platform?.id ?? null,
        launcher?.id ?? null,
        background.url,
      );

      if (outcome === 'created') created++;
      if (outcome === 'filled') filled++;
    }

    if (created > 0 || filled > 0) {
      this._logger.log(
        `[seedBackgrounds] Account card pictures set - Created: ${created}, Filled: ${filled}`,
      );
    }
  }

  /**
   * Attempts to find an existing platform by name.
   *
   * Returns null if the platform does not exist, allowing the seeder to create it.
   * This helper abstracts the exception handling for the find operation.
   *
   * @private
   * @param name - The name of the platform to find.
   * @throws {Error} If a database error occurs (other than "not found").
   * @returns {Promise<PlatformEntity | null>} The platform entity or null if not found.
   */
  private async findPlatformByName(
    name: string,
  ): Promise<PlatformEntity | null> {
    try {
      return await this._platformService.findOneByName(name);
    } catch (error) {
      if (error instanceof NotFoundException) {
        return null;
      }

      throw error;
    }
  }

  /**
   * Attempts to find an existing launcher by name.
   *
   * Returns null if the launcher does not exist, allowing the seeder to create it.
   * This helper abstracts the exception handling for the find operation.
   *
   * @private
   * @param name - The name of the launcher to find.
   * @throws {Error} If a database error occurs (other than "not found").
   * @returns {Promise<LauncherEntity | null>} The launcher entity or null if not found.
   */
  private async findLauncherByName(
    name: string,
  ): Promise<LauncherEntity | null> {
    try {
      return await this._launcherService.findOneByName(name);
    } catch (error) {
      if (error instanceof NotFoundException) {
        return null;
      }

      throw error;
    }
  }

  /**
   * Attempts to find an existing platform-launcher relationship.
   *
   * Returns null if the relationship does not exist, allowing the seeder to create it.
   * This helper abstracts the exception handling for the find operation.
   *
   * @private
   * @param platformId - The UUID of the platform.
   * @param launcherId - The UUID of the launcher.
   * @throws {Error} If a database error occurs (other than "not found").
   * @returns {Promise<any | null>} The relationship entity or null if not found.
   */
  private async findPlatformLauncherRelation(
    platformId: string,
    launcherId: string,
  ) {
    try {
      return await this._platformLauncherService.findOne(
        platformId,
        launcherId,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        return null;
      }

      throw error;
    }
  }
}

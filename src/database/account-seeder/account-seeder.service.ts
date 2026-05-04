import { Injectable, NotFoundException } from '@nestjs/common';
import { LauncherEntity } from 'src/sto/launcher/entities/launcher.entity';
import { LauncherService } from 'src/sto/launcher/launcher.service';
import { PlatformLauncherService } from 'src/sto/platform-launcher/platform-launcher.service';
import { PlatformEntity } from 'src/sto/platform/entities/platform.entity';
import { PlatformService } from 'src/sto/platform/platform.service';

/**
 * Handles seeding of account-related reference data.
 *
 * This service is responsible for populating the database with platform, launcher,
 * and platform-launcher relationship data during application initialization. It uses
 * an idempotent seeding approach, only creating records that do not already exist,
 * allowing the application to be restarted safely without duplicate data.
 *
 * Platforms: Windows, PlayStation, Xbox
 * Launchers: Arc, Epic, Steam, N/A
 *
 * @injectable
 */
@Injectable()
export class AccountSeederService {
  /**
   * Creates an instance of AccountSeederService.
   *
   * @param platformService - Service for managing platform entities.
   * @param launcherService - Service for managing launcher entities.
   * @param platformLauncherService - Service for managing platform-launcher relationships.
   */
  constructor(
    private readonly platformService: PlatformService,
    private readonly launcherService: LauncherService,
    private readonly platformLauncherService: PlatformLauncherService,
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
  }

  /**
   * Seeds platform reference data.
   *
   * Creates Windows, PlayStation, and Xbox platforms if they do not already exist.
   * This is an idempotent operation and can be safely re-run.
   *
   * @private
   * @throws {Error} If platform creation fails unexpectedly.
   * @returns {Promise<void>}
   */
  private async seedPlatforms() {
    const platforms = ['Windows', 'PlayStation', 'Xbox'];
    for (const platform of platforms) {
      const existingPlatform = await this.findPlatformByName(platform);
      if (!existingPlatform) {
        await this.platformService.create({ name: platform });
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
        await this.launcherService.create({ name: launcher });
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
          await this.platformLauncherService.addPlatformLauncherRelation(
            platform.id,
            launcher.id,
          );
        }
      }
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
      return await this.platformService.findOneByName(name);
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
      return await this.launcherService.findOneByName(name);
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
      return await this.platformLauncherService.findOne(platformId, launcherId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        return null;
      }

      throw error;
    }
  }
}

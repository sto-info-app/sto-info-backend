import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LauncherEntity } from 'src/sto/launcher/entities/launcher.entity';
import { LauncherModule } from 'src/sto/launcher/launcher.module';
import { PlatformLauncherEntity } from 'src/sto/platform-launcher/entities/platform-launcher.entity';
import { PlatformLauncherModule } from 'src/sto/platform-launcher/platform-launcher.module';
import { PlatformEntity } from 'src/sto/platform/entities/platform.entity';
import { PlatformModule } from 'src/sto/platform/platform.module';
import { UserEntity } from 'src/user/entities/user.entity';
import { UserModule } from 'src/user/user.module';
import { AccountSeederService } from './account-seeder/account-seeder.service';
import { DatabaseService } from './database.service';
import { UserSeederService } from './user-seeder/user-seeder.service';

/**
 * Core database module that orchestrates schema initialization and data seeding.
 *
 * This module handles the complete database setup lifecycle:
 * 1. Verifies the database is ready and migrations have been applied
 * 2. Configures the session timezone to UTC
 * 3. Seeds initial reference data (users, platforms, launchers)
 *
 * All seeding operations are performed during module initialization and are logged
 * appropriately. Seeding failures are logged but do not block startup (except for
 * readiness check failures, which are fatal to prevent corrupted data states).
 *
 * @module
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PlatformEntity,
      LauncherEntity,
      PlatformLauncherEntity,
      UserEntity,
      //NOTE: Add other entities used in seeder services
    ]),

    PlatformModule,
    LauncherModule,
    PlatformLauncherModule,
    UserModule,
    //NOTE: Add other modules used in seeder services
  ],
  providers: [
    AccountSeederService,
    UserSeederService,
    DatabaseService,
    //NOTE: Add other seeder services here
  ],
  exports: [
    AccountSeederService,
    UserSeederService,
    DatabaseService,
    //NOTE: Add other seeder services here
  ],
})
/**
 * DatabaseModule lifecycle handler.
 *
 * Implements {@link OnModuleInit} to run database readiness checks and seeding
 * during the NestJS module initialization phase.
 */
export class DatabaseModule implements OnModuleInit {
  /**
   * Creates an instance of DatabaseModule.
   *
   * @param _databaseService - Service for database readiness and configuration.
   * @param _userSeederService - Service for seeding user reference data.
   * @param _accountSeederService - Service for seeding account reference data (platforms, launchers).
   */
  constructor(
    private readonly _databaseService: DatabaseService,
    private readonly _userSeederService: UserSeederService,
    private readonly _accountSeederService: AccountSeederService,
  ) {}

  /**
   * Initializes the database during module startup.
   *
   * Executes in the following order:
   * 1. Asserts database readiness (throws if migrations have not been applied)
   * 2. Sets session timezone to UTC
   * 3. Seeds user reference data
   * 4. Seeds account reference data (platforms, launchers)
   *
   * Seeding failures are logged but do not interrupt subsequent seeding operations,
   * allowing the application to start even if some seed data cannot be created
   * (e.g., if it already exists).
   *
   * @throws {ServiceUnavailableException} If the database readiness check fails,
   *         indicating that migrations must be run before startup can continue.
   * @returns {Promise<void>}
   *
   * @example
   * ```typescript
   * // Called automatically by NestJS during module initialization
   * // No explicit call required
   * ```
   */
  async onModuleInit() {
    try {
      await this._databaseService.assertDatabaseReadyForSeeding();
      Logger.log('Database readiness check passed.', 'DatabaseModule');
    } catch (error) {
      Logger.error(
        'Database is not ready for seeding:',
        error,
        'DatabaseModule',
      );
      throw error;
    }

    try {
      await this._databaseService.setDatabaseTimezone();
      Logger.log('Database timezone set successfully.', 'DatabaseModule');
    } catch (error) {
      Logger.error('Failed to set database timezone:', error, 'DatabaseModule');
    }

    try {
      await this._userSeederService.seed();
      Logger.log('User seeding completed successfully.', 'DatabaseModule');
    } catch (error) {
      Logger.error('Failed to seed users:', error, 'DatabaseModule');
    }

    try {
      await this._accountSeederService.seed();
      Logger.log('Account seeding completed successfully.', 'DatabaseModule');
    } catch (error) {
      Logger.error('Failed to seed accounts:', error, 'DatabaseModule');
    }

    //NOTE: Add other seeder function calls here
  }
}

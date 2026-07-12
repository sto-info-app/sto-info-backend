import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Handles database connectivity and initialization operations.
 *
 * This service provides core database operations required during application startup,
 * including readiness verification and timezone configuration. It ensures the database
 * schema is properly migrated before any seeding operations commence.
 *
 * @injectable
 */
@Injectable()
export class DatabaseService {
  /**
   * List of required tables that must exist in the sto_info_app schema before seeding.
   * If any of these tables are missing, seeding will not proceed.
   *
   * @private
   * @readonly
   */
  private static readonly _requiredSeedTables = [
    'user',
    'platform',
    'launcher',
    'platform_launcher',
  ] as const;

  /**
   * Creates an instance of DatabaseService.
   *
   * @param _dataSource - The TypeORM DataSource for executing database queries.
   */
  constructor(private readonly _dataSource: DataSource) {}

  /**
   * Verifies that the database is ready for seeding operations.
   *
   * This method performs two critical checks:
   * 1. Validates that the database connection is active and resolvable
   * 2. Confirms that all required seed tables exist in the sto_info_app schema
   *
   * If either check fails, a ServiceUnavailableException is thrown with guidance
   * to run the migration command.
   *
   * @throws {ServiceUnavailableException} If the database is not connected, resolvable, or missing required tables.
   * @returns {Promise<void>}
   *
   * @example
   * ```typescript
   * await databaseService.assertDatabaseReadyForSeeding();
   * // Throws ServiceUnavailableException with migration hint if tables are missing
   * ```
   */
  async assertDatabaseReadyForSeeding(): Promise<void> {
    const [databaseRow] = (await this._dataSource.query(
      'SELECT current_database() AS "databaseName"',
    )) as Array<{ databaseName?: string }>;

    if (!databaseRow?.databaseName) {
      throw new ServiceUnavailableException(
        'Database is not ready for seeding. Execute `npm run migration:run` before starting the application.',
      );
    }

    const tableRows = (await this._dataSource.query(
      `SELECT table_name AS "tableName"
       FROM information_schema.tables
       WHERE table_schema = 'sto_info_app'
         AND table_name IN ('user', 'platform', 'launcher', 'platform_launcher')`,
    )) as Array<{ tableName?: string }>;

    const existingTables = new Set(
      tableRows
        .map(tableRow => tableRow.tableName)
        .filter((tableName): tableName is string => Boolean(tableName)),
    );

    const missingTables = DatabaseService._requiredSeedTables.filter(
      tableName => !existingTables.has(tableName),
    );

    if (missingTables.length > 0) {
      throw new ServiceUnavailableException(
        `Database schema is not ready for seeding. Missing tables in schema sto_info_app: ${missingTables.join(', ')}. Execute \`npm run migration:run\` before starting the application.`,
      );
    }
  }

  /**
   * Sets the current session timezone to UTC.
   *
   * All database operations in the active session will use UTC for timestamp handling.
   * This ensures consistent behavior across different server deployments regardless of
   * the system timezone.
   *
   * @throws {Error} If the timezone cannot be set on the current database connection.
   * @returns {Promise<void>}
   *
   * @example
   * ```typescript
   * await databaseService.setDatabaseTimezone();
   * // All timestamp columns will now use UTC
   * ```
   */
  async setDatabaseTimezone(): Promise<void> {
    await this._dataSource.query("SET TIME ZONE 'UTC'");
  }
}

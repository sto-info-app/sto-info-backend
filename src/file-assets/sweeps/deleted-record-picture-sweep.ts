import { Logger, OnApplicationBootstrap } from '@nestjs/common';

import { DataSource, EntityTarget, ObjectLiteral } from 'typeorm';

import { FileAssetState } from '../enums/file-asset-state.enum';

/** The states in which a picture is still served. */
export const SERVED_PICTURE_STATES: readonly FileAssetState[] = [
  FileAssetState.AVAILABLE,
  FileAssetState.UNVERIFIED,
];

/**
 * Withdraws, at every start, the pictures deleted records still hold.
 *
 * Deleting a record withdraws its pictures as it goes. A sweep catches the
 * rest: the pictures of records deleted before their deletion withdrew
 * anything, and any picture whose withdrawal failed after its record had
 * gone. A deleted record can never be brought back, so nothing is lost by it.
 *
 * It runs in the background so it never holds the start up, and instances
 * starting together take turns through a PostgreSQL advisory lock. Each
 * picture is withdrawn on its own; one that fails is logged and found again
 * at the next start. What a subclass adds is the search, and how one of its
 * pictures is withdrawn.
 *
 * @typeParam T - What the search finds for each picture.
 */
export abstract class DeletedRecordPictureSweep<
  T,
> implements OnApplicationBootstrap {
  protected readonly _logger = new Logger(this.constructor.name);

  /**
   * Creates the sweep.
   *
   * @param _dataSource - The database, for the search and the lock.
   * @param _lock - The advisory lock one run holds.
   * @param _label - What the log calls the pictures, such as "Deleted
   *   Storytime artwork".
   */
  protected constructor(
    protected readonly _dataSource: DataSource,
    private readonly _lock: number,
    private readonly _label: string,
  ) {}

  /**
   * Starts a run without holding the start up.
   */
  onApplicationBootstrap(): void {
    void this.run();
  }

  /**
   * Takes the lock and sweeps, once.
   *
   * Errors are caught and logged: a sweep that fails is tried again at the
   * next start, and must never take the process down.
   *
   * @returns How many pictures were withdrawn, or null when another instance
   *   held the lock or the run failed.
   */
  async run(): Promise<number | null> {
    const runner = this._dataSource.createQueryRunner();

    try {
      await runner.connect();

      const [{ locked }] = (await runner.query(
        'SELECT pg_try_advisory_lock($1::bigint) AS "locked"',
        [this._lock],
      )) as Array<{ locked: boolean }>;

      if (!locked) {
        return null;
      }

      try {
        return await this.sweep();
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1::bigint)', [
          this._lock,
        ]);
      }
    } catch (error: unknown) {
      this._logger.error(
        `[run] ${this._label} not swept`,
        error instanceof Error ? error.stack : String(error),
      );

      return null;
    } finally {
      await runner.release();
    }
  }

  /**
   * Withdraws every picture a deleted record still holds.
   *
   * @returns How many were withdrawn.
   */
  async sweep(): Promise<number> {
    const pictures = await this.findPictures();
    let withdrawn = 0;

    for (const picture of pictures) {
      try {
        await this.withdraw(picture);
        withdrawn += 1;
      } catch (error: unknown) {
        this._logger.error(
          `[sweep] Not withdrawn - ${this.describe(picture)}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    if (pictures.length > 0) {
      this._logger.log(
        `[sweep] ${this._label} withdrawn - Withdrawn: ${withdrawn}, Failed: ${pictures.length - withdrawn}`,
      );
    }

    return withdrawn;
  }

  /**
   * Finds the pictures deleted records still hold that are still served.
   *
   * @returns Each picture, with whatever withdrawing it needs.
   */
  abstract findPictures(): Promise<T[]>;

  /**
   * Withdraws one picture, throwing when it could not.
   *
   * @param picture - The picture.
   */
  protected abstract withdraw(picture: T): Promise<void>;

  /**
   * Names a picture in the log.
   *
   * @param picture - The picture.
   * @returns Its slot, record and reference, for the log line.
   */
  protected abstract describe(picture: T): string;

  /**
   * An entity's table, quoted, with its schema when it has one.
   *
   * @param entity - The entity.
   * @returns The name, for raw SQL.
   */
  protected tableOf(entity: EntityTarget<ObjectLiteral>): string {
    const metadata = this._dataSource.getMetadata(entity);

    return metadata.schema
      ? `"${metadata.schema}"."${metadata.tableName}"`
      : `"${metadata.tableName}"`;
  }
}

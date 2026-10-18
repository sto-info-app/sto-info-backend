import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

import { DataSource, EntityTarget, ObjectLiteral } from 'typeorm';

import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';

import { StorytimeArcEntity } from '../arcs/entities/storytime-arc.entity';
import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { StorytimeCharacterEntity } from '../characters/entities/storytime-character.entity';
import { STORYTIME_DELETION_REASONS } from '../constants/storytime-deletion.constants';
import { StorytimeImageSlot } from '../enums/storytime-image-slot.enum';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeImageService } from './storytime-image.service';

/** The PostgreSQL advisory lock one run holds, so instances take turns. */
export const STORYTIME_DELETED_ARTWORK_SWEEP_LOCK = 1_798_200_000;

/** A picture a deleted work still holds, and why it should go. */
export interface DeletedWorkPicture {
  /** Which slot it fills. */
  readonly slot: StorytimeImageSlot;
  /** The Story, Chapter, Character or Arc it belongs to. */
  readonly entityId: string;
  /** Its delivery reference. */
  readonly imageId: string;
  /** The reason the registry records. */
  readonly reason: string;
}

/** The states in which a picture is still served. */
const SERVED_STATES = [FileAssetState.AVAILABLE, FileAssetState.UNVERIFIED];

/**
 * Withdraws, at every start, the pictures deleted Storytime work still holds.
 *
 * Deleting a Story, a Chapter, a Character or an Arc withdraws its pictures
 * as it goes. This catches the rest: the pictures of work deleted before
 * deletion withdrew anything (Stories and Arcs deleted before 18 October
 * 2026 kept their banners, profile images, covers and portraits), and any
 * picture whose withdrawal failed after its work had been deleted. A deleted work can never be brought back,
 * so nothing is lost by it.
 *
 * It runs in the background so it never holds the start up, and instances
 * starting together take turns through a PostgreSQL advisory lock. Each
 * picture is withdrawn on its own; one that fails is logged and found again
 * at the next start.
 */
@Injectable()
export class StorytimeDeletedArtworkSweepService implements OnApplicationBootstrap {
  private readonly _logger = new Logger(
    StorytimeDeletedArtworkSweepService.name,
  );

  /**
   * Creates an instance of StorytimeDeletedArtworkSweepService.
   *
   * @param _dataSource - The database, for the search and the lock.
   * @param _images - Withdraws each picture.
   */
  constructor(
    private readonly _dataSource: DataSource,
    private readonly _images: StorytimeImageService,
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
        [STORYTIME_DELETED_ARTWORK_SWEEP_LOCK],
      )) as Array<{ locked: boolean }>;

      if (!locked) {
        return null;
      }

      try {
        return await this.sweep();
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1::bigint)', [
          STORYTIME_DELETED_ARTWORK_SWEEP_LOCK,
        ]);
      }
    } catch (error: unknown) {
      this._logger.error(
        '[run] Deleted Storytime artwork not swept',
        error instanceof Error ? error.stack : String(error),
      );

      return null;
    } finally {
      await runner.release();
    }
  }

  /**
   * Withdraws every picture a deleted work still holds.
   *
   * @returns How many were withdrawn.
   */
  async sweep(): Promise<number> {
    const pictures = await this.findPictures();
    let withdrawn = 0;

    for (const picture of pictures) {
      try {
        await this._images.withdraw(
          picture.slot,
          picture.entityId,
          picture.imageId,
          picture.reason,
        );
        withdrawn += 1;
      } catch (error: unknown) {
        this._logger.error(
          `[sweep] Not withdrawn - Slot: ${picture.slot}, EntityId: ${picture.entityId}, ImageId: ${picture.imageId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    if (pictures.length > 0) {
      this._logger.log(
        `[sweep] Deleted Storytime artwork withdrawn - Withdrawn: ${withdrawn}, Failed: ${pictures.length - withdrawn}`,
      );
    }

    return withdrawn;
  }

  /**
   * Finds the pictures deleted work still holds that are still served.
   *
   * A Chapter or Character deleted with its Story records the Story's
   * deletion as the reason; one deleted on its own records its own.
   *
   * @returns Each picture, with its slot, its work and its reason.
   */
  async findPictures(): Promise<DeletedWorkPicture[]> {
    const story = this.tableOf(StorytimeStoryEntity);
    const chapter = this.tableOf(StorytimeChapterEntity);
    const character = this.tableOf(StorytimeCharacterEntity);
    const arc = this.tableOf(StorytimeArcEntity);
    const asset = this.tableOf(FileAssetEntity);

    return (await this._dataSource.query(
      `
      SELECT picture."slot", picture."entityId", picture."imageId", picture."reason"
        FROM (
          SELECT $1::text AS "slot", s."id"::text AS "entityId", s."bannerImageId"::text AS "imageId", $5::text AS "reason"
            FROM ${story} s
           WHERE s."deletedAt" IS NOT NULL AND s."bannerImageId" IS NOT NULL
          UNION ALL
          SELECT $2::text, s."id"::text, s."profileImageId"::text, $5::text
            FROM ${story} s
           WHERE s."deletedAt" IS NOT NULL AND s."profileImageId" IS NOT NULL
          UNION ALL
          SELECT $3::text, c."id"::text, c."coverImageId"::text,
                 CASE WHEN s."deletedAt" IS NOT NULL THEN $5::text ELSE $6::text END
            FROM ${chapter} c
            JOIN ${story} s ON s."id" = c."storyId"
           WHERE c."deletedAt" IS NOT NULL AND c."coverImageId" IS NOT NULL
          UNION ALL
          SELECT $4::text, ch."id"::text, ch."portraitImageId"::text,
                 CASE WHEN s."deletedAt" IS NOT NULL THEN $5::text ELSE $7::text END
            FROM ${character} ch
            JOIN ${story} s ON s."id" = ch."storyId"
           WHERE ch."deletedAt" IS NOT NULL AND ch."portraitImageId" IS NOT NULL
          UNION ALL
          SELECT $9::text, r."id"::text, r."bannerImageId"::text, $11::text
            FROM ${arc} r
           WHERE r."deletedAt" IS NOT NULL AND r."bannerImageId" IS NOT NULL
          UNION ALL
          SELECT $10::text, r."id"::text, r."profileImageId"::text, $11::text
            FROM ${arc} r
           WHERE r."deletedAt" IS NOT NULL AND r."profileImageId" IS NOT NULL
        ) picture
        JOIN ${asset} a ON a."deliveryReference" = picture."imageId"
       WHERE a."state"::text = ANY($8::text[])
       ORDER BY picture."slot", picture."entityId"
      `,
      [
        StorytimeImageSlot.STORY_BANNER,
        StorytimeImageSlot.STORY_PROFILE,
        StorytimeImageSlot.CHAPTER_COVER,
        StorytimeImageSlot.CHARACTER_PORTRAIT,
        STORYTIME_DELETION_REASONS.STORY,
        STORYTIME_DELETION_REASONS.CHAPTER,
        STORYTIME_DELETION_REASONS.CHARACTER,
        SERVED_STATES,
        StorytimeImageSlot.ARC_BANNER,
        StorytimeImageSlot.ARC_PROFILE,
        STORYTIME_DELETION_REASONS.ARC,
      ],
    )) as DeletedWorkPicture[];
  }

  /**
   * An entity's table, quoted, with its schema when it has one.
   *
   * @param entity - The entity.
   * @returns The name, for raw SQL.
   */
  private tableOf(entity: EntityTarget<ObjectLiteral>): string {
    const metadata = this._dataSource.getMetadata(entity);

    return metadata.schema
      ? `"${metadata.schema}"."${metadata.tableName}"`
      : `"${metadata.tableName}"`;
  }
}

import { Injectable } from '@nestjs/common';

import { DataSource } from 'typeorm';

import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import {
  DeletedRecordPictureSweep,
  SERVED_PICTURE_STATES,
} from 'src/file-assets/sweeps/deleted-record-picture-sweep';

import { StorytimeArcEntity } from '../arcs/entities/storytime-arc.entity';
import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { StorytimeCharacterEntity } from '../characters/entities/storytime-character.entity';
import { STORYTIME_DELETION_REASONS } from '../constants/storytime-deletion.constants';
import { StorytimeImageSlot } from '../enums/storytime-image-slot.enum';
import { StorytimeSpotlightEntity } from '../spotlight/entities/storytime-spotlight.entity';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeImageService } from './storytime-image.service';

/** The PostgreSQL advisory lock one run holds, so instances take turns. */
export const STORYTIME_DELETED_ARTWORK_SWEEP_LOCK = 1_798_200_000;

/** A picture a deleted work still holds, and why it should go. */
export interface DeletedWorkPicture {
  /** Which slot it fills. */
  readonly slot: StorytimeImageSlot;
  /** The Story, Chapter, Character, Arc or Spotlight entry it belongs to. */
  readonly entityId: string;
  /** Its delivery reference. */
  readonly imageId: string;
  /** The reason the registry records. */
  readonly reason: string;
}

/**
 * Withdraws, at every start, the pictures deleted Storytime work still holds.
 *
 * Deleting a Story, a Chapter, a Character, an Arc or a Spotlight entry
 * withdraws its pictures as it goes. This catches the rest: the pictures of
 * work deleted before deletion withdrew anything (Stories, Arcs and
 * Spotlight entries deleted before 18 October 2026 kept their banners,
 * profile images, covers, portraits and artwork), and any picture whose
 * withdrawal failed after its work had been deleted.
 */
@Injectable()
export class StorytimeDeletedArtworkSweepService extends DeletedRecordPictureSweep<DeletedWorkPicture> {
  /**
   * Creates an instance of StorytimeDeletedArtworkSweepService.
   *
   * @param dataSource - The database, for the search and the lock.
   * @param _images - Withdraws each picture.
   */
  constructor(
    dataSource: DataSource,
    private readonly _images: StorytimeImageService,
  ) {
    super(
      dataSource,
      STORYTIME_DELETED_ARTWORK_SWEEP_LOCK,
      'Deleted Storytime artwork',
    );
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
    const spotlight = this.tableOf(StorytimeSpotlightEntity);
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
          UNION ALL
          SELECT $12::text, sp."id"::text, sp."overrideImageId"::text, $13::text
            FROM ${spotlight} sp
           WHERE sp."deletedAt" IS NOT NULL AND sp."overrideImageId" IS NOT NULL
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
        SERVED_PICTURE_STATES,
        StorytimeImageSlot.ARC_BANNER,
        StorytimeImageSlot.ARC_PROFILE,
        STORYTIME_DELETION_REASONS.ARC,
        StorytimeImageSlot.SPOTLIGHT_OVERRIDE,
        STORYTIME_DELETION_REASONS.SPOTLIGHT,
      ],
    )) as DeletedWorkPicture[];
  }

  /**
   * Withdraws one picture with the reason found for it.
   *
   * @param picture - The picture.
   */
  protected async withdraw(picture: DeletedWorkPicture): Promise<void> {
    await this._images.withdraw(
      picture.slot,
      picture.entityId,
      picture.imageId,
      picture.reason,
    );
  }

  /**
   * Names a picture in the log.
   *
   * @param picture - The picture.
   * @returns Its slot, work and reference.
   */
  protected describe(picture: DeletedWorkPicture): string {
    return `Slot: ${picture.slot}, EntityId: ${picture.entityId}, ImageId: ${picture.imageId}`;
  }
}

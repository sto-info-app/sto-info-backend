import { Injectable } from '@nestjs/common';

import { DataSource } from 'typeorm';

import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import {
  DeletedRecordPictureSweep,
  SERVED_PICTURE_STATES,
} from 'src/file-assets/sweeps/deleted-record-picture-sweep';

import { CustomTrackingFieldEntity } from '../entities/custom-tracking-field.entity';
import { CustomTrackingImageValueEntity } from '../entities/custom-tracking-image-value.entity';
import { CustomTrackingValueEntity } from '../entities/custom-tracking-value.entity';
import {
  CustomTrackingFieldPicture,
  CustomTrackingFieldPictureService,
} from './custom-tracking-field-picture.service';

/** The PostgreSQL advisory lock one run holds, so instances take turns. */
export const DELETED_CUSTOM_TRACKING_PICTURE_SWEEP_LOCK = 1_798_400_000;

/**
 * Withdraws, at every start, the pictures deleted Custom Tracking Fields
 * still hold.
 *
 * Deleting a Field, a Tab or a Section withdraws its pictures as it goes.
 * This catches the rest: those of Fields deleted before 19 October 2026,
 * which kept their pictures published until the retention purge, and any
 * picture whose withdrawal failed after its answer had gone. A Field deleted
 * with its Tab or Section carries the same deletion, so asking the Field is
 * enough.
 */
@Injectable()
export class DeletedCustomTrackingPictureSweepService extends DeletedRecordPictureSweep<CustomTrackingFieldPicture> {
  /**
   * Creates an instance of DeletedCustomTrackingPictureSweepService.
   *
   * @param dataSource - The database, for the search and the lock.
   * @param _pictures - Removes each picture's answer and withdraws it.
   */
  constructor(
    dataSource: DataSource,
    private readonly _pictures: CustomTrackingFieldPictureService,
  ) {
    super(
      dataSource,
      DELETED_CUSTOM_TRACKING_PICTURE_SWEEP_LOCK,
      'Pictures of deleted Custom Tracking fields',
    );
  }

  /**
   * Finds the still-served pictures answering deleted Fields.
   *
   * @returns Each picture, with the rows that hold it.
   */
  async findPictures(): Promise<CustomTrackingFieldPicture[]> {
    const image = this.tableOf(CustomTrackingImageValueEntity);
    const value = this.tableOf(CustomTrackingValueEntity);
    const field = this.tableOf(CustomTrackingFieldEntity);
    const asset = this.tableOf(FileAssetEntity);

    return (await this._dataSource.query(
      `
      SELECT iv."id"::text AS "imageValueId", v."id"::text AS "valueId",
             v."fieldId"::text AS "fieldId",
             COALESCE(v."accountId", v."characterId")::text AS "targetId",
             iv."cloudflareImageId" AS "imageId"
        FROM ${image} iv
        JOIN ${value} v ON v."id" = iv."valueId"
        JOIN ${field} f ON f."id" = v."fieldId"
        JOIN ${asset} a ON a."deliveryReference" = iv."cloudflareImageId"
       WHERE f."deletedAt" IS NOT NULL
         AND a."state"::text = ANY($1::text[])
       ORDER BY v."fieldId", iv."id"
      `,
      [SERVED_PICTURE_STATES],
    )) as CustomTrackingFieldPicture[];
  }

  /**
   * Removes one picture's answer and withdraws it.
   *
   * @param picture - The picture.
   */
  protected async withdraw(picture: CustomTrackingFieldPicture): Promise<void> {
    await this._pictures.release(picture);
  }

  /**
   * Names a picture in the log.
   *
   * @param picture - The picture.
   * @returns Its Field, record and reference.
   */
  protected describe(picture: CustomTrackingFieldPicture): string {
    return `FieldId: ${picture.fieldId}, TargetId: ${picture.targetId}, ImageId: ${picture.imageId}`;
  }
}

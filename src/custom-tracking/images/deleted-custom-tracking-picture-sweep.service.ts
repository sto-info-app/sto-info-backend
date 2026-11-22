import { Injectable } from '@nestjs/common';

import { DataSource } from 'typeorm';

import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import {
  DeletedRecordPictureSweep,
  SERVED_PICTURE_STATES,
} from 'src/file-assets/sweeps/deleted-record-picture-sweep';
import { AccountEntity } from 'src/sto/account/entities/account.entity';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';
import { UserEntity } from 'src/user/entities/user.entity';
import { PERSONAL_PICTURE_REASONS } from 'src/user/images/personal-picture-withdrawal.service';

import { CustomTrackingFieldEntity } from '../entities/custom-tracking-field.entity';
import { CustomTrackingImageValueEntity } from '../entities/custom-tracking-image-value.entity';
import { CustomTrackingValueEntity } from '../entities/custom-tracking-value.entity';
import {
  CUSTOM_TRACKING_FIELD_DELETED_REASON,
  CustomTrackingFieldPicture,
  CustomTrackingFieldPictureService,
} from './custom-tracking-field-picture.service';

/** The PostgreSQL advisory lock one run holds, so instances take turns. */
export const DELETED_CUSTOM_TRACKING_PICTURE_SWEEP_LOCK = 1_798_400_000;

/**
 * Withdraws, at every start, the Custom Tracking pictures nothing can show
 * again: those answering a deleted Field, and those describing a deleted STO
 * Account or Character.
 *
 * Deleting a Field, a Tab or a Section, an STO Account or a Character
 * withdraws those pictures as it goes. This catches the rest: those of
 * deletions before 19 October 2026, which left the pictures published, and
 * any picture whose withdrawal failed. A Field deleted with its Tab or Section
 * carries the same deletion, so asking the Field is enough; a Character on a
 * deleted Account counts as deleted with it.
 *
 * The reason recorded is the widest deletion that took the picture: a closed
 * account, then a deleted STO Account, then a deleted Character, then a
 * deleted Field.
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
   * Finds the still-served pictures answering deleted Fields or describing
   * deleted STO Accounts and Characters.
   *
   * @returns Each picture, with the rows that hold it and its reason.
   */
  async findPictures(): Promise<CustomTrackingFieldPicture[]> {
    const image = this.tableOf(CustomTrackingImageValueEntity);
    const value = this.tableOf(CustomTrackingValueEntity);
    const field = this.tableOf(CustomTrackingFieldEntity);
    const account = this.tableOf(AccountEntity);
    const character = this.tableOf(CharacterEntity);
    const user = this.tableOf(UserEntity);
    const asset = this.tableOf(FileAssetEntity);

    return (await this._dataSource.query(
      `
      SELECT iv."id"::text AS "imageValueId", v."id"::text AS "valueId",
             v."fieldId"::text AS "fieldId",
             COALESCE(v."accountId", v."characterId")::text AS "targetId",
             iv."cloudflareImageId" AS "imageId",
             CASE
               WHEN COALESCE(acc."deletedAt", ca."deletedAt") IS NOT NULL
                    AND u."deletedAt" IS NOT NULL THEN $2::text
               WHEN COALESCE(acc."deletedAt", ca."deletedAt") IS NOT NULL THEN $3::text
               WHEN ch."deletedAt" IS NOT NULL THEN $4::text
               ELSE $5::text
             END AS "reason"
        FROM ${image} iv
        JOIN ${value} v ON v."id" = iv."valueId"
        JOIN ${field} f ON f."id" = v."fieldId"
        LEFT JOIN ${account} acc ON acc."id" = v."accountId"
        LEFT JOIN ${character} ch ON ch."id" = v."characterId"
        LEFT JOIN ${account} ca ON ca."id" = ch."accountId"
        LEFT JOIN ${user} u ON u."id" = COALESCE(acc."userId", ca."userId")
        JOIN ${asset} a ON a."deliveryReference" = iv."cloudflareImageId"
       WHERE (f."deletedAt" IS NOT NULL
              OR acc."deletedAt" IS NOT NULL
              OR ch."deletedAt" IS NOT NULL
              OR ca."deletedAt" IS NOT NULL)
         AND a."state"::text = ANY($1::text[])
       ORDER BY v."fieldId", iv."id"
      `,
      [
        SERVED_PICTURE_STATES,
        PERSONAL_PICTURE_REASONS.ACCOUNT_CLOSED,
        PERSONAL_PICTURE_REASONS.STO_ACCOUNT_DELETED,
        PERSONAL_PICTURE_REASONS.CHARACTER_DELETED,
        CUSTOM_TRACKING_FIELD_DELETED_REASON,
      ],
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

import { Injectable } from '@nestjs/common';

import { DataSource } from 'typeorm';

import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import {
  DeletedRecordPictureSweep,
  SERVED_PICTURE_STATES,
} from 'src/file-assets/sweeps/deleted-record-picture-sweep';
import { AccountEntity } from 'src/sto/account/entities/account.entity';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';

import { UserProfileEntity } from '../entities/user-profile.entity';
import { UserEntity } from '../entities/user.entity';
import {
  PERSONAL_PICTURE_REASONS,
  PersonalPicture,
  PersonalPictureWithdrawalService,
} from './personal-picture-withdrawal.service';

/** The PostgreSQL advisory lock one run holds, so instances take turns. */
export const DELETED_PERSONAL_PICTURE_SWEEP_LOCK = 1_798_300_000;

/** A picture a deleted record still holds, and why it should go. */
export interface DeletedPersonalPicture extends PersonalPicture {
  /** The reason the registry records. */
  readonly reason: string;
}

/**
 * Withdraws, at every start, the profile pictures and Character portraits
 * that deleted records still hold.
 *
 * Closing an account, deleting an STO account and deleting a Character
 * withdraw these pictures as they go. This catches the rest: those of
 * records deleted before deletion withdrew anything (before 18 October 2026
 * they stayed published until a closed account was erased, and for ever
 * after a deleted Character or STO account), and any picture whose
 * withdrawal failed after its record had gone.
 *
 * The reason is the widest deletion that took it: a Character of a closed
 * account records the closure, one of a deleted STO account that deletion.
 */
@Injectable()
export class DeletedPersonalPictureSweepService extends DeletedRecordPictureSweep<DeletedPersonalPicture> {
  /**
   * Creates an instance of DeletedPersonalPictureSweepService.
   *
   * @param dataSource - The database, for the search and the lock.
   * @param _pictures - Withdraws each picture.
   */
  constructor(
    dataSource: DataSource,
    private readonly _pictures: PersonalPictureWithdrawalService,
  ) {
    super(
      dataSource,
      DELETED_PERSONAL_PICTURE_SWEEP_LOCK,
      'Deleted profile pictures and portraits',
    );
  }

  /**
   * Finds the pictures deleted records still hold that are still served.
   *
   * @returns Each picture, with its record and its reason.
   */
  async findPictures(): Promise<DeletedPersonalPicture[]> {
    const user = this.tableOf(UserEntity);
    const profile = this.tableOf(UserProfileEntity);
    const account = this.tableOf(AccountEntity);
    const character = this.tableOf(CharacterEntity);
    const asset = this.tableOf(FileAssetEntity);

    return (await this._dataSource.query(
      `
      SELECT picture."subject", picture."subjectId", picture."imageId", picture."reason"
        FROM (
          SELECT $1::text AS "subject", p."userId"::text AS "subjectId", p."profilePictureId"::text AS "imageId", $3::text AS "reason"
            FROM ${profile} p
            LEFT JOIN ${user} u ON u."id" = p."userId"
           WHERE (p."deletedAt" IS NOT NULL OR u."deletedAt" IS NOT NULL)
             AND p."profilePictureId" IS NOT NULL
          UNION ALL
          SELECT $2::text, c."id"::text, c."profilePictureId"::text,
                 CASE WHEN u."deletedAt" IS NOT NULL THEN $3::text
                      WHEN a."deletedAt" IS NOT NULL THEN $4::text
                      ELSE $5::text END
            FROM ${character} c
            LEFT JOIN ${account} a ON a."id" = c."accountId"
            LEFT JOIN ${user} u ON u."id" = a."userId"
           WHERE (c."deletedAt" IS NOT NULL OR a."deletedAt" IS NOT NULL OR u."deletedAt" IS NOT NULL)
             AND c."profilePictureId" IS NOT NULL
        ) picture
        JOIN ${asset} f ON f."deliveryReference" = picture."imageId"
       WHERE f."state"::text = ANY($6::text[])
       ORDER BY picture."subject", picture."subjectId"
      `,
      [
        FileAssetSubject.USER_PROFILE,
        FileAssetSubject.STO_CHARACTER,
        PERSONAL_PICTURE_REASONS.ACCOUNT_CLOSED,
        PERSONAL_PICTURE_REASONS.STO_ACCOUNT_DELETED,
        PERSONAL_PICTURE_REASONS.CHARACTER_DELETED,
        SERVED_PICTURE_STATES,
      ],
    )) as DeletedPersonalPicture[];
  }

  /**
   * Withdraws one picture with the reason found for it.
   *
   * @param picture - The picture.
   */
  protected async withdraw(picture: DeletedPersonalPicture): Promise<void> {
    await this._pictures.withdraw(picture, picture.reason);
  }

  /**
   * Names a picture in the log.
   *
   * @param picture - The picture.
   * @returns Its record and reference.
   */
  protected describe(picture: DeletedPersonalPicture): string {
    return `Subject: ${picture.subject}, SubjectId: ${picture.subjectId}, ImageId: ${picture.imageId}`;
  }
}

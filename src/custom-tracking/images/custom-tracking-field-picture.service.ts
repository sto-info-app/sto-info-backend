import { Injectable, Logger } from '@nestjs/common';

import { DataSource, EntityManager, FindOptionsWhere, In } from 'typeorm';

import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import { AssetWithdrawalService } from 'src/file-assets/services/asset-withdrawal.service';

import { CustomTrackingImageValueEntity } from '../entities/custom-tracking-image-value.entity';
import { CustomTrackingValueEntity } from '../entities/custom-tracking-value.entity';
import { customTrackingSubjectId } from './custom-tracking-image-subject.utility';

/** Why a picture went with its Field, as the file registry records it. */
export const CUSTOM_TRACKING_FIELD_DELETED_REASON = 'Its field was deleted';

/** The Accounts and Characters whose answers' pictures are to go. */
export interface CustomTrackingRecords {
  /** STO Accounts. */
  readonly accountIds: readonly string[];
  /** STO Characters. */
  readonly characterIds: readonly string[];
}

/** A picture answering a Field, and the rows that hold it. */
export interface CustomTrackingFieldPicture {
  /** The picture's own row. */
  readonly imageValueId: string;
  /** The answer it hangs from. */
  readonly valueId: string;
  /** The Field it answers. */
  readonly fieldId: string;
  /** The Account or Character it describes. */
  readonly targetId: string;
  /** Its Cloudflare Images identifier. */
  readonly imageId: string;
  /** Why it goes, when not because its Field was deleted. */
  readonly reason?: string;
}

/**
 * Takes the pictures of deleted Fields down at once.
 *
 * Deleting a Field, a Tab or a Section keeps its definitions and typed
 * answers for the retention period, but not its pictures: a picture is
 * published, and nothing can bring a deleted Field back to show it again. So
 * each picture's answer is removed with the deletion, exactly as removing one
 * picture removes it, and the picture is then withdrawn through the registry.
 *
 * Removing the answer is not only tidy. The retention purge queues every
 * picture still answering an expired Field for deletion, and Cloudflare
 * refuses to delete one that has already gone, so an answer left pointing at
 * a withdrawn picture would fail its clean-up every night until it alarmed.
 *
 * The same goes for the pictures describing an STO Account or Character that
 * has been deleted: nothing can show them again either.
 */
@Injectable()
export class CustomTrackingFieldPictureService {
  private readonly _logger = new Logger(CustomTrackingFieldPictureService.name);

  /**
   * Creates an instance of CustomTrackingFieldPictureService.
   *
   * @param _dataSource - Removes a picture's answer outside a deletion.
   * @param _withdrawal - Revokes, deletes and records the purge.
   */
  constructor(
    private readonly _dataSource: DataSource,
    private readonly _withdrawal: AssetWithdrawalService,
  ) {}

  /**
   * Removes the picture answers of Fields being deleted.
   *
   * Runs inside the deletion's transaction, so the answers go only if the
   * Fields do. The pictures themselves are withdrawn once it has committed.
   *
   * @param manager - The deletion's transaction.
   * @param fieldIds - The Fields being deleted.
   * @returns The pictures to withdraw.
   */
  async detach(
    manager: EntityManager,
    fieldIds: string[],
  ): Promise<CustomTrackingFieldPicture[]> {
    if (fieldIds.length === 0) {
      return [];
    }

    return this.detachWhere(manager, { fieldId: In(fieldIds) });
  }

  /**
   * Removes the picture answers describing deleted Accounts and Characters.
   *
   * @param manager - The transaction to write in.
   * @param records - The Accounts and Characters deleted.
   * @param reason - Why, as the registry records it.
   * @returns The pictures to withdraw.
   */
  async detachForRecords(
    manager: EntityManager,
    records: CustomTrackingRecords,
    reason: string,
  ): Promise<CustomTrackingFieldPicture[]> {
    const where: FindOptionsWhere<CustomTrackingValueEntity>[] = [];

    if (records.accountIds.length > 0) {
      where.push({ accountId: In([...records.accountIds]) });
    }

    if (records.characterIds.length > 0) {
      where.push({ characterId: In([...records.characterIds]) });
    }

    if (where.length === 0) {
      return [];
    }

    return this.detachWhere(manager, where, reason);
  }

  /**
   * Removes the picture answers among the answers matched.
   *
   * @param manager - The transaction to write in.
   * @param where - Which answers.
   * @param reason - Why, when not because their Field was deleted.
   * @returns The pictures to withdraw.
   */
  private async detachWhere(
    manager: EntityManager,
    where:
      | FindOptionsWhere<CustomTrackingValueEntity>
      | FindOptionsWhere<CustomTrackingValueEntity>[],
    reason?: string,
  ): Promise<CustomTrackingFieldPicture[]> {
    const values = await manager.find(CustomTrackingValueEntity, {
      where,
      withDeleted: true,
      select: { id: true, fieldId: true, accountId: true, characterId: true },
    });

    if (values.length === 0) {
      return [];
    }

    const images = await manager.find(CustomTrackingImageValueEntity, {
      where: { valueId: In(values.map(value => value.id)) },
      select: { id: true, valueId: true, cloudflareImageId: true },
    });

    if (images.length === 0) {
      return [];
    }

    const valuesById = new Map(values.map(value => [value.id, value]));
    const pictures = images.flatMap(image => {
      const value = valuesById.get(image.valueId);

      // Every picture hangs from one of the answers just read; one that
      // does not is not this deletion's to take.
      return value
        ? [
            {
              imageValueId: image.id,
              valueId: value.id,
              fieldId: value.fieldId,
              targetId: (value.accountId ?? value.characterId) as string,
              imageId: image.cloudflareImageId,
              ...(reason ? { reason } : {}),
            },
          ]
        : [];
    });

    await this.removeAnswers(manager, pictures);

    return pictures;
  }

  /**
   * Removes one picture's answer and withdraws it, throwing when it could not.
   *
   * For a picture a Field deleted before this left behind.
   *
   * @param picture - The picture.
   */
  async release(picture: CustomTrackingFieldPicture): Promise<void> {
    await this._dataSource.transaction(manager =>
      this.removeAnswers(manager, [picture]),
    );

    await this.withdraw(picture);
  }

  /**
   * Withdraws each picture, carrying on past one that fails.
   *
   * The deletion has already happened, so a picture that cannot be withdrawn
   * is logged rather than failing it; its answer has gone, and the owed purge
   * is recorded on the asset where the purge sweep finds it.
   *
   * @param pictures - The pictures.
   * @returns How many were withdrawn.
   */
  async withdrawEach(
    pictures: readonly CustomTrackingFieldPicture[],
  ): Promise<number> {
    let withdrawn = 0;

    for (const picture of pictures) {
      try {
        await this.withdraw(picture);
        withdrawn += 1;
      } catch (error: unknown) {
        this._logger.error(
          `[withdrawEach] Not withdrawn - FieldId: ${picture.fieldId}, TargetId: ${picture.targetId}, ImageId: ${picture.imageId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return withdrawn;
  }

  /**
   * Withdraws one picture from its slot.
   *
   * @param picture - The picture.
   */
  private async withdraw(picture: CustomTrackingFieldPicture): Promise<void> {
    await this._withdrawal.withdrawSlot(
      FileAssetSubject.CUSTOM_TRACKING_VALUE,
      customTrackingSubjectId(picture.fieldId, picture.targetId),
      FileAssetSlot.PICTURE,
      picture.imageId,
      picture.reason ?? CUSTOM_TRACKING_FIELD_DELETED_REASON,
    );
  }

  /**
   * Deletes the pictures' rows and the answers they hang from.
   *
   * @param manager - The transaction to write in.
   * @param pictures - The pictures.
   */
  private async removeAnswers(
    manager: EntityManager,
    pictures: readonly CustomTrackingFieldPicture[],
  ): Promise<void> {
    await manager.delete(CustomTrackingImageValueEntity, {
      id: In(pictures.map(picture => picture.imageValueId)),
    });
    await manager.delete(CustomTrackingValueEntity, {
      id: In(pictures.map(picture => picture.valueId)),
    });
  }
}

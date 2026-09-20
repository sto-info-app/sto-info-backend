import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { DataSource, EntityManager, Repository } from 'typeorm';

import { FileAssetAudience } from 'src/file-assets/enums/file-asset-audience.enum';
import { FileAssetKind } from 'src/file-assets/enums/file-asset-kind.enum';
import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import { AcceptedAsset } from 'src/file-assets/services/asset-ingress.service';
import { AssetWithdrawalService } from 'src/file-assets/services/asset-withdrawal.service';
import { ImageIngressService } from 'src/file-assets/services/image-ingress.service';
import { DEFAULT_MULTER_LIMITS } from 'src/shared/constants/file-upload.constants';

import {
  CUSTOM_TRACKING_IMAGE_SPECS,
  CustomTrackingImageSpec,
} from '../constants/custom-tracking-image.constants';
import { CUSTOM_TRACKING_LIMITS } from '../constants/custom-tracking-limits.constants';
import { CustomTrackingFieldService } from '../definitions/custom-tracking-field.service';
import { CustomTrackingFieldEntity } from '../entities/custom-tracking-field.entity';
import { CustomTrackingImageValueEntity } from '../entities/custom-tracking-image-value.entity';
import { CustomTrackingValueEntity } from '../entities/custom-tracking-value.entity';
import { CustomTrackingFieldType } from '../enums/custom-tracking-field-type.enum';
import { CustomTrackingImageCleanupReason } from '../enums/custom-tracking-image-cleanup-reason.enum';
import { CustomTrackingImageShape } from '../enums/custom-tracking-image-shape.enum';
import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';
import { CustomTrackingObservabilityService } from '../observability/custom-tracking-observability.service';
import { CustomTrackingImageCleanupService } from '../retention/custom-tracking-image-cleanup.service';
import {
  CustomTrackingTarget,
  CustomTrackingTargetService,
} from '../values/custom-tracking-target.service';
import { customTrackingSubjectId } from './custom-tracking-image-subject.utility';

/** What a picture write produced, and what it displaced. */
interface CustomTrackingImageWrite {
  /** The stored picture. */
  saved: CustomTrackingImageValueEntity;
  /** The Cloudflare identifier it replaced, or null where there was none. */
  replaced: string | null;
}

/** What one picture upload needs to know about itself. */
export interface CustomTrackingImageUpload {
  /** The owner. */
  userId: string;
  /** The image Field being answered. */
  fieldId: string;
  /** Whether an Account or a Character is being described. */
  scope: CustomTrackingTargetScope;
  /** The record being described. */
  targetId: string;
  /** What the picture shows. */
  altText: string;
  /** The uploaded file. */
  file: Express.Multer.File;
}

/**
 * The picture answering one image Field, for one Account or Character.
 *
 * Replacement uploads and validates the new picture before the old reference
 * is released, so a failed upload leaves the existing picture in place rather
 * than leaving the Field empty. The old image is released only after the new
 * identifier is committed: releasing first would leave a record pointing at an
 * image that no longer exists, which is worse than leaving one behind that
 * nothing points at.
 *
 * Alternative text is required whenever a picture exists. A picture nobody can
 * describe is a picture some readers cannot use at all, and the moment of
 * upload is the only moment its author certainly knows what it shows.
 */
@Injectable()
export class CustomTrackingImageService {
  /**
   * Creates an instance of CustomTrackingImageService.
   *
   * @param _imageValueRepository - Repository of picture answers.
   * @param _fields - Establishes ownership of the Field.
   * @param _targets - Establishes ownership of the record.
   * @param _ingress - Checks a picture over and sends it to be scanned.
   * @param _withdrawal - Takes a published picture down.
   * @param _cleanup - Queues pictures nothing points at any more.
   * @param _observability - Records uploads that failed or were abandoned.
   * @param _dataSource - Opens the transaction the write needs.
   */
  constructor(
    @InjectRepository(CustomTrackingImageValueEntity)
    private readonly _imageValueRepository: Repository<CustomTrackingImageValueEntity>,
    private readonly _fields: CustomTrackingFieldService,
    private readonly _targets: CustomTrackingTargetService,
    private readonly _ingress: ImageIngressService,
    private readonly _withdrawal: AssetWithdrawalService,
    private readonly _cleanup: CustomTrackingImageCleanupService,
    private readonly _observability: CustomTrackingObservabilityService,
    private readonly _dataSource: DataSource,
  ) {}

  /**
   * Checks a picture over and sends it to be scanned.
   *
   * Nothing is written. The Field goes on showing whatever picture it has
   * until a scanner has cleared the new one, at which point
   * {@link publish} writes the answer and its description together —
   * FC-012.
   *
   * The description is checked here even though it is not stored here.
   * The moment of upload is the only moment its author certainly knows what
   * the picture shows, and refusing a missing one a minute later, after the
   * dialogue has closed, would be no use to anybody.
   *
   * @param upload - The Field, the record, the description and the file.
   * @returns The asset to ask about, and how far along it is.
   * @throws NotFoundException when the Field or record is not the caller's.
   * @throws BadRequestException when the Field takes no picture, the
   *   description is missing, or the file is unacceptable.
   */
  async accept(upload: CustomTrackingImageUpload): Promise<AcceptedAsset> {
    const field = await this._fields.findOwned(upload.userId, upload.fieldId);
    const target = await this._targets.findOwned(
      upload.userId,
      upload.scope,
      upload.targetId,
    );

    this.assertTakesPictures(field);
    this.assertScopeMatches(field, target);

    const altText = this.checkedAltText(upload.altText);
    const spec = this.specOf(field);

    try {
      return await this._ingress.accept({
        spec,
        userId: upload.userId,
        kind: FileAssetKind.CUSTOM_TRACKING_IMAGE,
        // As it has always been. A Custom Tracking picture answers a private
        // record and is nonetheless delivered by the public CDN behind an
        // unguessable identifier, exactly as it was before FC-012: this
        // ticket changes when a picture is published, not who may see one.
        audience: FileAssetAudience.PUBLIC,
        subject: FileAssetSubject.CUSTOM_TRACKING_VALUE,
        subjectId: customTrackingSubjectId(field.id, target.id),
        slot: FileAssetSlot.PICTURE,
        entityTag: spec.entityTag,
        entityId: `${field.id}:${target.id}`,
        maximumBytes: DEFAULT_MULTER_LIMITS.fileSize,
        sizeLimitLabel: 'Custom tracking images',
        file: upload.file,
        // Everything the publisher will need and cannot work out for
        // itself. The row that holds the description does not exist until
        // the picture is published, so it has nowhere else to wait.
        feature: {
          altText,
          shape: this.shapeOf(field),
          fieldId: field.id,
          scope: target.scope,
          targetId: target.id,
          userId: upload.userId,
        },
      });
    } catch (error: unknown) {
      // The class of failure, never its message. A refusal names the bound it
      // applied, and one day one of them might name what it was applied to.
      this._observability.uploadRefused(
        upload.userId,
        field.id,
        (error as Error).constructor.name,
      );

      throw error;
    }
  }

  /**
   * Writes a cleared picture as the answer to one Field and record.
   *
   * Ownership is established again rather than taken from the upload. A
   * minute has passed, the Field may have been deleted and the record may
   * have changed hands, and ADR-0006 requires publication to be performed
   * against current permissions rather than against the ones that applied
   * when the file arrived.
   *
   * @param published - The cleared picture and what it answers.
   * @returns The identifier it replaced, or null where there was none.
   */
  async publish(published: {
    userId: string;
    fieldId: string;
    scope: CustomTrackingTargetScope;
    targetId: string;
    cloudflareImageId: string;
    altText: string;
    shape: CustomTrackingImageShape;
  }): Promise<string | null> {
    const field = await this._fields.findOwned(
      published.userId,
      published.fieldId,
    );
    const target = await this._targets.findOwned(
      published.userId,
      published.scope,
      published.targetId,
    );

    const { replaced } = await this.commit(
      published.cloudflareImageId,
      manager =>
        this.write(manager, field, target, {
          cloudflareImageId: published.cloudflareImageId,
          altText: published.altText,
          // Copied onto the picture rather than read back from the Field, so
          // a later change to the Field cannot misdescribe a picture already
          // stored under the shape it was actually cropped to.
          shape: published.shape,
        }),
    );

    return replaced;
  }

  /**
   * Writes the picture, and clears up after itself if the write fails.
   *
   * The upload has already happened by this point, so a transaction that rolls
   * back leaves a picture in Cloudflare that nothing will ever point at. It is
   * queued for deletion here because this is the last moment anything knows it
   * is there.
   *
   * @param cloudflareImageId - The picture already stored.
   * @param write - What to do inside the transaction.
   * @returns What was saved, and the identifier it replaced.
   */
  private async commit(
    cloudflareImageId: string,
    write: (manager: EntityManager) => Promise<CustomTrackingImageWrite>,
  ): Promise<CustomTrackingImageWrite> {
    try {
      return await this._dataSource.transaction(write);
    } catch (error: unknown) {
      await this._cleanup.enqueue(
        this._dataSource.manager,
        [cloudflareImageId],
        CustomTrackingImageCleanupReason.ABANDONED_UPLOAD,
      );
      this._observability.uploadAbandoned(cloudflareImageId);
      await this._cleanup.flush([cloudflareImageId]);

      throw error;
    }
  }

  /**
   * Reports the picture answering one Field and record.
   *
   * Added with FC-012, because a picture no longer exists when the upload
   * request finishes: the dialogue that sent it waits for a scanner and
   * then asks what landed, rather than being told at upload time about a
   * picture that had not been checked yet.
   *
   * @param userId - The owner.
   * @param fieldId - The image Field.
   * @param scope - Whether an Account or a Character is described.
   * @param targetId - The record described.
   * @returns The picture, or null when there is none.
   * @throws NotFoundException when the Field or record is not the caller's.
   */
  async find(
    userId: string,
    fieldId: string,
    scope: CustomTrackingTargetScope,
    targetId: string,
  ): Promise<CustomTrackingImageValueEntity | null> {
    const field = await this._fields.findOwned(userId, fieldId);
    const target = await this._targets.findOwned(userId, scope, targetId);

    return this.findExisting(this._dataSource.manager, field, target);
  }

  /**
   * Removes the picture answering one Field and record.
   *
   * @param userId - The owner.
   * @param fieldId - The image Field.
   * @param scope - Whether an Account or a Character is described.
   * @param targetId - The record described.
   * @throws NotFoundException when the Field, record or picture is not there.
   */
  async remove(
    userId: string,
    fieldId: string,
    scope: CustomTrackingTargetScope,
    targetId: string,
  ): Promise<void> {
    const field = await this._fields.findOwned(userId, fieldId);
    const target = await this._targets.findOwned(userId, scope, targetId);

    const existing = await this.findExisting(
      this._dataSource.manager,
      field,
      target,
    );

    if (!existing) {
      throw new NotFoundException('There is no picture there to remove.');
    }

    await this._dataSource.transaction(async manager => {
      await manager.delete(CustomTrackingImageValueEntity, {
        id: existing.id,
      });
      await manager.delete(CustomTrackingValueEntity, { id: existing.valueId });
    });

    // Withdrawn through the registry rather than queued for deletion, so the
    // row that says whether these bytes may be served stops saying yes at
    // the moment the answer stops pointing at them, and an outstanding purge
    // is recorded where W10 can find it — ADR-0016. The cleanup queue still
    // exists for the retention sweep and for account closure, which delete
    // pictures the registry has no reason to hear about one at a time.
    await this._withdrawal.withdrawSlot(
      FileAssetSubject.CUSTOM_TRACKING_VALUE,
      customTrackingSubjectId(field.id, target.id),
      FileAssetSlot.PICTURE,
      existing.cloudflareImageId,
      'Removed by the owner',
    );
  }

  /**
   * Writes the picture, replacing whatever was there.
   *
   * @param manager - The transaction to write in.
   * @param field - The image Field.
   * @param target - The record described.
   * @param picture - The stored picture's details.
   * @returns The saved picture, and the identifier it replaced.
   */
  private async write(
    manager: EntityManager,
    field: CustomTrackingFieldEntity,
    target: CustomTrackingTarget,
    picture: {
      cloudflareImageId: string;
      altText: string;
      shape: CustomTrackingImageShape;
    },
  ): Promise<CustomTrackingImageWrite> {
    const value = await this.valueRowFor(manager, field, target);
    const existing = await manager.findOne(CustomTrackingImageValueEntity, {
      where: { valueId: value.id },
    });

    const replaced = existing?.cloudflareImageId ?? null;

    const row =
      existing ??
      manager.create(CustomTrackingImageValueEntity, { valueId: value.id });

    row.cloudflareImageId = picture.cloudflareImageId;
    row.altText = picture.altText;
    row.shape = picture.shape;

    const saved = await manager.save(CustomTrackingImageValueEntity, row);

    // The replaced picture is reported rather than queued. Since FC-012 the
    // publication path withdraws it through the registry, which revokes the
    // row, deletes the object and records whether the purge happened; a
    // second deleter here would race that and leave `purgedAt` unset for a
    // picture that had in fact gone.
    return { saved, replaced };
  }

  /**
   * Finds or creates the value row a picture hangs from.
   *
   * An image answer is still an answer, so it has the same row every other
   * answer has. That is what makes one deletion path, one retention rule and
   * one unique constraint serve every type.
   *
   * @param manager - The transaction to write in.
   * @param field - The image Field.
   * @param target - The record described.
   * @returns The value row.
   */
  private async valueRowFor(
    manager: EntityManager,
    field: CustomTrackingFieldEntity,
    target: CustomTrackingTarget,
  ): Promise<CustomTrackingValueEntity> {
    const existing = await manager.findOne(CustomTrackingValueEntity, {
      where: { fieldId: field.id, ...this._targets.whereFor(target) },
    });

    if (existing) {
      return existing;
    }

    return manager.save(
      CustomTrackingValueEntity,
      manager.create(CustomTrackingValueEntity, {
        fieldId: field.id,
        targetScope: target.scope,
        accountId:
          target.scope === CustomTrackingTargetScope.ACCOUNT ? target.id : null,
        characterId:
          target.scope === CustomTrackingTargetScope.CHARACTER
            ? target.id
            : null,
        value: null,
      }),
    );
  }

  /**
   * Finds the picture already answering one Field and record.
   *
   * @param manager - The manager to read through.
   * @param field - The image Field.
   * @param target - The record described.
   * @returns The picture, or null.
   */
  private async findExisting(
    manager: EntityManager,
    field: CustomTrackingFieldEntity,
    target: CustomTrackingTarget,
  ): Promise<CustomTrackingImageValueEntity | null> {
    const value = await manager.findOne(CustomTrackingValueEntity, {
      where: { fieldId: field.id, ...this._targets.whereFor(target) },
    });

    if (!value) {
      return null;
    }

    return this._imageValueRepository.findOne({ where: { valueId: value.id } });
  }

  /**
   * Requires the Field to be one that takes a picture.
   *
   * @param field - The Field being answered.
   * @throws BadRequestException when it takes none.
   */
  private assertTakesPictures(field: CustomTrackingFieldEntity): void {
    if (field.fieldType !== CustomTrackingFieldType.IMAGE) {
      throw new BadRequestException('That field does not take a picture.');
    }
  }

  /**
   * Requires the Field and the record to be of the same scope.
   *
   * The database refuses the mismatch through a composite foreign key, but
   * catching it here turns a constraint violation into a sentence, and does so
   * before a picture has been uploaded to Cloudflare and left there.
   *
   * @param field - The Field being answered.
   * @param target - The record described.
   * @throws BadRequestException when the two do not agree.
   */
  private assertScopeMatches(
    field: CustomTrackingFieldEntity,
    target: CustomTrackingTarget,
  ): void {
    if (field.targetScope !== target.scope) {
      throw new BadRequestException(
        'That field does not describe this kind of record.',
      );
    }
  }

  /**
   * Requires a description, and trims it.
   *
   * @param altText - The description supplied.
   * @returns The description as it will be stored.
   * @throws BadRequestException when it is absent or too long.
   */
  private checkedAltText(altText: string): string {
    const trimmed = altText.trim();

    if (trimmed.length === 0) {
      throw new BadRequestException(
        'Describe what the picture shows, so it is usable by everybody.',
      );
    }

    if (trimmed.length > CUSTOM_TRACKING_LIMITS.MAX_IMAGE_ALT_LENGTH) {
      throw new BadRequestException(
        `That description can be at most ${CUSTOM_TRACKING_LIMITS.MAX_IMAGE_ALT_LENGTH} characters.`,
      );
    }

    return trimmed;
  }

  /**
   * Reads the crop shape from the Field's configuration.
   *
   * @param field - The image Field.
   * @returns The shape.
   */
  private shapeOf(field: CustomTrackingFieldEntity): CustomTrackingImageShape {
    return (
      field.configuration as unknown as { shape: CustomTrackingImageShape }
    ).shape;
  }

  /**
   * Reads the rules a Field's pictures are held to.
   *
   * @param field - The image Field.
   * @returns The spec.
   */
  private specOf(field: CustomTrackingFieldEntity): CustomTrackingImageSpec {
    return CUSTOM_TRACKING_IMAGE_SPECS[this.shapeOf(field)];
  }
}

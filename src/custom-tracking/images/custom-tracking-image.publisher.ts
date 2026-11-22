import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import {
  AssetAttachment,
  AssetPublisher,
  AssetPublisherRegistry,
} from 'src/file-assets/services/asset-publisher.registry';

import { CustomTrackingImageShape } from '../enums/custom-tracking-image-shape.enum';
import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';
import { CustomTrackingImageService } from './custom-tracking-image.service';

/** What the upload asked to be kept for publication. */
interface CustomTrackingImageDetail {
  /** The owner, whose ownership is established again at publication. */
  readonly userId: string;
  /** The image Field being answered. */
  readonly fieldId: string;
  /** Whether an Account or a Character is described. */
  readonly scope: CustomTrackingTargetScope;
  /** The record described. */
  readonly targetId: string;
  /** What the picture shows. */
  readonly altText: string;
  /** The shape it was cropped to. */
  readonly shape: CustomTrackingImageShape;
}

/**
 * Writes a cleared picture as the answer to one Custom Tracking Field.
 *
 * The only publisher that creates a row rather than updating one. Every
 * other slot belongs to a record that already exists — a Story has a banner
 * column whether or not anything is in it — whereas a Custom Tracking
 * picture is an answer, and an unanswered Field has no answer row at all.
 * That is why this one needs the Field, the record and the description
 * carried forward from the upload: none of them can be read back from a row
 * that does not exist yet.
 */
@Injectable()
export class CustomTrackingImagePublisher
  implements AssetPublisher, OnModuleInit
{
  private readonly _logger = new Logger(CustomTrackingImagePublisher.name);

  /** The kind of record this publishes for. */
  readonly subject = FileAssetSubject.CUSTOM_TRACKING_VALUE;

  /**
   * Creates an instance of CustomTrackingImagePublisher.
   *
   * @param _images - Custom Tracking's own picture writing.
   * @param _registry - Which publisher writes which table.
   */
  constructor(
    private readonly _images: CustomTrackingImageService,
    private readonly _registry: AssetPublisherRegistry,
  ) {}

  /**
   * Registers this publisher with the registry.
   */
  onModuleInit(): void {
    this._registry.register(this);
  }

  /**
   * Writes the picture as the Field's answer.
   *
   * A Field or record that has since been deleted, or that has changed
   * hands, makes the ownership lookup throw, and the picture is reported as
   * the one to withdraw. That is the right outcome: nothing will ever
   * display it.
   *
   * @param attachment - The Field and record, the new picture and the
   *   detail.
   * @returns The picture the answer held before, or null.
   */
  async attach(attachment: AssetAttachment): Promise<string | null> {
    const detail = this.detailOf(attachment.detail);

    if (detail === null) {
      this._logger.error(
        `[attach] Unusable placement detail - Subject: ${attachment.subjectId}`,
      );

      return attachment.deliveryReference;
    }

    try {
      return await this._images.publish({
        userId: detail.userId,
        fieldId: detail.fieldId,
        scope: detail.scope,
        targetId: detail.targetId,
        cloudflareImageId: attachment.deliveryReference,
        altText: detail.altText,
        shape: detail.shape,
      });
    } catch (error: unknown) {
      this._logger.warn(
        `[attach] Nothing to publish to - Subject: ${attachment.subjectId}, ` +
          `Reason: ${error instanceof Error ? error.message : 'unknown'}`,
      );

      return attachment.deliveryReference;
    }
  }

  /**
   * Reads the detail an upload left for this publisher.
   *
   * @param detail - What the placement kept.
   * @returns The detail, or null when it cannot be used.
   */
  private detailOf(
    detail: Record<string, unknown> | null,
  ): CustomTrackingImageDetail | null {
    if (detail === null) {
      return null;
    }

    const { userId, fieldId, scope, targetId, altText, shape } = detail;

    if (
      typeof userId !== 'string' ||
      typeof fieldId !== 'string' ||
      typeof targetId !== 'string' ||
      typeof altText !== 'string' ||
      !this.isScope(scope) ||
      !this.isShape(shape)
    ) {
      return null;
    }

    return { userId, fieldId, scope, targetId, altText, shape };
  }

  /**
   * Reports whether a stored value is one of the target scopes.
   *
   * @param value - The stored value.
   * @returns True when it names a scope.
   */
  private isScope(value: unknown): value is CustomTrackingTargetScope {
    return (
      typeof value === 'string' &&
      Object.values<string>(CustomTrackingTargetScope).includes(value)
    );
  }

  /**
   * Reports whether a stored value is one of the image shapes.
   *
   * @param value - The stored value.
   * @returns True when it names a shape.
   */
  private isShape(value: unknown): value is CustomTrackingImageShape {
    return (
      typeof value === 'string' &&
      Object.values<string>(CustomTrackingImageShape).includes(value)
    );
  }
}

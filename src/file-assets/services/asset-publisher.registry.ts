import { Injectable, InternalServerErrorException } from '@nestjs/common';

import { FileAssetSlot } from '../enums/file-asset-slot.enum';
import { FileAssetSubject } from '../enums/file-asset-subject.enum';

/**
 * What a placement's publisher is handed when its picture is ready.
 *
 * Carries the record, the new picture and whatever the feature asked to be
 * kept for it at ingress. Nothing about the scan: by this point the verdict
 * has been applied, the registry says the asset is published, and a feature
 * has no business making its own judgement about bytes.
 */
export interface AssetAttachment {
  /** Which record of the publisher's kind. */
  readonly subjectId: string;
  /**
   * Which picture of that record.
   *
   * A Story has a banner and a profile image, so one publisher serves two
   * columns and has to be told which.
   */
  readonly slot: FileAssetSlot;
  /** How the delivery route addresses the new picture. */
  readonly deliveryReference: string;
  /**
   * Who uploaded it.
   *
   * For the audit columns several of these tables carry. The person who set
   * a picture is the person who uploaded it, however long ago that was and
   * however many minutes the scan took.
   */
  readonly uploadedByUserId: string | null;
  /** What the feature asked to be kept for it at ingress. */
  readonly detail: Record<string, unknown> | null;
}

/**
 * The half of publication that only the owning feature can do.
 *
 * A picture reaches `AVAILABLE` centrally, and then one row somewhere has to
 * start pointing at it — `user_profile.profilePictureId`,
 * `storytime_story.bannerImageId`, a Custom Tracking value that does not
 * exist until this moment. Each of those is a different table with different
 * ownership rules, and the registry has no business knowing any of them.
 */
export interface AssetPublisher {
  /** The kind of record this publishes for. */
  readonly subject: FileAssetSubject;

  /**
   * Points the record at the newly published picture.
   *
   * Called once the asset is `AVAILABLE`, so the reference handed over is
   * one that may be served. An implementation writes its own row and returns
   * what that row used to hold, which is what lets the previous picture be
   * withdrawn rather than left published for ever.
   *
   * @param attachment - The record, the new picture and the feature detail.
   * @returns The delivery reference the record held before, or null when the
   *   slot was empty.
   */
  attach(attachment: AssetAttachment): Promise<string | null>;
}

/**
 * Which publisher writes which table.
 *
 * Features register themselves here rather than the registry importing them,
 * and that direction is the point: `FileAssetsModule` is imported by Storytime,
 * Custom Tracking, the user module and Fleet, so a registry that reached back
 * into any of them would close a loop that Nest resolves by refusing to start.
 *
 * **An unknown subject is refused at ingress, not at publication.** A missing
 * publisher is a wiring mistake, and the only difference between finding it
 * in a failing upload and finding it in a stuck asset an hour later is which
 * one somebody can debug.
 */
@Injectable()
export class AssetPublisherRegistry {
  private readonly _publishers = new Map<FileAssetSubject, AssetPublisher>();

  /**
   * Registers the publisher for one kind of record.
   *
   * @param publisher - The publisher.
   * @throws InternalServerErrorException when the subject already has one.
   */
  register(publisher: AssetPublisher): void {
    if (this._publishers.has(publisher.subject)) {
      throw new InternalServerErrorException(
        `Two publishers registered for ${publisher.subject}`,
      );
    }

    this._publishers.set(publisher.subject, publisher);
  }

  /**
   * Reports whether a kind of record can be published to.
   *
   * @param subject - The kind of record.
   * @returns True when a publisher is registered.
   */
  has(subject: FileAssetSubject): boolean {
    return this._publishers.has(subject);
  }

  /**
   * Returns the publisher for a kind of record.
   *
   * @param subject - The kind of record.
   * @returns The publisher.
   * @throws InternalServerErrorException when none is registered.
   */
  require(subject: FileAssetSubject): AssetPublisher {
    const publisher = this._publishers.get(subject);

    if (publisher === undefined) {
      throw new InternalServerErrorException(
        `No publisher is registered for ${subject}`,
      );
    }

    return publisher;
  }
}

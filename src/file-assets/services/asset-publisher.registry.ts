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
 * What a restricted asset's publisher is handed once its bytes are clean.
 *
 * The bytes themselves rather than a reference to them. A restricted asset is
 * never delivered, so there is no reference to hand over; what the feature
 * needs is to read the file, and it gets exactly the bytes the scanner
 * cleared — read out of quarantine and checked against the hash the
 * verdict was about by the publication service, so no feature ever touches
 * the private bucket or decides for itself which object is the right one.
 */
export interface RestrictedAssetAttachment {
  /** Which record of the publisher's kind. */
  readonly subjectId: string;
  /** Which slot of that record. */
  readonly slot: FileAssetSlot;
  /** The asset, for a publisher that checks it is the one it expected. */
  readonly assetId: string;
  /** The cleared bytes. Overwritten once the publisher has returned. */
  readonly bytes: Buffer;
  /** Who uploaded it. */
  readonly uploadedByUserId: string | null;
  /** What the feature asked to be kept for it at ingress. */
  readonly detail: Record<string, unknown> | null;
}

/** What a restricted asset's publisher made of the bytes. */
export type RestrictedAssetReceipt =
  /** The record now reflects the file, and the placement may go into force. */
  | { readonly accepted: true }
  /**
   * The feature will not use these bytes. The asset is refused with this
   * code and its bytes dropped; the code is structural, never content.
   */
  | { readonly accepted: false; readonly rejectionCode: string };

/**
 * The half of publication that only the owning feature can do, for an asset
 * nobody is ever served.
 *
 * A roster export is the case this exists for. It is scanned and placed like
 * a picture, and then everything diverges: there is no Cloudflare, no
 * delivery reference and no previous picture to withdraw, and the bytes stay
 * in quarantine because they are the evidence the record was built from. What
 * publication means for it is that the feature reads the file into its own
 * rows, and says whether it could.
 */
export interface RestrictedAssetPublisher {
  /** The kind of record this publishes for. */
  readonly subject: FileAssetSubject;

  /**
   * Reads the cleared bytes into the feature's own rows.
   *
   * May be called more than once for the same asset: a job that fails after
   * this returns is retried from the start. An implementation replaces what
   * an earlier call wrote rather than adding to it.
   *
   * @param attachment - The record, the slot and the bytes.
   * @returns Whether the feature accepted the file.
   */
  receive(
    attachment: RestrictedAssetAttachment,
  ): Promise<RestrictedAssetReceipt>;
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
 *
 * **A subject has one publisher of one kind.** Pictures and restricted files
 * are registered separately because they are handed different things, but a
 * subject cannot have both: which of the two applies is the asset's audience,
 * and a subject answering to either would let the audience decide which table
 * got written.
 */
@Injectable()
export class AssetPublisherRegistry {
  private readonly _publishers = new Map<FileAssetSubject, AssetPublisher>();

  private readonly _restricted = new Map<
    FileAssetSubject,
    RestrictedAssetPublisher
  >();

  /**
   * Registers the publisher for one kind of record.
   *
   * @param publisher - The publisher.
   * @throws InternalServerErrorException when the subject already has one.
   */
  register(publisher: AssetPublisher): void {
    this.assertUnclaimed(publisher.subject);

    this._publishers.set(publisher.subject, publisher);
  }

  /**
   * Registers the publisher for one kind of restricted record.
   *
   * @param publisher - The publisher.
   * @throws InternalServerErrorException when the subject already has one of
   *   either kind.
   */
  registerRestricted(publisher: RestrictedAssetPublisher): void {
    this.assertUnclaimed(publisher.subject);

    this._restricted.set(publisher.subject, publisher);
  }

  /**
   * Reports whether a kind of record can be published to.
   *
   * @param subject - The kind of record.
   * @returns True when a publisher is registered.
   */
  has(subject: FileAssetSubject): boolean {
    return this._publishers.has(subject) || this._restricted.has(subject);
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

  /**
   * Returns the publisher for one kind of restricted record.
   *
   * @param subject - The kind of record.
   * @returns The publisher.
   * @throws InternalServerErrorException when none is registered.
   */
  requireRestricted(subject: FileAssetSubject): RestrictedAssetPublisher {
    const publisher = this._restricted.get(subject);

    if (publisher === undefined) {
      throw new InternalServerErrorException(
        `No restricted publisher is registered for ${subject}`,
      );
    }

    return publisher;
  }

  /**
   * Refuses a second publisher for a subject, of either kind.
   *
   * @param subject - The kind of record.
   * @throws InternalServerErrorException when the subject already has one.
   */
  private assertUnclaimed(subject: FileAssetSubject): void {
    if (this.has(subject)) {
      throw new InternalServerErrorException(
        `Two publishers registered for ${subject}`,
      );
    }
  }
}

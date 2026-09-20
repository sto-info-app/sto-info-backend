import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import {
  AssetAttachment,
  AssetPublisher,
  AssetPublisherRegistry,
} from 'src/file-assets/services/asset-publisher.registry';

import { StorytimeArcEntity } from '../arcs/entities/storytime-arc.entity';
import { altTextOf } from './storytime-image-publisher.utility';

/** Which pair of columns each of an Arc's slots writes. */
const ARC_COLUMNS: Partial<
  Record<
    FileAssetSlot,
    {
      id: 'bannerImageId' | 'profileImageId';
      alt: 'bannerImageAlt' | 'profileImageAlt';
    }
  >
> = {
  [FileAssetSlot.BANNER]: { id: 'bannerImageId', alt: 'bannerImageAlt' },
  [FileAssetSlot.PROFILE]: { id: 'profileImageId', alt: 'profileImageAlt' },
};

/**
 * Puts cleared artwork on an Arc.
 *
 * Two slots, one publisher, because both write the same row and the only
 * difference between them is which pair of columns. The picture and its
 * description are written together and the Arc's version is bumped, which is
 * what the synchronous path did at upload time and what optimistic
 * concurrency downstream expects to see move.
 */
@Injectable()
export class StorytimeArcImagePublisher
  implements AssetPublisher, OnModuleInit
{
  private readonly _logger = new Logger(StorytimeArcImagePublisher.name);

  /** The kind of record this publishes for. */
  readonly subject = FileAssetSubject.STORYTIME_ARC;

  /**
   * Creates an instance of StorytimeArcImagePublisher.
   *
   * @param _arcs - Repository of Arcs.
   * @param _registry - Which publisher writes which table.
   */
  constructor(
    @InjectRepository(StorytimeArcEntity)
    private readonly _arcs: Repository<StorytimeArcEntity>,
    private readonly _registry: AssetPublisherRegistry,
  ) {}

  /**
   * Registers this publisher with the registry.
   */
  onModuleInit(): void {
    this._registry.register(this);
  }

  /**
   * Points an Arc at newly published artwork.
   *
   * @param attachment - The Arc, the slot, the new picture and the detail.
   * @returns The picture that slot held before, or null.
   */
  async attach(attachment: AssetAttachment): Promise<string | null> {
    const columns = ARC_COLUMNS[attachment.slot];
    const arc = await this._arcs.findOne({
      where: { id: attachment.subjectId },
    });

    if (arc === null || columns === undefined) {
      this._logger.warn(
        `[attach] Nothing to publish to - ArcId: ${attachment.subjectId}, Slot: ${attachment.slot}`,
      );

      return attachment.deliveryReference;
    }

    const previous = arc[columns.id] ?? null;

    arc[columns.id] = attachment.deliveryReference;
    arc[columns.alt] = altTextOf(attachment.detail);
    // The person who set the picture is the person who uploaded it. An
    // asset whose owner was since removed leaves the column as it was
    // rather than nulling a non-nullable audit field.
    arc.updatedByUserId = attachment.uploadedByUserId ?? arc.updatedByUserId;
    arc.version += 1;

    await this._arcs.save(arc);

    return previous;
  }
}

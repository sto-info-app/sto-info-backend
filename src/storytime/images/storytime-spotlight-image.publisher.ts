import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import {
  AssetAttachment,
  AssetPublisher,
  AssetPublisherRegistry,
} from 'src/file-assets/services/asset-publisher.registry';

import { StorytimeSpotlightEntity } from '../spotlight/entities/storytime-spotlight.entity';
import { altTextOf } from './storytime-image-publisher.utility';

/**
 * Puts cleared editorial artwork on a Spotlight entry.
 *
 * The only publisher whose uploads are an administrator's rather than a
 * reader's. It is treated exactly the same: an editor's picture is scanned
 * before the panel shows it, because R24 makes the gate unconditional rather
 * than a function of who uploaded.
 */
@Injectable()
export class StorytimeSpotlightImagePublisher
  implements AssetPublisher, OnModuleInit
{
  private readonly _logger = new Logger(StorytimeSpotlightImagePublisher.name);

  /** The kind of record this publishes for. */
  readonly subject = FileAssetSubject.STORYTIME_SPOTLIGHT;

  /**
   * Creates an instance of StorytimeSpotlightImagePublisher.
   *
   * @param _spotlights - Repository of Spotlight entries.
   * @param _registry - Which publisher writes which table.
   */
  constructor(
    @InjectRepository(StorytimeSpotlightEntity)
    private readonly _spotlights: Repository<StorytimeSpotlightEntity>,
    private readonly _registry: AssetPublisherRegistry,
  ) {}

  /**
   * Registers this publisher with the registry.
   */
  onModuleInit(): void {
    this._registry.register(this);
  }

  /**
   * Points a Spotlight entry at its newly published artwork.
   *
   * @param attachment - The entry, the new artwork and the detail.
   * @returns The artwork the entry held before, or null.
   */
  async attach(attachment: AssetAttachment): Promise<string | null> {
    const entry = await this._spotlights.findOne({
      where: { id: attachment.subjectId },
    });

    if (entry === null) {
      this._logger.warn(
        `[attach] No spotlight entry to publish to - SpotlightId: ${attachment.subjectId}`,
      );

      return attachment.deliveryReference;
    }

    const previous = entry.overrideImageId ?? null;

    entry.overrideImageId = attachment.deliveryReference;
    entry.overrideImageAlt = altTextOf(attachment.detail);
    // The person who set the picture is the person who uploaded it. An
    // asset whose owner was since removed leaves the column as it was
    // rather than nulling a non-nullable audit field.
    entry.updatedByUserId =
      attachment.uploadedByUserId ?? entry.updatedByUserId;

    await this._spotlights.save(entry);

    return previous;
  }
}

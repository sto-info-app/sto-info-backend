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

import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { altTextOf } from './storytime-image-publisher.utility';

/** Which pair of columns each of a Story's slots writes. */
const STORY_COLUMNS: Partial<
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
 * Puts cleared artwork on a Story.
 */
@Injectable()
export class StorytimeStoryImagePublisher
  implements AssetPublisher, OnModuleInit
{
  private readonly _logger = new Logger(StorytimeStoryImagePublisher.name);

  /** The kind of record this publishes for. */
  readonly subject = FileAssetSubject.STORYTIME_STORY;

  /**
   * Creates an instance of StorytimeStoryImagePublisher.
   *
   * @param _stories - Repository of Stories.
   * @param _registry - Which publisher writes which table.
   */
  constructor(
    @InjectRepository(StorytimeStoryEntity)
    private readonly _stories: Repository<StorytimeStoryEntity>,
    private readonly _registry: AssetPublisherRegistry,
  ) {}

  /**
   * Registers this publisher with the registry.
   */
  onModuleInit(): void {
    this._registry.register(this);
  }

  /**
   * Points a Story at newly published artwork.
   *
   * @param attachment - The Story, the slot, the new picture and the detail.
   * @returns The picture that slot held before, or null.
   */
  async attach(attachment: AssetAttachment): Promise<string | null> {
    const columns = STORY_COLUMNS[attachment.slot];
    const story = await this._stories.findOne({
      where: { id: attachment.subjectId },
    });

    if (story === null || columns === undefined) {
      this._logger.warn(
        `[attach] Nothing to publish to - StoryId: ${attachment.subjectId}, Slot: ${attachment.slot}`,
      );

      return attachment.deliveryReference;
    }

    const previous = story[columns.id] ?? null;

    story[columns.id] = attachment.deliveryReference;
    story[columns.alt] = altTextOf(attachment.detail);
    // The person who set the picture is the person who uploaded it. An
    // asset whose owner was since removed leaves the column as it was
    // rather than nulling a non-nullable audit field.
    story.updatedByUserId =
      attachment.uploadedByUserId ?? story.updatedByUserId;
    story.version += 1;

    await this._stories.save(story);

    return previous;
  }
}

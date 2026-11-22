import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import {
  AssetAttachment,
  AssetPublisher,
  AssetPublisherRegistry,
} from 'src/file-assets/services/asset-publisher.registry';

import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { altTextOf } from './storytime-image-publisher.utility';

/**
 * Puts a cleared cover on a Chapter.
 *
 * The cover is also what a Chapter looks like when its link is shared, which
 * is why the description travels with it rather than being written first and
 * paired with whatever arrives.
 */
@Injectable()
export class StorytimeChapterImagePublisher
  implements AssetPublisher, OnModuleInit
{
  private readonly _logger = new Logger(StorytimeChapterImagePublisher.name);

  /** The kind of record this publishes for. */
  readonly subject = FileAssetSubject.STORYTIME_CHAPTER;

  /**
   * Creates an instance of StorytimeChapterImagePublisher.
   *
   * @param _chapters - Repository of Chapters.
   * @param _registry - Which publisher writes which table.
   */
  constructor(
    @InjectRepository(StorytimeChapterEntity)
    private readonly _chapters: Repository<StorytimeChapterEntity>,
    private readonly _registry: AssetPublisherRegistry,
  ) {}

  /**
   * Registers this publisher with the registry.
   */
  onModuleInit(): void {
    this._registry.register(this);
  }

  /**
   * Points a Chapter at its newly published cover.
   *
   * @param attachment - The Chapter, the new cover and the detail.
   * @returns The cover the Chapter held before, or null.
   */
  async attach(attachment: AssetAttachment): Promise<string | null> {
    const chapter = await this._chapters.findOne({
      where: { id: attachment.subjectId },
    });

    if (chapter === null) {
      this._logger.warn(
        `[attach] No chapter to publish to - ChapterId: ${attachment.subjectId}`,
      );

      return attachment.deliveryReference;
    }

    const previous = chapter.coverImageId ?? null;

    chapter.coverImageId = attachment.deliveryReference;
    chapter.coverImageAlt = altTextOf(attachment.detail);
    // The person who set the picture is the person who uploaded it. An
    // asset whose owner was since removed leaves the column as it was
    // rather than nulling a non-nullable audit field.
    chapter.updatedByUserId =
      attachment.uploadedByUserId ?? chapter.updatedByUserId;
    chapter.version += 1;

    await this._chapters.save(chapter);

    return previous;
  }
}

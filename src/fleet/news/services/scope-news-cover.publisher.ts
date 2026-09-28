import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { IsNull, Not, Repository } from 'typeorm';

import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import {
  AssetAttachment,
  AssetPublisher,
  AssetPublisherRegistry,
} from 'src/file-assets/services/asset-publisher.registry';
import { NewsPostEntity } from 'src/news/entities/news-post.entity';
import { altTextOf } from 'src/storytime/images/storytime-image-publisher.utility';

/**
 * Puts a cleared cover on a Community's, a Fleet's or an Armada's news post
 * (FC-027).
 *
 * The cover and its description are written together, when the scanner has
 * cleared the picture, so the post never shows one picture described as
 * another while a scan is running. A post deleted meanwhile, or one of the
 * site's own, yields the new reference instead, which has the caller take
 * the picture straight back down: there is nothing to show it on.
 */
@Injectable()
export class ScopeNewsCoverPublisher implements AssetPublisher, OnModuleInit {
  private readonly _logger = new Logger(ScopeNewsCoverPublisher.name);

  /** The kind of record this publishes for. */
  readonly subject = FileAssetSubject.NEWS_POST;

  /**
   * Creates an instance of ScopeNewsCoverPublisher.
   *
   * @param _posts - Repository of news posts.
   * @param _registry - Which publisher writes which table.
   */
  constructor(
    @InjectRepository(NewsPostEntity)
    private readonly _posts: Repository<NewsPostEntity>,
    private readonly _registry: AssetPublisherRegistry,
  ) {}

  /**
   * Registers this publisher with the registry.
   */
  onModuleInit(): void {
    this._registry.register(this);
  }

  /**
   * Points a post at its newly cleared cover.
   *
   * @param attachment - The post, the slot, the picture and its description.
   * @returns The cover the post had before, or null.
   */
  async attach(attachment: AssetAttachment): Promise<string | null> {
    const post =
      attachment.slot === FileAssetSlot.COVER
        ? await this._posts.findOne({
            where: { id: attachment.subjectId, communityId: Not(IsNull()) },
          })
        : null;

    if (post === null) {
      this._logger.warn(
        `[attach] Nothing to publish to - PostId: ${attachment.subjectId}, Slot: ${attachment.slot}`,
      );

      return attachment.deliveryReference;
    }

    const previous = post.coverImageId;

    post.coverImageId = attachment.deliveryReference;
    post.coverImageAlt = altTextOf(attachment.detail);
    await this._posts.save(post);

    return previous;
  }
}

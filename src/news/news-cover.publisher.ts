import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { IsNull, Repository } from 'typeorm';

import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import {
  AssetAttachment,
  AssetPublisher,
  AssetPublisherRegistry,
} from 'src/file-assets/services/asset-publisher.registry';
import { altTextOf } from 'src/storytime/images/storytime-image-publisher.utility';

import { NewsPostEntity } from './entities/news-post.entity';

/**
 * Puts a cleared cover on one of the site's own news posts (sc-1447).
 *
 * The site's posts have a placement subject of their own, so this never sees
 * a Community's, a Fleet's or an Armada's post; those are Fleet news's. Like
 * every cover, the picture and its description are written together once the
 * scanner has cleared it, so a post is never shown one picture described as
 * another while a scan is running.
 */
@Injectable()
export class NewsCoverPublisher implements AssetPublisher, OnModuleInit {
  private readonly _logger = new Logger(NewsCoverPublisher.name);

  /** The kind of record this publishes for. */
  readonly subject = FileAssetSubject.SITE_NEWS_POST;

  /**
   * Creates an instance of NewsCoverPublisher.
   *
   * @param _newsRepository - The news post repository.
   * @param _registry - Which publisher writes which table.
   */
  constructor(
    @InjectRepository(NewsPostEntity)
    private readonly _newsRepository: Repository<NewsPostEntity>,
    private readonly _registry: AssetPublisherRegistry,
  ) {}

  /**
   * Registers this publisher with the registry.
   */
  onModuleInit(): void {
    this._registry.register(this);
  }

  /**
   * Points a site post at its newly cleared cover.
   *
   * A post deleted while its cover was being scanned, or a slot a post does
   * not have, hands the new reference back, which has the caller take the
   * picture straight down again: there is nothing to show it on.
   *
   * @param attachment - The post, the slot, the picture and its description.
   * @returns The cover the post had before, or null.
   */
  async attach(attachment: AssetAttachment): Promise<string | null> {
    if (attachment.slot !== FileAssetSlot.COVER) {
      return this.decline(attachment, 'not a cover');
    }

    const post = await this._newsRepository.findOneBy({
      id: attachment.subjectId,
      communityId: IsNull(),
    });

    if (!post) {
      return this.decline(attachment, 'no such post');
    }

    const replaced = post.coverImageId;

    post.coverImageId = attachment.deliveryReference;
    post.coverImageAlt = altTextOf(attachment.detail);
    await this._newsRepository.save(post);

    return replaced;
  }

  /**
   * Logs why a cover found nowhere to go, and hands it back to be withdrawn.
   *
   * @param attachment - The cover.
   * @param why - What was wrong.
   * @returns The cover's own reference.
   */
  private decline(attachment: AssetAttachment, why: string): string {
    this._logger.warn(
      `[attach] Cover declined, ${why} - PostId: ${attachment.subjectId}, Slot: ${attachment.slot}`,
    );

    return attachment.deliveryReference;
  }
}

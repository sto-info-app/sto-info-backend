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
import { altTextOf } from 'src/storytime/images/storytime-image-publisher.utility';

import { LogEntryEntity } from './entities/log-entry.entity';

/**
 * Puts a cleared picture on a Captain's Log entry (sc-1450).
 *
 * The picture and its description are written together once the scanner has
 * cleared it, so an entry never shows one picture described as another.
 */
@Injectable()
export class LogPicturePublisher implements AssetPublisher, OnModuleInit {
  private readonly _logger = new Logger(LogPicturePublisher.name);

  /** The kind of record this publishes for. */
  readonly subject = FileAssetSubject.LOG_ENTRY;

  /**
   * Creates an instance of LogPicturePublisher.
   *
   * @param _entries - The Log's entries.
   * @param _registry - Which publisher writes which table.
   */
  constructor(
    @InjectRepository(LogEntryEntity)
    private readonly _entries: Repository<LogEntryEntity>,
    private readonly _registry: AssetPublisherRegistry,
  ) {}

  /**
   * Registers this publisher with the registry.
   */
  onModuleInit(): void {
    this._registry.register(this);
  }

  /**
   * Points an entry at its newly cleared picture.
   *
   * An entry deleted while its picture was being scanned, or a slot an entry
   * does not have, hands the new reference back, which has the caller take
   * the picture straight down again.
   *
   * @param attachment - The entry, the slot, the picture and its description.
   * @returns The picture the entry had before, or null.
   */
  async attach(attachment: AssetAttachment): Promise<string | null> {
    if (attachment.slot !== FileAssetSlot.PICTURE) {
      return this.decline(attachment, 'not a picture');
    }

    const entry = await this._entries.findOneBy({ id: attachment.subjectId });

    if (!entry) {
      return this.decline(attachment, 'no such entry');
    }

    const replaced = entry.pictureId;

    entry.pictureId = attachment.deliveryReference;
    entry.pictureAlt = altTextOf(attachment.detail);
    await this._entries.save(entry);

    return replaced;
  }

  /**
   * Logs why a picture found nowhere to go, and hands it back to be withdrawn.
   *
   * @param attachment - The picture.
   * @param why - What was wrong.
   * @returns The picture's own reference.
   */
  private decline(attachment: AssetAttachment, why: string): string {
    this._logger.warn(
      `[attach] Picture declined, ${why} - EntryId: ${attachment.subjectId}, Slot: ${attachment.slot}`,
    );

    return attachment.deliveryReference;
  }
}

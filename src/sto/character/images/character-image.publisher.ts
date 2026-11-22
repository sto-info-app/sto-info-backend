import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import {
  AssetAttachment,
  AssetPublisher,
  AssetPublisherRegistry,
} from 'src/file-assets/services/asset-publisher.registry';

import { CharacterEntity } from '../entities/character.entity';

/**
 * Puts a cleared portrait on a Character.
 *
 * Deleted characters are soft-deleted, so a portrait cleared after its
 * Character was removed finds nothing to attach to and is withdrawn again.
 * That is the right outcome and it is reached without this knowing anything
 * about withdrawal: it reports that the new reference is the one to take
 * down.
 */
@Injectable()
export class CharacterImagePublisher implements AssetPublisher, OnModuleInit {
  private readonly _logger = new Logger(CharacterImagePublisher.name);

  /** The kind of record this publishes for. */
  readonly subject = FileAssetSubject.STO_CHARACTER;

  /**
   * Creates an instance of CharacterImagePublisher.
   *
   * @param _characters - Repository of characters.
   * @param _registry - Which publisher writes which table.
   */
  constructor(
    @InjectRepository(CharacterEntity)
    private readonly _characters: Repository<CharacterEntity>,
    private readonly _registry: AssetPublisherRegistry,
  ) {}

  /**
   * Registers this publisher with the registry.
   */
  onModuleInit(): void {
    this._registry.register(this);
  }

  /**
   * Points a Character at a newly published portrait.
   *
   * @param attachment - The Character, the new portrait and the detail.
   * @returns The portrait the Character held before, or null.
   */
  async attach(attachment: AssetAttachment): Promise<string | null> {
    const character = await this._characters.findOne({
      where: { id: attachment.subjectId },
    });

    if (character === null) {
      this._logger.warn(
        `[attach] No character to publish to - CharacterId: ${attachment.subjectId}`,
      );

      return attachment.deliveryReference;
    }

    const previous = character.profilePictureId ?? null;

    character.profilePictureId = attachment.deliveryReference;
    await this._characters.save(character);

    return previous;
  }
}

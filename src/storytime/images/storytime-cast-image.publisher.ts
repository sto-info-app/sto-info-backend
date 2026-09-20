import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import {
  AssetAttachment,
  AssetPublisher,
  AssetPublisherRegistry,
} from 'src/file-assets/services/asset-publisher.registry';

import { StorytimeCharacterEntity } from '../characters/entities/storytime-character.entity';
import { altTextOf } from './storytime-image-publisher.utility';

/**
 * Puts a cleared portrait on a Character in a Story's cast.
 */
@Injectable()
export class StorytimeCastImagePublisher
  implements AssetPublisher, OnModuleInit
{
  private readonly _logger = new Logger(StorytimeCastImagePublisher.name);

  /** The kind of record this publishes for. */
  readonly subject = FileAssetSubject.STORYTIME_CAST_MEMBER;

  /**
   * Creates an instance of StorytimeCastImagePublisher.
   *
   * @param _characters - Repository of cast members.
   * @param _registry - Which publisher writes which table.
   */
  constructor(
    @InjectRepository(StorytimeCharacterEntity)
    private readonly _characters: Repository<StorytimeCharacterEntity>,
    private readonly _registry: AssetPublisherRegistry,
  ) {}

  /**
   * Registers this publisher with the registry.
   */
  onModuleInit(): void {
    this._registry.register(this);
  }

  /**
   * Points a cast member at their newly published portrait.
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
        `[attach] No cast member to publish to - CharacterId: ${attachment.subjectId}`,
      );

      return attachment.deliveryReference;
    }

    const previous = character.portraitImageId ?? null;

    character.portraitImageId = attachment.deliveryReference;
    character.portraitImageAlt = altTextOf(attachment.detail);
    // The person who set the picture is the person who uploaded it. An
    // asset whose owner was since removed leaves the column as it was
    // rather than nulling a non-nullable audit field.
    character.updatedByUserId =
      attachment.uploadedByUserId ?? character.updatedByUserId;
    character.version += 1;

    await this._characters.save(character);

    return previous;
  }
}

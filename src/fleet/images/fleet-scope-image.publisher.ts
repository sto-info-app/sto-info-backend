import { Logger, OnModuleInit } from '@nestjs/common';

import { FindOptionsWhere, ObjectLiteral, Repository } from 'typeorm';

import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import {
  AssetAttachment,
  AssetPublisher,
  AssetPublisherRegistry,
} from 'src/file-assets/services/asset-publisher.registry';
// Reused rather than restated. Reading a description out of the detail a
// placement kept is the same problem here as in Storytime, and a second copy
// would be a second thing to remember when the shape of that detail changes.
import { altTextOf } from 'src/storytime/images/storytime-image-publisher.utility';

import { FLEET_ARTWORK_COLUMNS } from './fleet-artwork-slot.utility';

/** The artwork columns every Fleet scope carries. */
export interface FleetScopeArtwork {
  /** The scope's identifier. */
  id: string;
  /** Delivery reference of the wide banner. */
  bannerImageId: string | null;
  /** What the banner shows. */
  bannerImageAlt: string | null;
  /** Delivery reference of the square emblem. */
  emblemImageId: string | null;
  /** What the emblem shows. */
  emblemImageAlt: string | null;
}

/**
 * Puts cleared artwork on a Community, a Fleet or an Armada.
 *
 * One implementation with three subclasses rather than three publishers,
 * because the registry keys on the subject and the three subjects are three
 * tables — but the writing is identical, down to the column names. What each
 * subclass supplies is its subject and its repository; everything that could
 * be got wrong is here, once.
 *
 * The authorisation revision is deliberately left alone. It is what
 * invalidates a cached capability decision, and a banner changes nothing
 * about who may do what: bumping it would make every artwork change log
 * every member of the scope out of their permissions for no reason.
 */
export abstract class FleetScopeImagePublisher<
  TScope extends FleetScopeArtwork & ObjectLiteral,
>
  implements AssetPublisher, OnModuleInit
{
  private readonly _logger = new Logger(FleetScopeImagePublisher.name);

  /** The kind of record this publishes for. */
  abstract readonly subject: FileAssetSubject;

  /**
   * Creates an instance of FleetScopeImagePublisher.
   *
   * @param _scopes - Repository of the scope this publishes for.
   * @param _registry - Which publisher writes which table.
   */
  protected constructor(
    private readonly _scopes: Repository<TScope>,
    private readonly _registry: AssetPublisherRegistry,
  ) {}

  /**
   * Registers this publisher with the registry.
   */
  onModuleInit(): void {
    this._registry.register(this);
  }

  /**
   * Points a scope at newly published artwork.
   *
   * A scope that has since been deleted, or a slot no scope has, yields the
   * new reference rather than null. That is what has the caller withdraw the
   * picture it just published: there is nothing to show it on, and leaving it
   * published would leave bytes served that nothing points at.
   *
   * @param attachment - The scope, the slot, the new picture and the detail.
   * @returns The picture that slot held before, or null.
   */
  async attach(attachment: AssetAttachment): Promise<string | null> {
    const columns = FLEET_ARTWORK_COLUMNS[attachment.slot];
    const scope = await this._scopes.findOne({
      where: { id: attachment.subjectId } as FindOptionsWhere<TScope>,
    });

    if (scope === null || columns === undefined) {
      this._logger.warn(
        `[attach] Nothing to publish to - Subject: ${this.subject}, ScopeId: ${attachment.subjectId}, Slot: ${attachment.slot}`,
      );

      return attachment.deliveryReference;
    }

    const previous = scope[columns.id] ?? null;

    scope[columns.id] = attachment.deliveryReference;
    // The description is written with the picture rather than at upload, so
    // the two never describe different images while a scan is running. An
    // empty one is the correct markup for a picture nobody described, and is
    // what a placement written before this code existed yields.
    scope[columns.alt] = altTextOf(attachment.detail);

    await this._scopes.save(scope);

    return previous;
  }
}

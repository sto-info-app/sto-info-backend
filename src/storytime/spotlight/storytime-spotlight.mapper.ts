import { Injectable } from '@nestjs/common';
import { StorytimeArcMapper } from '../arcs/storytime-arc.mapper';
import { StorytimeStoryMapper } from '../stories/storytime-story.mapper';
import { ManagedSpotlightDto, SpotlightDto } from './dto/spotlight.dto';
import { StorytimeSpotlightEntity } from './entities/storytime-spotlight.entity';
import { SpotlightWithTarget } from './storytime-spotlight.service';

/**
 * Turns Spotlight entries into the shapes the API returns.
 *
 * Two shapes, built separately rather than one with fields stripped
 * afterwards, so a column added later stays editorial until somebody decides
 * otherwise.
 */
@Injectable()
export class StorytimeSpotlightMapper {
  /**
   * Creates an instance of StorytimeSpotlightMapper.
   *
   * @param _storyMapper - Maps featured Stories.
   * @param _arcMapper - Maps featured Arcs.
   */
  constructor(
    private readonly _storyMapper: StorytimeStoryMapper,
    private readonly _arcMapper: StorytimeArcMapper,
  ) {}

  /**
   * Maps an entry and its work to the reader-facing shape.
   *
   * @param resolved - The entry with whatever it features.
   * @returns The reader-facing entry.
   */
  toPublic(resolved: SpotlightWithTarget): SpotlightDto {
    const { entry } = resolved;

    return {
      id: entry.id,
      slug: entry.slug,
      entityType: entry.entityType,
      headline: entry.headline,
      summary: entry.summary,
      selectionReason: entry.selectionReason,
      overrideImageUrl: entry.overrideImageUrl,
      overrideImageMobileUrl: entry.overrideImageMobileUrl,
      overrideImageAlt: entry.overrideImageAlt,
      startsAt: entry.startsAt,
      endsAt: entry.endsAt,
      story: resolved.story ? this._storyMapper.toPublic(resolved.story) : null,
      arc: resolved.arc ? this._arcMapper.toPublic(resolved.arc) : null,
    };
  }

  /**
   * Maps several entries to their reader-facing shape.
   *
   * @param resolved - The entries with their works.
   * @returns The reader-facing entries.
   */
  toPublicList(resolved: SpotlightWithTarget[]): SpotlightDto[] {
    return resolved.map(entry => this.toPublic(entry));
  }

  /**
   * Maps an entry to the shape an editor manages it through.
   *
   * The featured work is not resolved here. An editor needs to see the entry
   * as it is, including one pointing at something that has since been taken
   * down — which is exactly the entry they most need to find.
   *
   * @param entry - The Spotlight entry.
   * @returns The editorial entry.
   */
  toManaged(entry: StorytimeSpotlightEntity): ManagedSpotlightDto {
    return {
      ...this.toPublic({ entry, story: null, arc: null }),
      storyId: entry.storyId,
      arcId: entry.arcId,
      overrideImageId: entry.overrideImageId,
      displayPriority: entry.displayPriority,
      isPublished: entry.isPublished,
      createdByUserId: entry.createdByUserId,
      updatedByUserId: entry.updatedByUserId,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }

  /**
   * Maps several entries to their editorial shape.
   *
   * @param entries - The Spotlight entries.
   * @returns The editorial entries.
   */
  toManagedList(entries: StorytimeSpotlightEntity[]): ManagedSpotlightDto[] {
    return entries.map(entry => this.toManaged(entry));
  }
}

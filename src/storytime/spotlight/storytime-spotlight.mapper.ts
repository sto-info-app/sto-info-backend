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
   * The work is passed in rather than looked up, and may be absent: an entry
   * pointing at something that has since been taken down still maps, because
   * that is exactly the entry an editor most needs to find. What the editor
   * then reads is the name of the work where there is one, and the entry's own
   * identifiers only where there is not.
   *
   * @param entry - The Spotlight entry.
   * @param work - The featured work, when it can still be shown.
   * @returns The editorial entry.
   */
  toManaged(
    entry: StorytimeSpotlightEntity,
    work: Omit<SpotlightWithTarget, 'entry'> = { story: null, arc: null },
  ): ManagedSpotlightDto {
    return {
      ...this.toPublic({ entry, story: work.story, arc: work.arc }),
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
   * @param resolved - The entries with whatever they feature.
   * @returns The editorial entries.
   */
  toManagedList(resolved: SpotlightWithTarget[]): ManagedSpotlightDto[] {
    return resolved.map(entry => this.toManaged(entry.entry, entry));
  }
}

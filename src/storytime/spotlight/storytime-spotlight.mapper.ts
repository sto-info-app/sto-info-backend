import { Injectable } from '@nestjs/common';
import { StorytimeArcMapper } from '../arcs/storytime-arc.mapper';
import { StorytimeStoryMapper } from '../stories/storytime-story.mapper';
import { StorytimeTagMapper } from '../tags/storytime-tag.mapper';
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
   * @param _tagMapper - Maps the featured work's tags.
   */
  constructor(
    private readonly _storyMapper: StorytimeStoryMapper,
    private readonly _arcMapper: StorytimeArcMapper,
    private readonly _tagMapper: StorytimeTagMapper,
  ) {}

  /**
   * Maps an entry and its work to the reader-facing shape.
   *
   * @param resolved - The entry with whatever it features.
   * @returns The reader-facing entry.
   */
  toPublic(resolved: SpotlightWithTarget): SpotlightDto {
    const { entry } = resolved;
    const tags = this._tagMapper.toList(resolved.tags);

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
      // The author is named twice on purpose: once on the entry, which is
      // where a Spotlight panel reads it because an Arc has no author of its
      // own to read, and once on the Story, so an entry never carries a Story
      // that claims to have been written by nobody.
      story: resolved.story
        ? this._storyMapper.toPublic(resolved.story, resolved.author, tags)
        : null,
      arc: resolved.arc ? this._arcMapper.toPublic(resolved.arc, tags) : null,
      author: resolved.author,
      tags,
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
    work: Omit<SpotlightWithTarget, 'entry'> = {
      story: null,
      arc: null,
      author: null,
      tags: [],
    },
  ): ManagedSpotlightDto {
    return {
      ...this.toPublic({ entry, ...work }),
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

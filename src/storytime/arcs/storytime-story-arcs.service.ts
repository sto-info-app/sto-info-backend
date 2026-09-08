import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, Repository } from 'typeorm';

import { StorytimeArcReferenceDto } from '../dto/storytime-arc-reference.dto';
import { ArcMembershipStatus } from '../enums/arc-membership-status.enum';
import { StorytimeArcStoryEntity } from './entities/storytime-arc-story.entity';
import { StorytimeArcEntity } from './entities/storytime-arc.entity';
import { discoverableArcConditions } from './storytime-arc-visibility.utility';

/**
 * Naming the Arcs a Story is read as part of.
 *
 * A Story knows nothing about Arcs, and the module graph keeps it that way:
 * Arcs import Stories, never the reverse. But a reader scanning a listing is
 * choosing what to open, and "this is the second of a trilogy" decides that as
 * much as the summary does — so a Story's response has to be able to say it.
 *
 * This is why the lookup lives in a module of its own, holding nothing but the
 * two tables it reads. Stories may depend on it without depending on the Arc
 * routes, which ask Stories who owns what and would close the circle.
 *
 * Only agreed memberships of Arcs anybody may browse are named. An unlisted
 * Arc is one its curator chose not to advertise, and a Story listing that
 * announced it would advertise it on their behalf.
 */
@Injectable()
export class StorytimeStoryArcsService {
  /**
   * Creates an instance of StorytimeStoryArcsService.
   *
   * @param _membershipRepository - Repository of Arc memberships.
   * @param _arcRepository - Repository of Arcs.
   */
  constructor(
    @InjectRepository(StorytimeArcStoryEntity)
    private readonly _membershipRepository: Repository<StorytimeArcStoryEntity>,
    @InjectRepository(StorytimeArcEntity)
    private readonly _arcRepository: Repository<StorytimeArcEntity>,
  ) {}

  /**
   * Names the Arcs one Story is read as part of.
   *
   * @param storyId - The Story.
   * @returns Its discoverable Arcs, by title.
   */
  async findForStory(storyId: string): Promise<StorytimeArcReferenceDto[]> {
    const arcs = await this.findForStories([storyId]);

    return arcs.get(storyId) ?? [];
  }

  /**
   * Names the Arcs several Stories are read as part of.
   *
   * Two queries for a whole page rather than two per row: a listing of twenty
   * Stories asking after each one in turn is forty round trips for a line of
   * text under each title.
   *
   * @param storyIds - The Stories. Repeats and blanks are ignored.
   * @returns Each Story's discoverable Arcs by title, keyed by Story ID.
   */
  async findForStories(
    storyIds: string[],
  ): Promise<Map<string, StorytimeArcReferenceDto[]>> {
    const byStory = new Map<string, StorytimeArcReferenceDto[]>();
    const wanted = [...new Set(storyIds.filter(Boolean))];

    if (wanted.length === 0) {
      return byStory;
    }

    const memberships = await this._membershipRepository.find({
      where: {
        storyId: In(wanted),
        membershipStatus: ArcMembershipStatus.APPROVED,
      },
    });

    if (memberships.length === 0) {
      return byStory;
    }

    const arcs = await this._arcRepository.find({
      where: {
        ...discoverableArcConditions(),
        id: In([...new Set(memberships.map(membership => membership.arcId))]),
      },
    });
    const browsable = new Map(
      arcs.map(arc => [
        arc.id,
        { id: arc.id, title: arc.title, slug: arc.slug },
      ]),
    );

    for (const membership of memberships) {
      const arc = browsable.get(membership.arcId);

      // A membership naming an Arc that has since been unpublished, made
      // unlisted or taken down is a real agreement, but not one a reader can
      // act on, so it is left unsaid rather than offered as a dead end.
      if (!arc) {
        continue;
      }

      byStory.set(membership.storyId, [
        ...(byStory.get(membership.storyId) ?? []),
        arc,
      ]);
    }

    // By title, so a Story in several Arcs names them the same way every time
    // rather than in whatever order its memberships came back in.
    for (const references of byStory.values()) {
      references.sort((first, second) =>
        first.title.localeCompare(second.title),
      );
    }

    return byStory;
  }
}

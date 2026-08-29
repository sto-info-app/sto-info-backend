import { Injectable } from '@nestjs/common';
import { StorytimeStoryMapper } from '../stories/storytime-story.mapper';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { ArcMembershipDto } from './dto/arc.dto';
import { StorytimeArcStoryEntity } from './entities/storytime-arc-story.entity';
import { StorytimeArcMapper } from './storytime-arc.mapper';

/**
 * Pairs Arc memberships with the Stories they name.
 *
 * A membership on its own is two identifiers and a status, which is no use to
 * anybody reading it: the Story has to be fetched and named alongside it. Both
 * routes that answer with memberships — the curator's own list of an Arc, and
 * the pair of routes either side answers through — need exactly that, and the
 * rule for which Stories may be named is a decision rather than a formality.
 * It lives here so the two cannot come to different conclusions about it.
 */
@Injectable()
export class StorytimeArcMembershipPresenter {
  /**
   * Creates an instance of StorytimeArcMembershipPresenter.
   *
   * @param _storyService - Resolves the Stories a membership names.
   * @param _mapper - Maps memberships to their response shape.
   * @param _storyMapper - Maps those Stories to their reader-facing shape.
   */
  constructor(
    private readonly _storyService: StorytimeStoryService,
    private readonly _mapper: StorytimeArcMapper,
    private readonly _storyMapper: StorytimeStoryMapper,
  ) {}

  /**
   * Pairs memberships with the Stories the caller may see named.
   *
   * Scoped to the caller rather than to the public, so somebody's own
   * unpublished Story appears under its title instead of as a Story nobody
   * can see. Anybody else's stays unnamed until they publish it.
   *
   * @param memberships - The memberships.
   * @param userId - The caller.
   * @returns The memberships with their Stories.
   */
  async withStories(
    memberships: StorytimeArcStoryEntity[],
    userId: string,
  ): Promise<ArcMembershipDto[]> {
    const stories = await this._storyService.findVisibleByIds(
      memberships.map(membership => membership.storyId),
      userId,
    );

    return this._mapper.toMembershipList(
      memberships,
      new Map(
        stories.map(story => [story.id, this._storyMapper.toPublic(story)]),
      ),
    );
  }
}

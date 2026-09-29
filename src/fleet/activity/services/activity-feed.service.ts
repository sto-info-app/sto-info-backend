import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import {
  DataSource,
  EntityManager,
  Equal,
  FindOptionsWhere,
  IsNull,
  LessThan,
} from 'typeorm';

import { NewsPostEntity } from 'src/news/entities/news-post.entity';
import { NewsStatus } from 'src/news/enums/news-status.enum';

import { FleetAudienceService } from '../../authorisation/fleet-audience.service';
import { CommunitySubscriptionEntity } from '../../entities/community-subscription.entity';
import { FleetCommunityEntity } from '../../entities/fleet-community.entity';
import { ScopeMembershipEntity } from '../../entities/scope-membership.entity';
import { ScopeRoleAssignmentEntity } from '../../entities/scope-role-assignment.entity';
import { FleetAudience } from '../../enums/fleet-audience.enum';
import { ScopeMembershipStatus } from '../../enums/scope-membership-status.enum';
import { ScopeEventEntity } from '../../events/entities/scope-event.entity';
import { ScopeEventAccessService } from '../../events/services/scope-event-access.service';
import {
  GovernanceScope,
  toScopeRef,
} from '../../governance/utilities/governance-scope.utility';
import { purgeInBatches } from '../../retention/purge-in-batches.utility';
import { RetentionOutcome } from '../../retention/retention-run.service';
import { ScopePlace, scopePlaceOf } from '../../utilities/scope-place.utility';
import {
  ActivityItemDto,
  ActivityPageDto,
  ActivityQueryDto,
} from '../dto/activity.dto';
import { ActivityEventEntity } from '../entities/activity-event.entity';
import {
  ACTIVITY_RETENTION_MONTHS,
  ActivityType,
  ActivityVisibility,
} from '../enums/activity.enums';
import {
  ActivitySentenceWriter,
  ActivitySource,
} from './activity-sentence.writer';

/** How many items a page holds. */
export const ACTIVITY_PAGE_SIZE = 20;

/** How many items are read at a time while filling a page. */
const BATCH = 50;

/** How many batches one page reads at most before handing back a cursor. */
const MAX_BATCHES = 5;

/**
 * Activity feeds: a scope's, and a person's own (FC-029).
 *
 * Every item is asked about again at every read: whether the reader may see
 * its scope at all, then its own rule — the scope's visibility, its members
 * only, or its source's audience, such as a news post's. Nothing is shown
 * from what was true when it was recorded. The sentence is written from the
 * data as it stands, so a post renamed or a member gone reads as it is now,
 * and an item whose source has gone is left out.
 *
 * Steve's decisions of 28 September 2026: a Fleet's and an Armada's own
 * activity, a Community's own, and a personal feed gathering the Communities
 * somebody follows and the scopes they belong to; kept twelve months.
 */
@Injectable()
export class ActivityFeedService {
  /**
   * Creates an instance of ActivityFeedService.
   *
   * @param _dataSource - The database.
   * @param _audience - Says who may see a scope and its content.
   * @param _events - Says who may see an event.
   * @param _writer - Writes each item as a sentence.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _audience: FleetAudienceService,
    private readonly _events: ScopeEventAccessService,
    private readonly _writer: ActivitySentenceWriter,
  ) {}

  /**
   * Reads a page of a scope's own activity.
   *
   * @param scope - The scope.
   * @param viewerId - The reader, or null when signed out.
   * @param query - Where to carry on from.
   * @returns The page, newest first.
   * @throws NotFoundException when the reader may not see the scope.
   */
  async scopeFeed(
    scope: GovernanceScope,
    viewerId: string | null,
    query: ActivityQueryDto,
  ): Promise<ActivityPageDto> {
    if (!(await this._audience.canViewScope(toScopeRef(scope), viewerId))) {
      throw new NotFoundException('Not found');
    }

    return this.page(viewerId, query.before, [
      {
        communityId: scope.communityId,
        fleetId: scope.fleetId ?? IsNull(),
        armadaId: scope.armadaId ?? IsNull(),
      },
    ]);
  }

  /**
   * Reads a page of somebody's own feed: every Community they follow or own,
   * and every scope they are an approved member of or hold a role in.
   *
   * @param userId - The person.
   * @param query - Where to carry on from.
   * @returns The page, newest first.
   */
  async personalFeed(
    userId: string,
    query: ActivityQueryDto,
  ): Promise<ActivityPageDto> {
    const where = await this.scopesOf(userId);

    return where.length === 0
      ? { items: [], next: null }
      : this.page(userId, query.before, where);
  }

  /**
   * Forgets items older than twelve months, a batch at a time (FC-037).
   * Daily, by the Fleet's retention schedule.
   *
   * @returns How many were forgotten, and whether that was all that is due.
   */
  async purge(): Promise<RetentionOutcome> {
    const cutOff = new Date();

    cutOff.setUTCMonth(cutOff.getUTCMonth() - ACTIVITY_RETENTION_MONTHS);

    const tally = await purgeInBatches(
      this._dataSource.manager,
      ActivityEventEntity,
      { occurredAt: LessThan(cutOff) },
    );

    return { counts: { items: tally.deleted }, complete: tally.complete };
  }

  /**
   * The conditions naming every scope somebody's feed gathers.
   *
   * @param userId - The person.
   * @returns One condition per Community, Fleet or Armada.
   */
  private async scopesOf(
    userId: string,
  ): Promise<FindOptionsWhere<ActivityEventEntity>[]> {
    const manager = this._dataSource.manager;
    const [followed, owned, memberships, roles] = await Promise.all([
      manager.find(CommunitySubscriptionEntity, {
        where: { userId, leftAt: IsNull(), deletedAt: IsNull() },
        select: { communityId: true },
      }),
      manager.find(FleetCommunityEntity, {
        where: { ownerUserId: userId },
        select: { id: true },
      }),
      manager.find(ScopeMembershipEntity, {
        where: {
          userId,
          status: ScopeMembershipStatus.APPROVED,
          deletedAt: IsNull(),
        },
      }),
      manager.find(ScopeRoleAssignmentEntity, {
        where: { userId, validTo: IsNull(), deletedAt: IsNull() },
      }),
    ]);
    const communities = new Set([
      ...followed.map(row => row.communityId),
      ...owned.map(row => row.id),
    ]);
    const where: FindOptionsWhere<ActivityEventEntity>[] = [
      ...[...communities].map(communityId => ({ communityId })),
    ];

    for (const row of [...memberships, ...roles]) {
      if (communities.has(row.communityId)) {
        continue;
      }

      where.push({
        communityId: row.communityId,
        fleetId: row.fleetId ?? IsNull(),
        armadaId: row.armadaId ?? IsNull(),
      });
    }

    return where;
  }

  /**
   * Reads items newest first, keeping those the reader may see, until a
   * page is full or the feed runs out.
   *
   * @param viewerId - The reader, or null when signed out.
   * @param before - Where to carry on from, if anywhere.
   * @param where - The scopes to read.
   * @returns The page.
   */
  private async page(
    viewerId: string | null,
    before: string | undefined,
    where: FindOptionsWhere<ActivityEventEntity>[],
  ): Promise<ActivityPageDto> {
    const manager = this._dataSource.manager;
    const places = new Map<string, Promise<ScopePlace | null>>();
    const seen = new Map<string, Promise<boolean>>();
    const items: ActivityItemDto[] = [];
    let cursor = before ?? null;
    let exhausted = false;

    for (
      let batch = 0;
      batch < MAX_BATCHES && items.length < ACTIVITY_PAGE_SIZE && !exhausted;
      batch += 1
    ) {
      const rows = await manager.find(ActivityEventEntity, {
        where: this.after(where, cursor),
        order: { occurredAt: 'DESC', id: 'DESC' },
        take: BATCH,
      });

      exhausted = rows.length < BATCH;

      for (const row of rows) {
        cursor = cursorOf(row);

        const item = await this.shown(manager, row, viewerId, places, seen);

        if (item !== null) {
          items.push(item);
        }

        if (items.length === ACTIVITY_PAGE_SIZE) {
          exhausted = exhausted && row === rows[rows.length - 1];
          break;
        }
      }
    }

    return { items, next: exhausted ? null : cursor };
  }

  /**
   * Narrows the scope conditions to items after a cursor.
   *
   * @param where - The scope conditions.
   * @param cursor - The last item read, if any.
   * @returns The conditions.
   */
  private after(
    where: FindOptionsWhere<ActivityEventEntity>[],
    cursor: string | null,
  ): FindOptionsWhere<ActivityEventEntity>[] {
    if (cursor === null) {
      return where;
    }

    const split = cursor.lastIndexOf('_');
    const occurredAt = new Date(cursor.slice(0, split));
    const id = cursor.slice(split + 1);

    return where.flatMap(condition => [
      { ...condition, occurredAt: LessThan(occurredAt) },
      { ...condition, occurredAt: Equal(occurredAt), id: LessThan(id) },
    ]);
  }

  /**
   * Shows one item, if the reader may see it now.
   *
   * @param manager - The manager to read through.
   * @param row - The item.
   * @param viewerId - The reader, or null when signed out.
   * @param places - Scopes already looked up, by key.
   * @param seen - Scopes already asked about, by key.
   * @returns The item as a sentence, or null.
   */
  private async shown(
    manager: EntityManager,
    row: ActivityEventEntity,
    viewerId: string | null,
    places: Map<string, Promise<ScopePlace | null>>,
    seen: Map<string, Promise<boolean>>,
  ): Promise<ActivityItemDto | null> {
    const key = `${row.communityId}:${row.fleetId}:${row.armadaId}`;

    if (!places.has(key)) {
      places.set(key, scopePlaceOf(manager, row));
    }

    const place = await places.get(key);

    if (place === null || place === undefined) {
      return null;
    }

    if (!seen.has(key)) {
      seen.set(key, this._audience.canViewScope(place.ref, viewerId));
    }

    if (!(await seen.get(key))) {
      return null;
    }

    const source = await this.sourceOf(manager, row, place, viewerId);

    if (source === undefined) {
      return null;
    }

    const written = await this._writer.write(manager, row, place, source);

    return written === null
      ? null
      : {
          id: row.id,
          type: row.type,
          occurredAt: row.occurredAt,
          sentence: written.sentence,
          path: written.path,
          scope: { kind: place.kind, name: place.name, path: place.path },
        };
  }

  /**
   * Asks the item's own rule, and finds its source where it has one.
   *
   * @param manager - The manager to read through.
   * @param row - The item.
   * @param place - Its scope.
   * @param viewerId - The reader, or null when signed out.
   * @returns Its source — null for an item with none — or undefined when
   *   the reader may not see it, or its source has gone.
   */
  private async sourceOf(
    manager: EntityManager,
    row: ActivityEventEntity,
    place: ScopePlace,
    viewerId: string | null,
  ): Promise<ActivitySource | null | undefined> {
    switch (row.visibility) {
      case ActivityVisibility.SCOPE:
        return null;
      case ActivityVisibility.MEMBERS:
        return (await this._audience.canView(
          FleetAudience.FLEET_MEMBERS,
          place.ref,
          viewerId,
        ))
          ? null
          : undefined;
      case ActivityVisibility.SOURCE:
        return row.type === ActivityType.NEWS_PUBLISHED
          ? this.newsSource(manager, row, place, viewerId)
          : this.eventSource(manager, row, place, viewerId);
    }
  }

  /**
   * Finds a news post the reader may read now.
   *
   * @param manager - The manager to read through.
   * @param row - The item.
   * @param place - Its scope.
   * @param viewerId - The reader, or null when signed out.
   * @returns The post, or undefined when it is gone, unpublished or not
   *   theirs to read.
   */
  private async newsSource(
    manager: EntityManager,
    row: ActivityEventEntity,
    place: ScopePlace,
    viewerId: string | null,
  ): Promise<ActivitySource | undefined> {
    const post = await manager.findOne(NewsPostEntity, {
      where: {
        id: row.sourceId as string,
        communityId: row.communityId,
        status: NewsStatus.PUBLISHED,
      },
    });

    if (
      post === null ||
      !(await this._audience.canView(
        post.audience as FleetAudience,
        place.ref,
        viewerId,
      ))
    ) {
      return undefined;
    }

    return { post };
  }

  /**
   * Finds an event the reader may see now.
   *
   * @param manager - The manager to read through.
   * @param row - The item.
   * @param place - Its scope.
   * @param viewerId - The reader, or null when signed out.
   * @returns The event, or undefined when it is gone or not shown to them.
   */
  private async eventSource(
    manager: EntityManager,
    row: ActivityEventEntity,
    place: ScopePlace,
    viewerId: string | null,
  ): Promise<ActivitySource | undefined> {
    const event = await manager.findOne(ScopeEventEntity, {
      where: { id: row.sourceId as string, communityId: row.communityId },
    });

    if (event === null) {
      return undefined;
    }

    const viewer = await this._events.viewerAt(place.scope, viewerId);

    return (await this._events.canSee(event, viewer)) ? { event } : undefined;
  }
}

/**
 * The cursor naming an item, for carrying on after it.
 *
 * @param row - The item.
 * @returns `<ISO instant>_<ID>`.
 */
function cursorOf(row: ActivityEventEntity): string {
  return `${row.occurredAt.toISOString()}_${row.id}`;
}

import { NotFoundException } from '@nestjs/common';

import { jest } from '@jest/globals';

import { NewsPostEntity } from 'src/news/entities/news-post.entity';
import { NewsStatus } from 'src/news/enums/news-status.enum';

import { InMemoryManager, Row } from '../../../../test/in-memory-manager';
import { FleetAudienceService } from '../../authorisation/fleet-audience.service';
import { ScopeRef } from '../../authorisation/scope-authorisation.interface';
import { CommunitySubscriptionEntity } from '../../entities/community-subscription.entity';
import { FleetCommunityEntity } from '../../entities/fleet-community.entity';
import { ScopeMembershipEntity } from '../../entities/scope-membership.entity';
import { ScopeRoleAssignmentEntity } from '../../entities/scope-role-assignment.entity';
import { StoArmadaEntity } from '../../entities/sto-armada.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetAudience } from '../../enums/fleet-audience.enum';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { ScopeMembershipStatus } from '../../enums/scope-membership-status.enum';
import { ScopeEventEntity } from '../../events/entities/scope-event.entity';
import { ScopeEventAccessService } from '../../events/services/scope-event-access.service';
import {
  armadaScope,
  communityScope,
  fleetScope,
} from '../../governance/utilities/governance-scope.utility';
import { ActivityEventEntity } from '../entities/activity-event.entity';
import {
  ACTIVITY_VISIBILITY,
  ActivityType,
  ActivityVisibility,
} from '../enums/activity.enums';
import {
  ACTIVITY_PAGE_SIZE,
  ActivityFeedService,
} from './activity-feed.service';
import { ActivitySentenceWriter } from './activity-sentence.writer';

const COMMUNITY_ID = '29000000-0000-4000-8000-000000000001';
const FLEET_ID = '29000000-0000-4000-8000-000000000002';
const ARMADA_ID = '29000000-0000-4000-8000-000000000003';
const OTHER_COMMUNITY_ID = '29000000-0000-4000-8000-000000000004';
const OTHER_FLEET_ID = '29000000-0000-4000-8000-000000000005';
const READER_ID = '29000000-0000-4000-8000-000000000006';
const BASE = '/fleets/communities/ufa';
const LATEST = new Date('2026-09-28T12:00:00.000Z');

type AsyncMock<T> = jest.Mock<(...args: any[]) => Promise<T>>;

describe('ActivityFeedService', () => {
  let db: InMemoryManager;
  let audience: {
    canViewScope: AsyncMock<boolean>;
    canView: AsyncMock<boolean>;
  };
  let events: { viewerAt: AsyncMock<unknown>; canSee: AsyncMock<boolean> };
  let writer: {
    write: jest.Mock<
      (
        manager: unknown,
        row: ActivityEventEntity,
      ) => Promise<{ sentence: string; path: string | null } | null>
    >;
  };
  let service: ActivityFeedService;

  /**
   * Seeds one item.
   *
   * @param id - Its ID, which also orders items recorded at one instant.
   * @param overrides - What differs from a Community's own holding change,
   *   minutes before the latest.
   * @returns The row.
   */
  function seedItem(id: string, overrides: Partial<Row> = {}): Row {
    const type = (overrides.type as ActivityType) ?? ActivityType.SCOPE_CLOSED;
    const row = {
      id,
      communityId: COMMUNITY_ID,
      fleetId: null,
      armadaId: null,
      type,
      visibility: ACTIVITY_VISIBILITY[type],
      actorUserId: null,
      subjectUserId: null,
      sourceId: null,
      detail: null,
      occurredAt: new Date(LATEST.getTime() - Number(id.slice(-3)) * 60_000),
      ...overrides,
    };

    db.seed(ActivityEventEntity, [row]);

    return row;
  }

  /**
   * Seeds several items, one a minute apart.
   *
   * @param count - How many.
   * @param overrides - What each has.
   * @returns Their IDs, newest first.
   */
  function seedItems(count: number, overrides: Partial<Row> = {}): string[] {
    return Array.from({ length: count }, (_, index) => {
      const id = `item-${String(index + 1).padStart(3, '0')}`;

      seedItem(id, overrides);

      return id;
    });
  }

  beforeEach(() => {
    db = new InMemoryManager();
    db.seed(FleetCommunityEntity, [
      {
        id: COMMUNITY_ID,
        name: 'United Federation Alliance',
        slug: 'ufa',
        ownerUserId: 'owner-1',
      },
      {
        id: OTHER_COMMUNITY_ID,
        name: 'Other',
        slug: 'other',
        ownerUserId: READER_ID,
      },
    ]);
    db.seed(StoFleetEntity, [
      {
        id: FLEET_ID,
        exactGameName: 'Fixture Fleet',
        slug: 'fixture-fleet',
        platform: { name: 'Windows' },
      },
    ]);
    db.seed(StoArmadaEntity, [
      {
        id: ARMADA_ID,
        exactGameName: 'Fixture Armada',
        slug: 'fixture-armada',
        platform: { name: 'PlayStation 5' },
      },
    ]);
    audience = {
      canViewScope: jest.fn(async () => true),
      canView: jest.fn(async () => true),
    };
    events = {
      viewerAt: jest.fn(async () => 'viewer'),
      canSee: jest.fn(async () => true),
    };
    writer = {
      write: jest.fn(async (_manager, row) => ({
        sentence: `Sentence ${row.id}.`,
        path: null,
      })),
    };
    service = new ActivityFeedService(
      db.asDataSource(),
      audience as unknown as FleetAudienceService,
      events as unknown as ScopeEventAccessService,
      writer as unknown as ActivitySentenceWriter,
    );
  });

  describe('a scope’s feed', () => {
    it('is not found by a reader who may not see the scope', async () => {
      audience.canViewScope.mockResolvedValue(false);

      await expect(
        service.scopeFeed(communityScope(COMMUNITY_ID), null, {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('shows a Community’s own items, newest first, naming it', async () => {
      seedItem('item-002');
      seedItem('item-001');
      seedItem('item-003', { fleetId: FLEET_ID });

      const page = await service.scopeFeed(
        communityScope(COMMUNITY_ID),
        READER_ID,
        {},
      );

      expect(page).toEqual({
        items: [
          {
            id: 'item-001',
            type: ActivityType.SCOPE_CLOSED,
            occurredAt: new Date('2026-09-28T11:59:00.000Z'),
            sentence: 'Sentence item-001.',
            path: null,
            scope: {
              kind: FleetScopeKind.COMMUNITY,
              name: 'United Federation Alliance',
              path: BASE,
            },
          },
          expect.objectContaining({ id: 'item-002' }),
        ],
        next: null,
      });
      expect(audience.canViewScope).toHaveBeenCalledWith(
        { kind: FleetScopeKind.COMMUNITY, id: COMMUNITY_ID },
        READER_ID,
      );
    });

    it('names a Fleet and its page', async () => {
      seedItem('item-001', { fleetId: FLEET_ID });

      const page = await service.scopeFeed(
        fleetScope(COMMUNITY_ID, FLEET_ID),
        null,
        {},
      );

      expect(page.items[0].scope).toEqual({
        kind: FleetScopeKind.FLEET,
        name: 'Fixture Fleet',
        path: `${BASE}/fleets/windows/fixture-fleet`,
      });
      expect(audience.canViewScope).toHaveBeenLastCalledWith(
        {
          kind: FleetScopeKind.FLEET,
          id: FLEET_ID,
          withinCommunityId: COMMUNITY_ID,
        },
        null,
      );
    });

    it('names an Armada and its page', async () => {
      seedItem('item-001', { armadaId: ARMADA_ID });

      const page = await service.scopeFeed(
        armadaScope(COMMUNITY_ID, ARMADA_ID),
        null,
        {},
      );

      expect(page.items[0].scope).toEqual({
        kind: FleetScopeKind.ARMADA,
        name: 'Fixture Armada',
        path: `${BASE}/armadas/playstation-5/fixture-armada`,
      });
    });

    it('leaves out whatever the writer cannot write', async () => {
      seedItem('item-001');
      seedItem('item-002');
      writer.write.mockImplementation(async (_manager, row) =>
        row.id === 'item-001' ? null : { sentence: 'Kept.', path: '/kept' },
      );

      const page = await service.scopeFeed(
        communityScope(COMMUNITY_ID),
        null,
        {},
      );

      expect(page.items).toEqual([
        expect.objectContaining({
          id: 'item-002',
          sentence: 'Kept.',
          path: '/kept',
        }),
      ]);
    });
  });

  describe('whom an item is shown to', () => {
    it('shows a scope-wide item to anybody who may see the scope', async () => {
      seedItem('item-001', { type: ActivityType.HOLDINGS_RECORDED });

      const page = await service.scopeFeed(
        communityScope(COMMUNITY_ID),
        null,
        {},
      );

      expect(page.items).toHaveLength(1);
      expect(audience.canView).not.toHaveBeenCalled();
      expect(writer.write).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: 'item-001' }),
        expect.objectContaining({ kind: FleetScopeKind.COMMUNITY }),
        null,
      );
    });

    it.each([
      [true, 1],
      [false, 0],
    ])(
      'shows a members’ item to members only (member: %s)',
      async (member, shown) => {
        seedItem('item-001', {
          fleetId: FLEET_ID,
          type: ActivityType.MEMBER_JOINED,
        });
        audience.canView.mockResolvedValue(member);

        const page = await service.scopeFeed(
          fleetScope(COMMUNITY_ID, FLEET_ID),
          READER_ID,
          {},
        );

        expect(page.items).toHaveLength(shown);
        expect(audience.canView).toHaveBeenCalledWith(
          FleetAudience.FLEET_MEMBERS,
          expect.objectContaining({ kind: FleetScopeKind.FLEET, id: FLEET_ID }),
          READER_ID,
        );
      },
    );

    describe('a news post', () => {
      const post = {
        id: 'post-1',
        communityId: COMMUNITY_ID,
        status: NewsStatus.PUBLISHED,
        audience: FleetAudience.COMMUNITY,
      };

      beforeEach(() => {
        seedItem('item-001', {
          type: ActivityType.NEWS_PUBLISHED,
          sourceId: 'post-1',
        });
      });

      it('is shown to whoever may read it now', async () => {
        db.seed(NewsPostEntity, [post]);

        const page = await service.scopeFeed(
          communityScope(COMMUNITY_ID),
          READER_ID,
          {},
        );

        expect(page.items).toHaveLength(1);
        expect(audience.canView).toHaveBeenCalledWith(
          FleetAudience.COMMUNITY,
          { kind: FleetScopeKind.COMMUNITY, id: COMMUNITY_ID },
          READER_ID,
        );
        expect(writer.write).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.anything(),
          { post },
        );
      });

      it.each([
        ['gone', []],
        ['back to a draft', [{ ...post, status: NewsStatus.DRAFT }]],
      ])('is left out once %s', async (_label, posts) => {
        db.seed(NewsPostEntity, posts);

        const page = await service.scopeFeed(
          communityScope(COMMUNITY_ID),
          READER_ID,
          {},
        );

        expect(page.items).toEqual([]);
      });

      it('is left out for a reader outside its audience', async () => {
        db.seed(NewsPostEntity, [post]);
        audience.canView.mockResolvedValue(false);

        const page = await service.scopeFeed(
          communityScope(COMMUNITY_ID),
          null,
          {},
        );

        expect(page.items).toEqual([]);
      });
    });

    describe('an event', () => {
      const event = { id: 'event-1', communityId: COMMUNITY_ID };

      beforeEach(() => {
        seedItem('item-001', {
          armadaId: ARMADA_ID,
          type: ActivityType.EVENT_CREATED,
          sourceId: 'event-1',
        });
      });

      it('is shown to whoever the event is shown to now', async () => {
        db.seed(ScopeEventEntity, [event]);

        const page = await service.scopeFeed(
          armadaScope(COMMUNITY_ID, ARMADA_ID),
          READER_ID,
          {},
        );

        expect(page.items).toHaveLength(1);
        expect(events.viewerAt).toHaveBeenCalledWith(
          {
            kind: FleetScopeKind.ARMADA,
            communityId: COMMUNITY_ID,
            fleetId: null,
            armadaId: ARMADA_ID,
          },
          READER_ID,
        );
        expect(events.canSee).toHaveBeenCalledWith(event, 'viewer');
      });

      it('is left out once gone', async () => {
        const page = await service.scopeFeed(
          armadaScope(COMMUNITY_ID, ARMADA_ID),
          READER_ID,
          {},
        );

        expect(page.items).toEqual([]);
        expect(events.viewerAt).not.toHaveBeenCalled();
      });

      it('is left out for a reader it is not for', async () => {
        db.seed(ScopeEventEntity, [event]);
        events.canSee.mockResolvedValue(false);

        const page = await service.scopeFeed(
          armadaScope(COMMUNITY_ID, ARMADA_ID),
          READER_ID,
          {},
        );

        expect(page.items).toEqual([]);
      });
    });
  });

  describe('paging', () => {
    it('hands back where to carry on, and carries on from there', async () => {
      const ids = seedItems(ACTIVITY_PAGE_SIZE + 5);

      const first = await service.scopeFeed(
        communityScope(COMMUNITY_ID),
        null,
        {},
      );

      expect(first.items.map(item => item.id)).toEqual(
        ids.slice(0, ACTIVITY_PAGE_SIZE),
      );
      expect(first.next).toBe(
        `2026-09-28T11:40:00.000Z_${ids[ACTIVITY_PAGE_SIZE - 1]}`,
      );

      const second = await service.scopeFeed(
        communityScope(COMMUNITY_ID),
        null,
        { before: first.next as string },
      );

      expect(second.items.map(item => item.id)).toEqual(
        ids.slice(ACTIVITY_PAGE_SIZE),
      );
      expect(second.next).toBeNull();
    });

    it('carries on past items recorded at the same instant', async () => {
      seedItem('item-b', { occurredAt: LATEST });
      seedItem('item-a', { occurredAt: LATEST });
      seedItem('item-c', { occurredAt: new Date(0) });

      const page = await service.scopeFeed(communityScope(COMMUNITY_ID), null, {
        before: `${LATEST.toISOString()}_item-b`,
      });

      expect(page.items.map(item => item.id)).toEqual(['item-a', 'item-c']);
    });

    it('ends a feed that fills its last page exactly', async () => {
      seedItems(ACTIVITY_PAGE_SIZE);

      const page = await service.scopeFeed(
        communityScope(COMMUNITY_ID),
        null,
        {},
      );

      expect(page.items).toHaveLength(ACTIVITY_PAGE_SIZE);
      expect(page.next).toBeNull();
    });

    it('stops reading a feed of hidden items, handing back where it got to', async () => {
      const ids = seedItems(300, { type: ActivityType.MEMBER_JOINED });

      audience.canView.mockResolvedValue(false);

      const page = await service.scopeFeed(
        communityScope(COMMUNITY_ID),
        null,
        {},
      );

      expect(page.items).toEqual([]);
      expect(page.next).toBe(`2026-09-28T07:50:00.000Z_${ids[249]}`);
    });
  });

  describe('somebody’s own feed', () => {
    it('is empty for somebody who follows and belongs to nothing', async () => {
      seedItem('item-001');

      await expect(service.personalFeed('nobody-1', {})).resolves.toEqual({
        items: [],
        next: null,
      });
      expect(writer.write).not.toHaveBeenCalled();
    });

    it('gathers every scope of a Community followed or owned', async () => {
      db.seed(CommunitySubscriptionEntity, [
        {
          communityId: COMMUNITY_ID,
          userId: READER_ID,
          leftAt: null,
          deletedAt: null,
        },
      ]);
      seedItem('item-001');
      seedItem('item-002', { fleetId: FLEET_ID });
      seedItem('item-003', { armadaId: ARMADA_ID });
      seedItem('item-004', { communityId: OTHER_COMMUNITY_ID });

      const page = await service.personalFeed(READER_ID, {});

      expect(page.items.map(item => item.id)).toEqual([
        'item-001',
        'item-002',
        'item-003',
        'item-004',
      ]);
    });

    it('gathers the scopes somebody belongs to elsewhere, once each', async () => {
      db.seed(ScopeMembershipEntity, [
        {
          communityId: COMMUNITY_ID,
          fleetId: FLEET_ID,
          armadaId: null,
          userId: READER_ID,
          status: ScopeMembershipStatus.APPROVED,
          deletedAt: null,
        },
      ]);
      db.seed(ScopeRoleAssignmentEntity, [
        {
          communityId: COMMUNITY_ID,
          fleetId: null,
          armadaId: ARMADA_ID,
          userId: READER_ID,
          validTo: null,
          deletedAt: null,
        },
        {
          communityId: OTHER_COMMUNITY_ID,
          fleetId: OTHER_FLEET_ID,
          armadaId: null,
          userId: READER_ID,
          validTo: null,
          deletedAt: null,
        },
      ]);
      seedItem('item-001');
      seedItem('item-002', { fleetId: FLEET_ID });
      seedItem('item-003', { armadaId: ARMADA_ID });
      seedItem('item-004', { communityId: OTHER_COMMUNITY_ID });

      const page = await service.personalFeed(READER_ID, {});

      expect(page.items.map(item => item.id)).toEqual([
        'item-002',
        'item-003',
        'item-004',
      ]);
    });

    it('asks about each scope once, leaving out one the reader may not see', async () => {
      db.seed(CommunitySubscriptionEntity, [
        {
          communityId: COMMUNITY_ID,
          userId: READER_ID,
          leftAt: null,
          deletedAt: null,
        },
      ]);
      seedItem('item-001', { fleetId: FLEET_ID });
      seedItem('item-002', { fleetId: FLEET_ID });
      seedItem('item-003');
      audience.canViewScope.mockImplementation(
        async (ref: ScopeRef) => ref.kind !== FleetScopeKind.FLEET,
      );

      const page = await service.personalFeed(READER_ID, {});

      expect(page.items.map(item => item.id)).toEqual(['item-003']);
      expect(audience.canViewScope).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['Community', { communityId: '29000000-0000-4000-8000-00000000000f' }],
      ['Fleet', { fleetId: OTHER_FLEET_ID }],
      ['Armada', { armadaId: OTHER_FLEET_ID }],
    ])('leaves out an item whose %s has gone', async (_label, where) => {
      db.seed(CommunitySubscriptionEntity, [
        {
          communityId: (where as Row).communityId ?? COMMUNITY_ID,
          userId: READER_ID,
          leftAt: null,
          deletedAt: null,
        },
      ]);
      seedItem('item-001', where);

      const page = await service.personalFeed(READER_ID, {});

      expect(page.items).toEqual([]);
    });
  });

  describe('purge', () => {
    beforeEach(() => {
      jest.useFakeTimers({ now: LATEST });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('forgets what is more than twelve months old', async () => {
      seedItem('item-001', { occurredAt: new Date('2025-09-28T11:59:59Z') });
      seedItem('item-002', { occurredAt: new Date('2025-09-28T12:00:00Z') });

      await expect(service.purge()).resolves.toEqual({
        counts: { items: 1 },
        complete: true,
      });
      expect(db.rows(ActivityEventEntity).map(row => row.id)).toEqual([
        'item-002',
      ]);
    });
  });

  it('keeps every type’s visibility to the three rules', () => {
    expect(new Set(Object.values(ACTIVITY_VISIBILITY))).toEqual(
      new Set(Object.values(ActivityVisibility)),
    );
  });
});

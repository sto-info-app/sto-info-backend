import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { DataSource, EntityTarget, ObjectLiteral } from 'typeorm';

import { ChatMessageReportEntity } from 'src/fleet/chat/entities/chat-message-report.entity';
import { ChatMessageEntity } from 'src/fleet/chat/entities/chat-message.entity';
import { FleetCommunityEntity } from 'src/fleet/entities/fleet-community.entity';
import { ScopeMembershipEntity } from 'src/fleet/entities/scope-membership.entity';
import { StoArmadaEntity } from 'src/fleet/entities/sto-armada.entity';
import { StoFleetEntity } from 'src/fleet/entities/sto-fleet.entity';
import { UserReportEntity } from 'src/moderation/entities/user-report.entity';
import { NewsPostEntity } from 'src/news/entities/news-post.entity';
import { StorytimeChapterEntity } from 'src/storytime/chapters/entities/storytime-chapter.entity';
import { StorytimeSpotlightEntity } from 'src/storytime/spotlight/entities/storytime-spotlight.entity';
import { StorytimeStoryEntity } from 'src/storytime/stories/entities/storytime-story.entity';
import { UserEntity } from 'src/user/entities/user.entity';
import { UserRole } from 'src/user/enums/user-role.enum';

import {
  mondaysOfLastWeeks,
  SiteStatisticsService,
  startsOfWindows,
  WEEKS_IN_SERIES,
} from './site-statistics.service';

/** A Thursday, mid-afternoon UTC. */
const NOW = new Date('2026-10-22T15:30:00.000Z');

/** One query the service built: its table, and each call on the builder. */
interface BuiltQuery {
  entity: EntityTarget<ObjectLiteral>;
  calls: [string, unknown[]][];
}

/**
 * A fake data source whose query builders record what they are asked and
 * answer from a resolver, so a test can say what each table holds.
 */
class FakeDataSource {
  readonly queries: BuiltQuery[] = [];

  constructor(
    private readonly _answer: (query: BuiltQuery) => unknown = () => undefined,
  ) {}

  /**
   * Starts a query on a table.
   *
   * @param entity - The table.
   * @param alias - Its alias.
   * @returns The builder.
   */
  createQueryBuilder(entity: EntityTarget<ObjectLiteral>, alias: string) {
    const query: BuiltQuery = { entity, calls: [['alias', [alias]]] };
    this.queries.push(query);

    const chain: Record<string, (...args: unknown[]) => unknown> = {};
    for (const step of [
      'select',
      'addSelect',
      'where',
      'andWhere',
      'groupBy',
      'setParameters',
      'withDeleted',
    ]) {
      chain[step] = (...args: unknown[]) => {
        query.calls.push([step, args]);

        return chain;
      };
    }
    chain.getCount = () => Promise.resolve(this._answer(query) ?? 0);
    chain.getRawOne = () => Promise.resolve(this._answer(query));
    chain.getRawMany = () => Promise.resolve(this._answer(query) ?? []);

    return chain;
  }
}

/**
 * Every text argument passed to a query's builder, joined, so a test can ask
 * what the query filtered on.
 *
 * @param query - The query.
 * @returns Its text.
 */
function sqlOf(query: BuiltQuery): string {
  return query.calls
    .flatMap(([, args]) => args.filter(arg => typeof arg === 'string'))
    .join('\n');
}

/**
 * Whether a query was built without the soft-deleted rows filtered out.
 *
 * @param query - The query.
 * @returns True when it asked for deleted rows too.
 */
function includesDeleted(query: BuiltQuery): boolean {
  return query.calls.some(([step]) => step === 'withDeleted');
}

/**
 * The parameters a query was given, merged across every call that set some.
 *
 * @param query - The query.
 * @returns The parameters.
 */
function parametersOf(query: BuiltQuery): Record<string, unknown> {
  return Object.assign(
    {},
    ...query.calls
      .filter(([step]) => step === 'setParameters' || step === 'where')
      .flatMap(([, args]) => args.filter(arg => typeof arg === 'object')),
  );
}

describe('SiteStatisticsService (FC-053)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('the windows', () => {
    it('start today at 00:00 UTC, and seven and thirty days before now', () => {
      expect(startsOfWindows(NOW)).toEqual({
        today: new Date('2026-10-22T00:00:00.000Z'),
        last7Days: new Date('2026-10-15T15:30:00.000Z'),
        last30Days: new Date('2026-09-22T15:30:00.000Z'),
      });
    });

    // Thursday the 22nd sits in the week of Monday the 19th; the series runs
    // back eleven more Mondays.
    it('run twelve weeks back from the Monday of this week', () => {
      const mondays = mondaysOfLastWeeks(NOW);

      expect(mondays).toHaveLength(WEEKS_IN_SERIES);
      expect(mondays[WEEKS_IN_SERIES - 1]).toEqual(
        new Date('2026-10-19T00:00:00.000Z'),
      );
      expect(mondays[0]).toEqual(new Date('2026-08-03T00:00:00.000Z'));
      expect(mondays.every(monday => monday.getUTCDay() === 1)).toBe(true);
    });

    it('take a Sunday as the end of its week, not the start of the next', () => {
      const sunday = new Date('2026-10-25T23:59:59.000Z');

      expect(mondaysOfLastWeeks(sunday)[WEEKS_IN_SERIES - 1]).toEqual(
        new Date('2026-10-19T00:00:00.000Z'),
      );
    });
  });

  describe('read', () => {
    /**
     * Reads the statistics against a data source answering as told.
     *
     * @param answer - What each query returns.
     * @returns The statistics and every query built.
     */
    async function readWith(
      answer: (query: BuiltQuery) => unknown = () => undefined,
    ) {
      const dataSource = new FakeDataSource(answer);
      const service = new SiteStatisticsService(
        dataSource as unknown as DataSource,
      );

      return { statistics: await service.read(), queries: dataSource.queries };
    }

    /**
     * The queries built on a table.
     *
     * @param queries - Every query.
     * @param entity - The table.
     * @returns Those on it, in order.
     */
    function on(
      queries: BuiltQuery[],
      entity: EntityTarget<ObjectLiteral>,
    ): BuiltQuery[] {
      return queries.filter(query => query.entity === entity);
    }

    it('is dated as of now, and reads zero everywhere from an empty site', async () => {
      const { statistics } = await readWith();

      expect(statistics.generatedAt).toEqual(NOW);
      expect(statistics.users).toEqual({
        total: 0,
        verified: 0,
        disabled: 0,
        closed: 0,
        byRole: [
          { role: UserRole.USER, count: 0 },
          { role: UserRole.ADMIN, count: 0 },
          { role: UserRole.STORYTIME_CURATOR, count: 0 },
        ],
        registrations: { today: 0, last7Days: 0, last30Days: 0, allTime: 0 },
        active: { today: 0, last7Days: 0, last30Days: 0, allTime: 0 },
      });
      expect(statistics.registrationsByWeek).toHaveLength(WEEKS_IN_SERIES);
      expect(statistics.lastSeenByWeek.every(week => week.count === 0)).toBe(
        true,
      );
      expect(statistics.content.openReports).toEqual({
        members: 0,
        chat: 0,
        total: 0,
      });
    });

    // PostgreSQL hands counts back as text unless cast; both are taken.
    it('reads the four windows of a count from one query', async () => {
      const { statistics } = await readWith(query =>
        query.entity === StorytimeStoryEntity
          ? { today: '1', last7Days: 2, last30Days: '3', allTime: 4 }
          : undefined,
      );

      expect(statistics.storytime.storiesPublished).toEqual({
        today: 1,
        last7Days: 2,
        last30Days: 3,
        allTime: 4,
      });
    });

    it('sends the window starts as UTC text', async () => {
      const { queries } = await readWith();
      const [registrations] = on(queries, UserEntity).filter(query =>
        sqlOf(query).includes('FILTER (WHERE row."createdAt" >= :today)'),
      );

      expect(parametersOf(registrations)).toEqual({
        today: '2026-10-22T00:00:00.000Z',
        last7Days: '2026-10-15T15:30:00.000Z',
        last30Days: '2026-09-22T15:30:00.000Z',
      });
    });

    // Somebody who signed up and left still signed up; somebody disabled is
    // not using the site, however recently they were seen.
    it('counts registrations with closed accounts, and activity without disabled ones', async () => {
      const { queries } = await readWith();
      const users = on(queries, UserEntity);
      const registrations = users.find(query =>
        sqlOf(query).includes('FILTER (WHERE row."createdAt" >= :today)'),
      );
      const active = users.find(query =>
        sqlOf(query).includes(
          'FILTER (WHERE COALESCE(row."lastSeenAt", row."lastLoginAt") >= :today)',
        ),
      );

      expect(includesDeleted(registrations!)).toBe(true);
      expect(includesDeleted(active!)).toBe(false);
      expect(sqlOf(active!)).toContain('row."isAccountDisabled" = false');
      expect(sqlOf(active!)).toContain(
        'COUNT(COALESCE(row."lastSeenAt", row."lastLoginAt"))::int',
      );
    });

    it('counts closed accounts among the deleted, and the rest among the open', async () => {
      const { queries } = await readWith();
      const closed = on(queries, UserEntity).find(query =>
        sqlOf(query).includes('row."deletedAt" IS NOT NULL'),
      );
      const verified = on(queries, UserEntity).find(query =>
        sqlOf(query).includes('row."emailVerified" = true'),
      );

      expect(includesDeleted(closed!)).toBe(true);
      expect(includesDeleted(verified!)).toBe(false);
    });

    it('names every role, with zero for one nobody holds', async () => {
      const { statistics } = await readWith(query =>
        sqlOf(query).includes('row."role"')
          ? [
              { role: UserRole.ADMIN, count: '1' },
              { role: UserRole.USER, count: 40 },
            ]
          : undefined,
      );

      expect(statistics.users.byRole).toEqual([
        { role: UserRole.USER, count: 40 },
        { role: UserRole.ADMIN, count: 1 },
        { role: UserRole.STORYTIME_CURATOR, count: 0 },
      ]);
    });

    // The database answers only for the weeks that have something; the
    // series still names every week, oldest first.
    it('fills the weekly series with every week, empty ones as zero', async () => {
      const { statistics, queries } = await readWith(query =>
        sqlOf(query).includes('date_trunc(\'week\', row."createdAt")')
          ? [
              { week: '2026-10-19', count: '3' },
              { week: '2026-09-07', count: 1 },
            ]
          : undefined,
      );
      const series = statistics.registrationsByWeek;

      expect(series).toHaveLength(WEEKS_IN_SERIES);
      expect(series[0]).toEqual({ weekStarting: '2026-08-03', count: 0 });
      expect(series[5]).toEqual({ weekStarting: '2026-09-07', count: 1 });
      expect(series[WEEKS_IN_SERIES - 1]).toEqual({
        weekStarting: '2026-10-19',
        count: 3,
      });

      const query = on(queries, UserEntity).find(built =>
        sqlOf(built).includes('date_trunc(\'week\', row."createdAt")'),
      );

      expect(parametersOf(query!)).toEqual({
        since: '2026-08-03T00:00:00.000Z',
      });
      expect(includesDeleted(query!)).toBe(true);
    });

    it('counts the week a user was last seen in, among enabled accounts', async () => {
      const { queries } = await readWith();
      const query = on(queries, UserEntity).find(built =>
        sqlOf(built).includes(
          'date_trunc(\'week\', COALESCE(row."lastSeenAt", row."lastLoginAt"))',
        ),
      );

      expect(sqlOf(query!)).toContain('row."isAccountDisabled" = false');
      expect(includesDeleted(query!)).toBe(false);
    });

    it('counts Storytime content that is published and not removed, by first publication', async () => {
      const { queries } = await readWith();
      const [chapters] = on(queries, StorytimeChapterEntity);

      expect(sqlOf(chapters)).toContain('row."publishedAt" >= :today');
      expect(sqlOf(chapters)).toContain('row."status" = :status');
      expect(sqlOf(chapters)).toContain(
        'row."moderationStatus" = :moderationStatus',
      );
      expect(parametersOf(chapters)).toMatchObject({
        status: 'PUBLISHED',
        moderationStatus: 'ACTIVE',
      });
    });

    it('counts the Spotlights published now', async () => {
      const { statistics, queries } = await readWith(query =>
        query.entity === StorytimeSpotlightEntity ? 4 : undefined,
      );

      expect(statistics.storytime.spotlightsLive).toBe(4);
      expect(sqlOf(on(queries, StorytimeSpotlightEntity)[0])).toContain(
        'row."isPublished" = true',
      );
    });

    it('counts each kind of Fleet scope: active now, and registered by window', async () => {
      const { statistics, queries } = await readWith(query => {
        if (query.entity !== StoFleetEntity) {
          return undefined;
        }

        return sqlOf(query).includes('row."status" = :status')
          ? 5
          : { today: 0, last7Days: 1, last30Days: 2, allTime: 7 };
      });

      expect(statistics.fleet.fleets).toEqual({
        active: 5,
        registered: { today: 0, last7Days: 1, last30Days: 2, allTime: 7 },
      });
      expect(on(queries, FleetCommunityEntity)).toHaveLength(2);
      expect(on(queries, StoArmadaEntity)).toHaveLength(2);
      expect(
        parametersOf(
          on(queries, StoFleetEntity).find(query =>
            sqlOf(query).includes('row."status" = :status'),
          )!,
        ),
      ).toEqual({ status: 'ACTIVE' });
    });

    it('counts members once each, across every scope they hold approved access to', async () => {
      const { statistics, queries } = await readWith(query =>
        query.entity === ScopeMembershipEntity ? { count: '120' } : undefined,
      );
      const [members] = on(queries, ScopeMembershipEntity);

      expect(statistics.fleet.members).toBe(120);
      expect(sqlOf(members)).toContain('COUNT(DISTINCT row."userId")::int');
      expect(parametersOf(members)).toEqual({ status: 'APPROVED' });
    });

    it('counts chat messages sent, removed ones included', async () => {
      const { queries } = await readWith();
      const [messages] = on(queries, ChatMessageEntity);

      expect(sqlOf(messages)).toContain('row."createdAt" >= :today');
      expect(sqlOf(messages)).not.toContain('deletedAt');
    });

    it("counts the site's own published news, not a Fleet's", async () => {
      const { queries } = await readWith();
      const [news] = on(queries, NewsPostEntity);

      expect(sqlOf(news)).toContain('row."publishedAt" >= :today');
      expect(sqlOf(news)).toContain('row."communityId" IS NULL');
      expect(parametersOf(news)).toMatchObject({ status: 'PUBLISHED' });
    });

    it('counts the reports of both kinds still waiting on an admin, and their total', async () => {
      const { statistics, queries } = await readWith(query => {
        if (query.entity === UserReportEntity) return 2;
        if (query.entity === ChatMessageReportEntity) return 1;

        return undefined;
      });

      expect(statistics.content.openReports).toEqual({
        members: 2,
        chat: 1,
        total: 3,
      });
      expect(parametersOf(on(queries, UserReportEntity)[0])).toEqual({
        statuses: ['OPEN', 'UNDER_REVIEW'],
      });
    });
  });
});

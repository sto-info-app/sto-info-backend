import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, EntityTarget, ObjectLiteral } from 'typeorm';

import { ChatMessageReportEntity } from 'src/fleet/chat/entities/chat-message-report.entity';
import { ChatMessageEntity } from 'src/fleet/chat/entities/chat-message.entity';
import { FleetCommunityEntity } from 'src/fleet/entities/fleet-community.entity';
import { ScopeMembershipEntity } from 'src/fleet/entities/scope-membership.entity';
import { StoArmadaEntity } from 'src/fleet/entities/sto-armada.entity';
import { StoFleetEntity } from 'src/fleet/entities/sto-fleet.entity';
import { FleetScopeStatus } from 'src/fleet/enums/fleet-scope-status.enum';
import { ScopeMembershipStatus } from 'src/fleet/enums/scope-membership-status.enum';
import { ScopeEventEntity } from 'src/fleet/events/entities/scope-event.entity';
import { FleetApplicationEntity } from 'src/fleet/recruitment/entities/fleet-application.entity';
import { UserReportEntity } from 'src/moderation/entities/user-report.entity';
import { UNRESOLVED_STATUSES } from 'src/moderation/report.service';
import { NewsPostEntity } from 'src/news/entities/news-post.entity';
import { NewsStatus } from 'src/news/enums/news-status.enum';
import { AccountEntity } from 'src/sto/account/entities/account.entity';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';
import { StorytimeArcEntity } from 'src/storytime/arcs/entities/storytime-arc.entity';
import { StorytimeChapterEntity } from 'src/storytime/chapters/entities/storytime-chapter.entity';
import { ArcStatus } from 'src/storytime/enums/arc-status.enum';
import { ChapterStatus } from 'src/storytime/enums/chapter-status.enum';
import { StoryStatus } from 'src/storytime/enums/story-status.enum';
import { StorytimeModerationStatus } from 'src/storytime/enums/storytime-moderation-status.enum';
import { StorytimeCommentEntity } from 'src/storytime/social/entities/storytime-comment.entity';
import { StorytimeSpotlightEntity } from 'src/storytime/spotlight/entities/storytime-spotlight.entity';
import { StorytimeStoryEntity } from 'src/storytime/stories/entities/storytime-story.entity';
import { UserEntity } from 'src/user/entities/user.entity';
import { UserRole } from 'src/user/enums/user-role.enum';

import {
  CountWindowsDto,
  RoleCountDto,
  ScopeStatisticsDto,
  SiteStatisticsDto,
  WeeklyCountDto,
} from './site-statistics.dto';

/** How many weeks the two weekly series cover, the current one included. */
export const WEEKS_IN_SERIES = 12;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The alias every count query gives its table. */
const ROW = 'row';

/**
 * When a user was last seen: `lastSeenAt` (FC-053), or `lastLoginAt` for a
 * user not seen since that column arrived.
 */
const LAST_SEEN = `COALESCE(${ROW}."lastSeenAt", ${ROW}."lastLoginAt")`;

/** An open, enabled account. */
const ENABLED_USER = `${ROW}."isAccountDisabled" = false`;

/** The starts of the three bounded windows. */
interface WindowStarts {
  today: Date;
  last7Days: Date;
  last30Days: Date;
}

/** What one count asks for. */
interface CountQuery {
  /** The table. */
  entity: EntityTarget<ObjectLiteral>;
  /** The date each row is counted by, as a SQL expression over {@link ROW}. */
  dateColumn: string;
  /** Conditions over {@link ROW}, joined with AND; parameters as `:name`. */
  conditions?: string[];
  parameters?: Record<string, unknown>;
  /** Count soft-deleted rows too. */
  includeDeleted?: boolean;
}

/** What one weekly series asks for. */
interface SeriesQuery {
  entity: EntityTarget<ObjectLiteral>;
  dateColumn: string;
  conditions?: string[];
  includeDeleted?: boolean;
}

/**
 * The counts behind the Site Statistics page (FC-053).
 *
 * Every figure is a count over one table, read fresh on each request and
 * naming nobody. The bounded windows all start from the same moment, taken
 * once at the top, so the page's numbers agree with each other.
 */
@Injectable()
export class SiteStatisticsService {
  /**
   * Creates an instance of SiteStatisticsService.
   *
   * @param _dataSource - The data source.
   */
  constructor(@InjectDataSource() private readonly _dataSource: DataSource) {}

  /**
   * Reads every statistic the page shows.
   *
   * @returns The statistics, as of now.
   */
  async read(): Promise<SiteStatisticsDto> {
    const now = new Date();
    const windows = startsOfWindows(now);

    const [
      total,
      verified,
      disabled,
      closed,
      byRole,
      registrations,
      active,
      registrationsByWeek,
      lastSeenByWeek,
    ] = await Promise.all([
      this.count(UserEntity),
      this.count(UserEntity, [`${ROW}."emailVerified" = true`]),
      this.count(UserEntity, [`${ROW}."isAccountDisabled" = true`]),
      this.count(UserEntity, [`${ROW}."deletedAt" IS NOT NULL`], true),
      this.countUsersByRole(),
      this.countInWindows(windows, {
        entity: UserEntity,
        dateColumn: `${ROW}."createdAt"`,
        includeDeleted: true,
      }),
      this.countInWindows(windows, {
        entity: UserEntity,
        dateColumn: LAST_SEEN,
        conditions: [ENABLED_USER],
      }),
      this.countByWeek(now, {
        entity: UserEntity,
        dateColumn: `${ROW}."createdAt"`,
        includeDeleted: true,
      }),
      this.countByWeek(now, {
        entity: UserEntity,
        dateColumn: LAST_SEEN,
        conditions: [ENABLED_USER],
      }),
    ]);

    const [
      storiesPublished,
      chaptersPublished,
      arcsPublished,
      spotlightsLive,
      comments,
    ] = await Promise.all([
      this.countInWindows(windows, {
        entity: StorytimeStoryEntity,
        dateColumn: `${ROW}."publishedAt"`,
        conditions: [
          `${ROW}."status" = :status`,
          `${ROW}."moderationStatus" = :moderationStatus`,
        ],
        parameters: {
          status: StoryStatus.PUBLISHED,
          moderationStatus: StorytimeModerationStatus.ACTIVE,
        },
      }),
      this.countInWindows(windows, {
        entity: StorytimeChapterEntity,
        dateColumn: `${ROW}."publishedAt"`,
        conditions: [
          `${ROW}."status" = :status`,
          `${ROW}."moderationStatus" = :moderationStatus`,
        ],
        parameters: {
          status: ChapterStatus.PUBLISHED,
          moderationStatus: StorytimeModerationStatus.ACTIVE,
        },
      }),
      this.countInWindows(windows, {
        entity: StorytimeArcEntity,
        dateColumn: `${ROW}."publishedAt"`,
        conditions: [
          `${ROW}."status" = :status`,
          `${ROW}."moderationStatus" = :moderationStatus`,
        ],
        parameters: {
          status: ArcStatus.PUBLISHED,
          moderationStatus: StorytimeModerationStatus.ACTIVE,
        },
      }),
      this.count(StorytimeSpotlightEntity, [`${ROW}."isPublished" = true`]),
      this.countInWindows(windows, {
        entity: StorytimeCommentEntity,
        dateColumn: `${ROW}."createdAt"`,
      }),
    ]);

    const [
      communities,
      fleets,
      armadas,
      members,
      chatMessages,
      applications,
      events,
    ] = await Promise.all([
      this.scope(windows, FleetCommunityEntity),
      this.scope(windows, StoFleetEntity),
      this.scope(windows, StoArmadaEntity),
      this.countDistinct(
        ScopeMembershipEntity,
        `${ROW}."userId"`,
        [`${ROW}."status" = :status`],
        { status: ScopeMembershipStatus.APPROVED },
      ),
      this.countInWindows(windows, {
        entity: ChatMessageEntity,
        dateColumn: `${ROW}."createdAt"`,
      }),
      this.countInWindows(windows, {
        entity: FleetApplicationEntity,
        dateColumn: `${ROW}."submittedAt"`,
      }),
      this.countInWindows(windows, {
        entity: ScopeEventEntity,
        dateColumn: `${ROW}."createdAt"`,
      }),
    ]);

    const [
      stoAccounts,
      stoCharacters,
      newsPublished,
      memberReports,
      chatReports,
    ] = await Promise.all([
      this.countInWindows(windows, {
        entity: AccountEntity,
        dateColumn: `${ROW}."createdAt"`,
      }),
      this.countInWindows(windows, {
        entity: CharacterEntity,
        dateColumn: `${ROW}."createdAt"`,
      }),
      this.countInWindows(windows, {
        entity: NewsPostEntity,
        dateColumn: `${ROW}."publishedAt"`,
        conditions: [
          `${ROW}."status" = :status`,
          `${ROW}."communityId" IS NULL`,
        ],
        parameters: { status: NewsStatus.PUBLISHED },
      }),
      this.count(
        UserReportEntity,
        [`${ROW}."status" IN (:...statuses)`],
        false,
        { statuses: UNRESOLVED_STATUSES },
      ),
      this.count(
        ChatMessageReportEntity,
        [`${ROW}."status" IN (:...statuses)`],
        false,
        { statuses: UNRESOLVED_STATUSES },
      ),
    ]);

    return {
      generatedAt: now,
      users: {
        total,
        verified,
        disabled,
        closed,
        byRole,
        registrations,
        active,
      },
      registrationsByWeek,
      lastSeenByWeek,
      storytime: {
        storiesPublished,
        chaptersPublished,
        arcsPublished,
        spotlightsLive,
        comments,
      },
      fleet: {
        communities,
        fleets,
        armadas,
        members,
        chatMessages,
        applications,
        events,
      },
      content: {
        stoAccounts,
        stoCharacters,
        newsPublished,
        openReports: {
          members: memberReports,
          chat: chatReports,
          total: memberReports + chatReports,
        },
      },
    };
  }

  /**
   * One kind of Fleet scope: how many are active, and registrations by
   * window.
   *
   * @param windows - The window starts.
   * @param entity - The scope's table.
   * @returns Its figures.
   */
  private async scope(
    windows: WindowStarts,
    entity: EntityTarget<ObjectLiteral>,
  ): Promise<ScopeStatisticsDto> {
    const [active, registered] = await Promise.all([
      this.count(entity, [`${ROW}."status" = :status`], false, {
        status: FleetScopeStatus.ACTIVE,
      }),
      this.countInWindows(windows, {
        entity,
        dateColumn: `${ROW}."createdAt"`,
      }),
    ]);

    return { active, registered };
  }

  /**
   * Counts the rows of a table that meet some conditions.
   *
   * @param entity - The table.
   * @param conditions - Conditions over {@link ROW}, joined with AND.
   * @param includeDeleted - Count soft-deleted rows too.
   * @param parameters - The conditions' parameters.
   * @returns How many.
   */
  private async count(
    entity: EntityTarget<ObjectLiteral>,
    conditions: string[] = [],
    includeDeleted = false,
    parameters: Record<string, unknown> = {},
  ): Promise<number> {
    const query = this._dataSource
      .createQueryBuilder(entity, ROW)
      .where('TRUE')
      .setParameters(parameters);
    if (includeDeleted) {
      query.withDeleted();
    }
    for (const condition of conditions) {
      query.andWhere(condition);
    }

    return query.getCount();
  }

  /**
   * Counts the distinct values of a column among the rows that meet some
   * conditions.
   *
   * @param entity - The table.
   * @param column - The column, as a SQL expression over {@link ROW}.
   * @param conditions - Conditions over {@link ROW}, joined with AND.
   * @param parameters - The conditions' parameters.
   * @returns How many distinct values.
   */
  private async countDistinct(
    entity: EntityTarget<ObjectLiteral>,
    column: string,
    conditions: string[],
    parameters: Record<string, unknown>,
  ): Promise<number> {
    const query = this._dataSource
      .createQueryBuilder(entity, ROW)
      .select(`COUNT(DISTINCT ${column})::int`, 'count')
      .where('TRUE')
      .setParameters(parameters);
    for (const condition of conditions) {
      query.andWhere(condition);
    }

    const result = await query.getRawOne<{ count: number | string }>();

    return Number(result?.count ?? 0);
  }

  /**
   * Counts open accounts by role, naming every role.
   *
   * @returns One entry per role, in the enum's order.
   */
  private async countUsersByRole(): Promise<RoleCountDto[]> {
    const rows = await this._dataSource
      .createQueryBuilder(UserEntity, ROW)
      .select(`${ROW}."role"`, 'role')
      .addSelect('COUNT(*)::int', 'count')
      .groupBy(`${ROW}."role"`)
      .getRawMany<{ role: UserRole; count: number | string }>();
    const counts = new Map(rows.map(row => [row.role, Number(row.count)]));

    return Object.values(UserRole).map(role => ({
      role,
      count: counts.get(role) ?? 0,
    }));
  }

  /**
   * Counts the rows of a table over the four windows, in one query.
   *
   * All time counts every row with a date, so a table's windows always sum
   * within it.
   *
   * @param windows - The window starts.
   * @param query - What to count.
   * @returns The four counts.
   */
  private async countInWindows(
    windows: WindowStarts,
    query: CountQuery,
  ): Promise<CountWindowsDto> {
    const { entity, dateColumn, conditions = [], parameters = {} } = query;
    const builder = this._dataSource
      .createQueryBuilder(entity, ROW)
      .select(`COUNT(*) FILTER (WHERE ${dateColumn} >= :today)::int`, 'today')
      .addSelect(
        `COUNT(*) FILTER (WHERE ${dateColumn} >= :last7Days)::int`,
        'last7Days',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE ${dateColumn} >= :last30Days)::int`,
        'last30Days',
      )
      .addSelect(`COUNT(${dateColumn})::int`, 'allTime')
      .where('TRUE')
      .setParameters({ ...asParameters(windows), ...parameters });
    if (query.includeDeleted) {
      builder.withDeleted();
    }
    for (const condition of conditions) {
      builder.andWhere(condition);
    }

    const row =
      await builder.getRawOne<Record<keyof CountWindowsDto, unknown>>();

    return {
      today: Number(row?.today ?? 0),
      last7Days: Number(row?.last7Days ?? 0),
      last30Days: Number(row?.last30Days ?? 0),
      allTime: Number(row?.allTime ?? 0),
    };
  }

  /**
   * Counts the rows of a table by the week their date falls in, over the
   * last {@link WEEKS_IN_SERIES} weeks.
   *
   * Weeks start on Monday, as PostgreSQL's `date_trunc('week')` has them, and
   * every week is present, a week with nothing in it as zero.
   *
   * @param now - The moment the series ends.
   * @param query - What to count.
   * @returns The series, oldest week first.
   */
  private async countByWeek(
    now: Date,
    query: SeriesQuery,
  ): Promise<WeeklyCountDto[]> {
    const weeks = mondaysOfLastWeeks(now);
    const { entity, dateColumn, conditions = [] } = query;
    const builder = this._dataSource
      .createQueryBuilder(entity, ROW)
      .select(
        `to_char(date_trunc('week', ${dateColumn}), 'YYYY-MM-DD')`,
        'week',
      )
      .addSelect('COUNT(*)::int', 'count')
      .where(`${dateColumn} >= :since`, { since: weeks[0].toISOString() })
      .groupBy('week');
    if (query.includeDeleted) {
      builder.withDeleted();
    }
    for (const condition of conditions) {
      builder.andWhere(condition);
    }

    const rows = await builder.getRawMany<{
      week: string;
      count: number | string;
    }>();
    const counts = new Map(rows.map(row => [row.week, Number(row.count)]));

    return weeks.map(week => {
      const weekStarting = week.toISOString().slice(0, 10);

      return { weekStarting, count: counts.get(weekStarting) ?? 0 };
    });
  }
}

/**
 * Where the three bounded windows start: today at 00:00 UTC, and seven and
 * thirty days before now.
 *
 * @param now - Now.
 * @returns The starts.
 */
export function startsOfWindows(now: Date): WindowStarts {
  return {
    today: new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    ),
    last7Days: new Date(now.getTime() - 7 * DAY_MS),
    last30Days: new Date(now.getTime() - 30 * DAY_MS),
  };
}

/**
 * The window starts as query parameters.
 *
 * Sent as ISO text rather than as dates: the user table's columns are
 * `timestamp` without a zone, holding UTC, and PostgreSQL reads an ISO
 * instant into one by dropping its `Z`, which is right, whereas a `Date`
 * goes over in the process's own zone and would be read wrongly anywhere but
 * UTC. A `timestamptz` column reads the same text correctly either way.
 *
 * @param windows - The starts.
 * @returns The same, as text.
 */
function asParameters(windows: WindowStarts): Record<string, string> {
  return {
    today: windows.today.toISOString(),
    last7Days: windows.last7Days.toISOString(),
    last30Days: windows.last30Days.toISOString(),
  };
}

/**
 * The Mondays, at 00:00 UTC, of the last {@link WEEKS_IN_SERIES} weeks, the
 * current week's last.
 *
 * @param now - Now.
 * @returns The Mondays, oldest first.
 */
export function mondaysOfLastWeeks(now: Date): Date[] {
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  // getUTCDay has Sunday as 0; a week starts on the Monday before it.
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  const thisMonday = today - daysSinceMonday * DAY_MS;

  return Array.from(
    { length: WEEKS_IN_SERIES },
    (_, index) =>
      new Date(thisMonday - (WEEKS_IN_SERIES - 1 - index) * 7 * DAY_MS),
  );
}

import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { Between, DataSource, In, IsNull } from 'typeorm';

import { ScopeEventAttendanceEntity } from '../../events/entities/scope-event-attendance.entity';
import { ScopeEventOccurrenceEntity } from '../../events/entities/scope-event-occurrence.entity';
import { ScopeEventRsvpEntity } from '../../events/entities/scope-event-rsvp.entity';
import { ScopeEventEntity } from '../../events/entities/scope-event.entity';
import {
  OccurrenceStatus,
  RsvpResponse,
} from '../../events/enums/scope-event.enums';
import { FleetHoldingChangeEntity } from '../../holdings/entities/fleet-holding-change.entity';
import { FleetHoldingHistoryEntity } from '../../holdings/entities/fleet-holding-history.entity';
import { FleetHoldingTrackEntity } from '../../holdings/entities/fleet-holding-track.entity';
import { FleetHoldingTypeEntity } from '../../holdings/entities/fleet-holding-type.entity';
import { FleetApplicationEntity } from '../../recruitment/entities/fleet-application.entity';
import { FleetInvitationEntity } from '../../recruitment/entities/fleet-invitation.entity';
import { FleetApplicationRoute } from '../../recruitment/enums/fleet-application-route.enum';
import { FleetApplicationStatus } from '../../recruitment/enums/fleet-application-status.enum';
import { FleetInvitationStatus } from '../../recruitment/enums/fleet-invitation-status.enum';
import { usernamesFor } from '../../recruitment/utilities/recruitment-names.utility';
import {
  AttendanceMemberRowDto,
  AttendanceOccurrenceRowDto,
  FleetAttendanceReportDto,
  FleetHoldingsReportDto,
  FleetRecordReportHeaderDto,
  FleetRecruitmentReportDto,
  HoldingsChangeRowDto,
  RecruitmentMonthRowDto,
} from '../dto/fleet-record-report.dto';
import { FleetReportQueryDto } from '../dto/fleet-report-query.dto';
import { FleetReportView } from '../enums/fleet-report-view.enum';
import { FleetReport } from '../enums/fleet-report.enum';
import {
  REPORT_MINIMUM_COHORT,
  suppressCount,
  suppressGroup,
} from '../utilities/report-suppression.utility';

/** How far back a report reaches when no span is asked for, in months. */
const DEFAULT_SPAN_MONTHS = 12;

/** One day, in milliseconds. */
const DAY = 86_400_000;

/** The order routes are listed in. */
const ROUTE_ORDER: readonly FleetApplicationRoute[] = [
  FleetApplicationRoute.APPLICATION,
  FleetApplicationRoute.OPEN_JOIN,
  FleetApplicationRoute.INVITATION,
];

/** What a report built from the Fleet's own records is read over. */
export interface FleetRecordReportContext {
  readonly fleetId: string;
  readonly header: FleetRecordReportHeaderDto;
  readonly from: Date;
  readonly to: Date;
}

/** One month's requests by one route, being counted. */
interface RecruitmentTally {
  received: number;
  accepted: number;
  declined: number;
  withdrawn: number;
  lapsed: number;
  pending: number;
  days: number[];
}

/**
 * Reports built from a Fleet's own records rather than its roster (FC-030):
 * who came to its events, how its recruitment went, and how its holdings
 * changed.
 *
 * Steve's decisions of 28 September 2026: attendance covers the Fleet's own
 * events, shown per person to `reports.view` holders alone and as counts
 * and rates to anybody else the Owner chooses; recruitment is counts per
 * month and route, and the median days to a decision, never a name;
 * holdings are public, like the Holdings page, and never say who recorded
 * them. Each reads the last twelve months unless another span is asked
 * for, and hides a figure counting one to four people in an aggregate
 * view, as the roster's reports do.
 */
@Injectable()
export class FleetRecordReportsService {
  /**
   * Creates an instance of FleetRecordReportsService.
   *
   * @param _dataSource - The database.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
  ) {}

  /**
   * Says what a report will be read over.
   *
   * @param fleetId - The Fleet.
   * @param report - The report.
   * @param view - How much of it the viewer is shown.
   * @param query - The span asked for, if any.
   * @param now - The moment.
   * @returns The context.
   * @throws BadRequestException when the span ends before it starts.
   */
  open(
    fleetId: string,
    report: FleetReport,
    view: FleetReportView,
    query: FleetReportQueryDto,
    now: Date = new Date(),
  ): FleetRecordReportContext {
    const to = query.to === undefined ? now : new Date(query.to);
    const from =
      query.from === undefined
        ? new Date(
            Date.UTC(
              to.getUTCFullYear(),
              to.getUTCMonth() - DEFAULT_SPAN_MONTHS,
              to.getUTCDate(),
            ),
          )
        : new Date(query.from);

    if (to <= from) {
      throw new BadRequestException('The span has to end after it starts.');
    }

    return {
      fleetId,
      from,
      to,
      header: {
        report,
        view,
        range: { from, to },
        minimumCohort: REPORT_MINIMUM_COHORT,
      },
    };
  }

  /**
   * Who came to the Fleet's own events that started in the span.
   *
   * @param context - The Fleet, span and view.
   * @param now - The moment, since only what has started is counted.
   * @returns The report.
   */
  async attendance(
    context: FleetRecordReportContext,
    now: Date = new Date(),
  ): Promise<FleetAttendanceReportDto> {
    const manager = this._dataSource.manager;
    const full = context.header.view === FleetReportView.FULL;
    const events = new Map(
      (
        await manager.find(ScopeEventEntity, {
          where: { fleetId: context.fleetId },
          select: { id: true, title: true },
        })
      ).map(event => [event.id, event.title]),
    );
    const until = now < context.to ? now : context.to;
    const occurrences =
      events.size === 0 || until <= context.from
        ? []
        : await manager.find(ScopeEventOccurrenceEntity, {
            where: {
              eventId: In([...events.keys()]),
              status: OccurrenceStatus.SCHEDULED,
              startsAt: Between(context.from, until),
            },
            order: { startsAt: 'ASC', id: 'ASC' },
          });
    const ids = occurrences.map(occurrence => occurrence.id);
    const [records, answers] =
      ids.length === 0
        ? [[], []]
        : await Promise.all([
            manager.find(ScopeEventAttendanceEntity, {
              where: { occurrenceId: In(ids) },
            }),
            manager.find(ScopeEventRsvpEntity, {
              where: {
                occurrenceId: In(ids),
                response: RsvpResponse.GOING,
                waitlistedAt: IsNull(),
              },
            }),
          ]);
    const rows: AttendanceOccurrenceRowDto[] = occurrences.map(occurrence => {
      const recorded = records.filter(
        record => record.occurrenceId === occurrence.id,
      );
      const attended = recorded.filter(record => record.attended).length;

      return {
        occurrenceId: occurrence.id,
        eventId: occurrence.eventId,
        title: events.get(occurrence.eventId) as string,
        startsAt: occurrence.startsAt,
        ...shownAttendance(
          answers.filter(answer => answer.occurrenceId === occurrence.id)
            .length,
          attended,
          recorded.length - attended,
          full,
        ),
      };
    });
    const attended = records.filter(record => record.attended).length;
    const totals = shownAttendance(
      0,
      attended,
      records.length - attended,
      full,
    );

    return {
      ...context.header,
      occurrences: rows,
      totals: {
        occurrences: occurrences.length,
        attended: totals.attended,
        absent: totals.absent,
        rate: totals.rate,
      },
      members: full ? await this.membersOf(records) : null,
    };
  }

  /**
   * How applications and invitations made in the span turned out, month by
   * month and route by route.
   *
   * @param context - The Fleet, span and view.
   * @param now - The moment, for invitations run out unanswered.
   * @returns The report.
   */
  async recruitment(
    context: FleetRecordReportContext,
    now: Date = new Date(),
  ): Promise<FleetRecruitmentReportDto> {
    const manager = this._dataSource.manager;
    const span = Between(context.from, context.to);
    const [applications, invitations] = await Promise.all([
      manager.find(FleetApplicationEntity, {
        where: {
          fleetId: context.fleetId,
          submittedAt: span,
          // An accepted invitation is counted as the invitation it was.
          route: In([
            FleetApplicationRoute.APPLICATION,
            FleetApplicationRoute.OPEN_JOIN,
          ]),
        },
      }),
      manager.find(FleetInvitationEntity, {
        where: { fleetId: context.fleetId, createdAt: span },
      }),
    ]);
    const tallies = new Map<string, RecruitmentTally>();
    const tallyOf = (at: Date, route: FleetApplicationRoute) => {
      const key = `${at.toISOString().slice(0, 7)}|${route}`;
      const tally = tallies.get(key) ?? {
        received: 0,
        accepted: 0,
        declined: 0,
        withdrawn: 0,
        lapsed: 0,
        pending: 0,
        days: [],
      };

      tallies.set(key, tally);
      tally.received += 1;

      return tally;
    };

    for (const application of applications) {
      const tally = tallyOf(application.submittedAt, application.route);

      switch (application.status) {
        case FleetApplicationStatus.ACCEPTED:
        case FleetApplicationStatus.REJECTED:
          tally[
            application.status === FleetApplicationStatus.ACCEPTED
              ? 'accepted'
              : 'declined'
          ] += 1;
          tally.days.push(
            daysBetween(application.submittedAt, application.decidedAt),
          );
          break;
        case FleetApplicationStatus.WITHDRAWN:
          tally.withdrawn += 1;
          break;
        default:
          tally.pending += 1;
      }
    }

    for (const invitation of invitations) {
      const tally = tallyOf(
        invitation.createdAt,
        FleetApplicationRoute.INVITATION,
      );

      switch (invitation.status) {
        case FleetInvitationStatus.ACCEPTED:
        case FleetInvitationStatus.DECLINED:
          tally[
            invitation.status === FleetInvitationStatus.ACCEPTED
              ? 'accepted'
              : 'declined'
          ] += 1;
          tally.days.push(
            daysBetween(invitation.createdAt, invitation.answeredAt),
          );
          break;
        case FleetInvitationStatus.WITHDRAWN:
          tally.withdrawn += 1;
          break;
        case FleetInvitationStatus.LAPSED:
          tally.lapsed += 1;
          break;
        default:
          // Pending past its deadline is as good as lapsed.
          tally[invitation.expiresAt <= now ? 'lapsed' : 'pending'] += 1;
      }
    }

    const full = context.header.view === FleetReportView.FULL;
    const months: RecruitmentMonthRowDto[] = [...tallies]
      .map(([key, tally]) => {
        const [month, route] = key.split('|') as [
          string,
          FleetApplicationRoute,
        ];

        return { month, route, ...shownRecruitment(tally, full) };
      })
      .sort(
        (a, b) =>
          a.month.localeCompare(b.month) ||
          ROUTE_ORDER.indexOf(a.route) - ROUTE_ORDER.indexOf(b.route),
      );

    return { ...context.header, months };
  }

  /**
   * Every tier the Fleet's holdings moved in the span, newest first.
   *
   * @param context - The Fleet and span.
   * @returns The report.
   */
  async holdings(
    context: FleetRecordReportContext,
  ): Promise<FleetHoldingsReportDto> {
    const manager = this._dataSource.manager;
    const changes = await manager.find(FleetHoldingChangeEntity, {
      where: {
        fleetId: context.fleetId,
        createdAt: Between(context.from, context.to),
      },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    const [moves, types, tracks] =
      changes.length === 0
        ? [[], [], []]
        : await Promise.all([
            manager.find(FleetHoldingHistoryEntity, {
              where: { changeId: In(changes.map(change => change.id)) },
            }),
            manager.find(FleetHoldingTypeEntity),
            manager.find(FleetHoldingTrackEntity),
          ]);
    const holdingNames = new Map(types.map(type => [type.code, type.name]));
    const trackOf = new Map(tracks.map(track => [track.code, track]));
    // A track no longer in the catalogue goes first rather than being lost.
    const positionOf = (code: string): number =>
      trackOf.get(code)?.position ?? 0;
    const rows: HoldingsChangeRowDto[] = changes.flatMap(change =>
      moves
        .filter(move => move.changeId === change.id)
        .sort((a, b) => positionOf(a.trackCode) - positionOf(b.trackCode))
        .map(move => ({
          at: change.createdAt,
          holding:
            holdingNames.get(change.holdingTypeCode) ?? change.holdingTypeCode,
          track: trackOf.get(move.trackCode)?.name ?? move.trackCode,
          from: move.tierBefore,
          to: move.tier,
        })),
    );

    return { ...context.header, changes: rows };
  }

  /**
   * Each person's attendance over the span, most attended first.
   *
   * @param records - Every record in the span.
   * @returns One row per person, by username.
   */
  private async membersOf(
    records: readonly ScopeEventAttendanceEntity[],
  ): Promise<AttendanceMemberRowDto[]> {
    const byPerson = new Map<string, { attended: number; absent: number }>();

    for (const record of records) {
      const tally = byPerson.get(record.userId) ?? { attended: 0, absent: 0 };

      tally[record.attended ? 'attended' : 'absent'] += 1;
      byPerson.set(record.userId, tally);
    }

    const names = await usernamesFor(this._dataSource.manager, [
      ...byPerson.keys(),
    ]);

    return [...byPerson]
      .map(([userId, tally]) => ({
        username: names.get(userId) ?? null,
        ...tally,
      }))
      .sort(
        (a, b) =>
          b.attended - a.attended ||
          // Somebody with no username left comes after those named.
          Number(a.username === null) - Number(b.username === null) ||
          (a.username ?? '').localeCompare(b.username ?? '', 'en'),
      );
  }
}

/**
 * Shows an occurrence's figures, hiding what an aggregate view must.
 *
 * @param going - Going with a place.
 * @param attended - Recorded as having come.
 * @param absent - Recorded as not having come.
 * @param full - Whether the viewer sees them in full.
 * @returns The figures, and the rate where both are shown.
 */
function shownAttendance(
  going: number,
  attended: number,
  absent: number,
  full: boolean,
): Pick<AttendanceOccurrenceRowDto, 'going' | 'attended' | 'absent' | 'rate'> {
  const [shownAttended, shownAbsent] = full
    ? [attended, absent]
    : suppressGroup([attended, absent]);
  const rate =
    shownAttended === null || shownAbsent === null || attended + absent === 0
      ? null
      : Math.round((attended / (attended + absent)) * 100) / 100;

  return {
    going: full ? going : suppressCount(going),
    attended: shownAttended,
    absent: shownAbsent,
    rate,
  };
}

/**
 * Shows a month's requests by one route, hiding what an aggregate view
 * must. The outcomes account for every request, so they are one group.
 *
 * @param tally - What was counted.
 * @param full - Whether the viewer sees it in full.
 * @returns The figures.
 */
function shownRecruitment(
  tally: RecruitmentTally,
  full: boolean,
): Omit<RecruitmentMonthRowDto, 'month' | 'route'> {
  const outcomes = [
    tally.accepted,
    tally.declined,
    tally.withdrawn,
    tally.lapsed,
    tally.pending,
  ];
  const [accepted, declined, withdrawn, lapsed, pending] = full
    ? outcomes
    : suppressGroup(outcomes);

  return {
    received: full ? tally.received : suppressCount(tally.received),
    accepted,
    declined,
    withdrawn,
    lapsed,
    pending,
    medianDaysToDecision:
      tally.days.length === 0 ||
      (!full && tally.days.length < REPORT_MINIMUM_COHORT)
        ? null
        : median(tally.days),
  };
}

/**
 * The whole days, to a tenth, between asking and a decision.
 *
 * @param asked - When it was asked.
 * @param decided - When it was decided.
 * @returns The days.
 */
function daysBetween(asked: Date, decided: Date | null): number {
  return (
    Math.round((((decided ?? asked).getTime() - asked.getTime()) / DAY) * 10) /
    10
  );
}

/**
 * The middle of some numbers.
 *
 * @param values - At least one.
 * @returns The median, to a tenth.
 */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round(((sorted[middle - 1] + sorted[middle]) / 2) * 10) / 10;
}

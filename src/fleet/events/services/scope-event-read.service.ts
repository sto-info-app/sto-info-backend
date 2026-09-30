import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import {
  Between,
  DataSource,
  EntityManager,
  In,
  IsNull,
  MoreThan,
} from 'typeorm';

import { GovernanceScope } from '../../governance/utilities/governance-scope.utility';
import { usernamesFor } from '../../recruitment/utilities/recruitment-names.utility';
import { ScopePlace, scopePlaceOf } from '../../utilities/scope-place.utility';
import {
  AttendanceDto,
  AttendanceSheetDto,
  CalendarEntryDto,
  OccurrenceDetailDto,
  OccurrenceSummaryDto,
  ScopeEventActionDto,
  ScopeEventCalendarDto,
  ScopeEventCalendarQueryDto,
  ScopeEventDetailDto,
  ScopeEventSummaryDto,
  UpcomingEntryDto,
  UpcomingEventsDto,
} from '../dto/scope-event.dto';
import { ScopeEventActionEntity } from '../entities/scope-event-action.entity';
import { ScopeEventAttendanceEntity } from '../entities/scope-event-attendance.entity';
import { ScopeEventAudienceMemberEntity } from '../entities/scope-event-audience-member.entity';
import { ScopeEventOccurrenceEntity } from '../entities/scope-event-occurrence.entity';
import { ScopeEventReminderEntity } from '../entities/scope-event-reminder.entity';
import { ScopeEventRsvpEntity } from '../entities/scope-event-rsvp.entity';
import { ScopeEventEntity } from '../entities/scope-event.entity';
import {
  OccurrenceStatus,
  RsvpResponse,
  ScopeEventStatus,
} from '../enums/scope-event.enums';
import { scopeMemberIds } from '../utilities/event-members.utility';
import {
  findEventInScope,
  findOccurrenceOf,
} from '../utilities/event-scope.utility';
import {
  EventViewer,
  ScopeEventAccessService,
} from './scope-event-access.service';
import { ScopeEventRsvpService } from './scope-event-rsvp.service';

/** One day, in milliseconds. */
const DAY = 86_400_000;

/** How much of the calendar one read covers when nothing is asked. */
const DEFAULT_SPAN_DAYS = 31;

/** The most of the calendar one read may cover. */
const MAX_SPAN_DAYS = 93;

/** How many occurrences an event's page lists ahead. */
const UPCOMING = 10;

/** How far ahead somebody's own list reaches, in days. */
const MINE_DAYS = 30;

/** An event somebody may see, who they are at its scope, and where it is. */
interface ShownEvent {
  readonly viewer: EventViewer;
  readonly place: ScopePlace;
}

/**
 * What a reader is shown of a scope's events (FC-028).
 *
 * Every read asks who the reader is at the scope, then which events they
 * may see, before anything is read about them. Counts are for everyone the
 * event is shown to; who answered, for the scope's members and managers;
 * Can't go, attendance and the change log, for managers alone — Steve's
 * decisions of 28 September 2026. A reader always sees their own answer and
 * attendance.
 */
@Injectable()
export class ScopeEventReadService {
  /**
   * Creates an instance of ScopeEventReadService.
   *
   * @param _dataSource - The database.
   * @param _access - Says who may see a scope's events.
   * @param _rsvps - Answers and the waitlist.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _access: ScopeEventAccessService,
    private readonly _rsvps: ScopeEventRsvpService,
  ) {}

  /**
   * Reads a stretch of a scope's calendar: each occurrence, cancelled ones
   * included, of the events the reader may see.
   *
   * @param scope - The scope.
   * @param userId - The reader, or null when signed out.
   * @param query - From and to.
   * @returns The occurrences, earliest first.
   * @throws BadRequestException when the stretch is backwards or too long.
   */
  async calendar(
    scope: GovernanceScope,
    userId: string | null,
    query: ScopeEventCalendarQueryDto,
  ): Promise<ScopeEventCalendarDto> {
    const viewer = await this._access.viewerAt(scope, userId);
    const from = query.from === undefined ? new Date() : new Date(query.from);
    const to =
      query.to === undefined
        ? new Date(from.getTime() + DEFAULT_SPAN_DAYS * DAY)
        : new Date(query.to);

    if (to <= from || to.getTime() - from.getTime() > MAX_SPAN_DAYS * DAY) {
      throw new BadRequestException(
        `Ask for up to ${MAX_SPAN_DAYS} days, with the end after the start.`,
      );
    }

    const manager = this._dataSource.manager;
    const events = await this.visibleEvents(
      viewer,
      await manager.find(ScopeEventEntity, {
        where: {
          communityId: scope.communityId,
          fleetId: scope.fleetId ?? IsNull(),
          armadaId: scope.armadaId ?? IsNull(),
        },
      }),
    );
    const occurrences =
      events.size === 0
        ? []
        : await manager.find(ScopeEventOccurrenceEntity, {
            where: {
              eventId: In([...events.keys()]),
              startsAt: Between(from, to),
            },
            order: { startsAt: 'ASC', id: 'ASC' },
          });
    const summaries = await this.summariesOf(manager, occurrences, viewer);

    return {
      from,
      to,
      entries: occurrences.map((occurrence, index): CalendarEntryDto => ({
        event: this.summaryOf(
          events.get(occurrence.eventId) as ScopeEventEntity,
        ),
        occurrence: summaries[index],
      })),
      mayManage: viewer.mayManage,
      isOpen: viewer.isOpen,
      isSuspended: viewer.isSuspended,
    };
  }

  /**
   * Reads an event in full, with what lies ahead of it.
   *
   * @param scope - The scope.
   * @param eventId - The event.
   * @param userId - The reader, or null when signed out.
   * @returns The event.
   * @throws NotFoundException when there is no such event they may see.
   */
  async detail(
    scope: GovernanceScope,
    eventId: string,
    userId: string | null,
  ): Promise<ScopeEventDetailDto> {
    const viewer = await this._access.viewerAt(scope, userId);
    const manager = this._dataSource.manager;
    const event = await this.visibleEvent(manager, scope, eventId, viewer);
    const upcoming = await manager.find(ScopeEventOccurrenceEntity, {
      where: { eventId, startsAt: MoreThan(new Date()) },
      order: { startsAt: 'ASC', id: 'ASC' },
      take: UPCOMING,
    });
    const chosen = viewer.mayManage
      ? await manager.find(ScopeEventAudienceMemberEntity, {
          where: { eventId },
        })
      : [];
    const reminder =
      userId === null
        ? null
        : await manager.findOne(ScopeEventReminderEntity, {
            where: { eventId, userId },
          });

    return {
      ...this.summaryOf(event),
      description: event.description,
      startDate: event.startDate,
      startTime: event.startTime,
      interval: event.interval,
      weekdays: event.weekdays,
      monthDay: event.monthDay,
      monthWeek: event.monthWeek,
      monthWeekday: event.monthWeekday,
      endsOn: event.endsOn,
      occurrenceLimit: event.occurrenceLimit,
      durationMinutes: event.durationMinutes,
      audienceFleetIds: chosen
        .map(member => member.fleetId)
        .filter((fleetId): fleetId is string => fleetId !== null),
      audienceRoles: chosen
        .map(member => member.role)
        .filter(role => role !== null),
      upcoming: await this.summariesOf(manager, upcoming, viewer),
      myReminders: reminder?.leadMinutes ?? [],
      mayManage: viewer.mayManage,
      mayAnswer: await this._access.mayAnswer(event, viewer),
      isOpen: viewer.isOpen,
    };
  }

  /**
   * Reads one occurrence in full: its counts, and who answered for those
   * who may see that.
   *
   * @param scope - The scope.
   * @param eventId - The event.
   * @param occurrenceId - The occurrence.
   * @param userId - The reader, or null when signed out.
   * @returns The occurrence.
   * @throws NotFoundException when there is no such occurrence they may see.
   */
  async occurrence(
    scope: GovernanceScope,
    eventId: string,
    occurrenceId: string,
    userId: string | null,
  ): Promise<OccurrenceDetailDto> {
    const viewer = await this._access.viewerAt(scope, userId);
    const manager = this._dataSource.manager;
    const event = await this.visibleEvent(manager, scope, eventId, viewer);
    const occurrence = await findOccurrenceOf(manager, eventId, occurrenceId);
    const [summary] = await this.summariesOf(manager, [occurrence], viewer);

    return {
      event: this.summaryOf(event),
      occurrence: summary,
      people: viewer.seesNames
        ? await this._rsvps.people(manager, occurrenceId, viewer.mayManage)
        : [],
      myAttendance:
        userId === null
          ? null
          : ((await this.attendanceOf(manager, occurrenceId, userId))[0] ??
            null),
      mayAnswer: await this._access.mayAnswer(event, viewer),
      mayManage: viewer.mayManage,
    };
  }

  /**
   * Reads what a manager recorded of who came to an occurrence, and whom
   * they may record: everybody who answered, in answer order, then the
   * scope's members who did not, by username (FC-030).
   *
   * @param scope - The scope.
   * @param eventId - The event.
   * @param occurrenceId - The occurrence.
   * @param userId - The manager.
   * @returns The records, and the people who may be recorded.
   * @throws ForbiddenException when the reader does not run the events.
   */
  async attendance(
    scope: GovernanceScope,
    eventId: string,
    occurrenceId: string,
    userId: string,
  ): Promise<AttendanceSheetDto> {
    const viewer = await this._access.viewerAt(scope, userId);

    this.assertManager(viewer);

    const manager = this._dataSource.manager;

    await findEventInScope(manager, scope, eventId);
    await findOccurrenceOf(manager, eventId, occurrenceId);

    const people = await this._rsvps.people(manager, occurrenceId, true);
    const answered = new Set(people.map(person => person.userId));
    const others = (await scopeMemberIds(manager, scope)).filter(
      memberId => !answered.has(memberId),
    );
    const names = await usernamesFor(manager, others);

    return {
      records: await this.attendanceOf(manager, occurrenceId, null),
      candidates: [
        ...people.map(person => ({
          userId: person.userId,
          username: person.username,
          response: person.response,
        })),
        ...others
          .map(memberId => ({
            userId: memberId,
            username: names.get(memberId) ?? null,
            response: null,
          }))
          .sort((a, b) =>
            (a.username ?? '').localeCompare(b.username ?? '', 'en'),
          ),
      ],
    };
  }

  /**
   * Reads somebody's own next thirty days (FC-030): the occurrences still
   * going ahead that they answered Going or Maybe, are waiting for, or asked
   * to be reminded of, of events they may still see.
   *
   * @param userId - The person.
   * @returns Each occurrence with its event and scope, soonest first.
   */
  async upcomingFor(userId: string): Promise<UpcomingEventsDto> {
    const manager = this._dataSource.manager;
    const now = new Date();
    const window = {
      startsAt: Between(now, new Date(now.getTime() + MINE_DAYS * DAY)),
      status: OccurrenceStatus.SCHEDULED,
    };
    const [answers, reminders] = await Promise.all([
      manager.find(ScopeEventRsvpEntity, {
        where: {
          userId,
          response: In([RsvpResponse.GOING, RsvpResponse.MAYBE]),
        },
      }),
      manager.find(ScopeEventReminderEntity, { where: { userId } }),
    ]);
    const where = [
      ...(answers.length === 0
        ? []
        : [{ ...window, id: In(answers.map(answer => answer.occurrenceId)) }]),
      ...(reminders.length === 0
        ? []
        : [
            {
              ...window,
              eventId: In(reminders.map(reminder => reminder.eventId)),
            },
          ]),
    ];

    if (where.length === 0) {
      return { entries: [] };
    }

    const occurrences = await manager.find(ScopeEventOccurrenceEntity, {
      where,
      order: { startsAt: 'ASC', id: 'ASC' },
    });
    const events = new Map(
      (
        await manager.find(ScopeEventEntity, {
          where: {
            id: In([...new Set(occurrences.map(each => each.eventId))]),
            status: ScopeEventStatus.ACTIVE,
          },
        })
      ).map(event => [event.id, event]),
    );
    const shown = new Map<string, Promise<ShownEvent | null>>();
    const entries: UpcomingEntryDto[] = [];

    for (const occurrence of occurrences) {
      const event = events.get(occurrence.eventId);

      if (event === undefined) {
        continue;
      }

      if (!shown.has(event.id)) {
        shown.set(event.id, this.shownTo(manager, event, userId));
      }

      const found = await shown.get(event.id);

      if (!found) {
        continue;
      }

      const [summary] = await this.summariesOf(
        manager,
        [occurrence],
        found.viewer,
      );

      entries.push({
        event: this.summaryOf(event),
        occurrence: summary,
        scope: {
          kind: found.place.kind,
          name: found.place.name,
          path: found.place.path,
        },
      });
    }

    return { entries };
  }

  /**
   * Reads an event's change log, newest first.
   *
   * @param scope - The scope.
   * @param eventId - The event.
   * @param userId - The manager.
   * @returns Each change.
   * @throws ForbiddenException when the reader does not run the events.
   */
  async history(
    scope: GovernanceScope,
    eventId: string,
    userId: string,
  ): Promise<ScopeEventActionDto[]> {
    const viewer = await this._access.viewerAt(scope, userId);

    this.assertManager(viewer);

    const manager = this._dataSource.manager;

    await findEventInScope(manager, scope, eventId);

    const actions = await manager.find(ScopeEventActionEntity, {
      where: { eventId },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    const names = await usernamesFor(
      manager,
      actions.flatMap(action => [action.actorUserId, action.subjectUserId]),
    );

    return actions.map(action => ({
      id: action.id,
      action: action.action,
      occurrenceId: action.occurrenceId,
      actorName:
        action.actorUserId === null
          ? null
          : (names.get(action.actorUserId) ?? null),
      subjectName:
        action.subjectUserId === null
          ? null
          : (names.get(action.subjectUserId) ?? null),
      detail: action.detail,
      createdAt: action.createdAt,
    }));
  }

  /**
   * Finds an event of this scope the reader may see.
   *
   * @param manager - The manager to read through.
   * @param scope - The scope.
   * @param eventId - The event.
   * @param viewer - Who is reading.
   * @returns The event.
   * @throws NotFoundException when there is none they may see — the same
   *   answer as for none at all.
   */
  private async visibleEvent(
    manager: EntityManager,
    scope: GovernanceScope,
    eventId: string,
    viewer: EventViewer,
  ): Promise<ScopeEventEntity> {
    const event = await findEventInScope(manager, scope, eventId);

    if (!(await this._access.canSee(event, viewer))) {
      throw new NotFoundException('Not found');
    }

    return event;
  }

  /**
   * Asks whether somebody may still see an event, and names its scope.
   *
   * @param manager - The manager to read through.
   * @param event - The event.
   * @param userId - The person.
   * @returns Who they are there and where it is, or null when they may not
   *   see it or its scope has gone.
   */
  private async shownTo(
    manager: EntityManager,
    event: ScopeEventEntity,
    userId: string,
  ): Promise<ShownEvent | null> {
    const viewer = await this._access.viewerOf(event, userId);

    if (viewer === null || !(await this._access.canSee(event, viewer))) {
      return null;
    }

    const place = await scopePlaceOf(manager, event);

    return place === null ? null : { viewer, place };
  }

  /**
   * Keeps the events the reader may see.
   *
   * @param viewer - Who is reading.
   * @param events - The scope's events.
   * @returns Those they may see, by ID.
   */
  private async visibleEvents(
    viewer: EventViewer,
    events: readonly ScopeEventEntity[],
  ): Promise<Map<string, ScopeEventEntity>> {
    const visible = new Map<string, ScopeEventEntity>();

    for (const event of events) {
      if (await this._access.canSee(event, viewer)) {
        visible.set(event.id, event);
      }
    }

    return visible;
  }

  /**
   * Shows occurrences as a calendar does, with their counts and the
   * reader's own answers.
   *
   * @param manager - The manager to read through.
   * @param occurrences - The occurrences.
   * @param viewer - Who is reading.
   * @returns Each summary, in the same order.
   */
  private async summariesOf(
    manager: EntityManager,
    occurrences: readonly ScopeEventOccurrenceEntity[],
    viewer: EventViewer,
  ): Promise<OccurrenceSummaryDto[]> {
    const counts = await this._rsvps.countsFor(
      manager,
      occurrences.map(occurrence => occurrence.id),
      viewer.mayManage,
    );
    const summaries: OccurrenceSummaryDto[] = [];

    for (const occurrence of occurrences) {
      summaries.push({
        id: occurrence.id,
        key: occurrence.occurrenceKey,
        localStart: occurrence.localStart,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt,
        adjustment: occurrence.adjustment,
        status: occurrence.status,
        movedFromStartsAt: occurrence.movedFromStartsAt,
        counts: counts.get(occurrence.id) as OccurrenceSummaryDto['counts'],
        mine: await this._rsvps.mine(manager, occurrence.id, viewer.userId),
      });
    }

    return summaries;
  }

  /**
   * Shows an event as a calendar does.
   *
   * @param event - The event.
   * @returns The summary.
   */
  private summaryOf(event: ScopeEventEntity): ScopeEventSummaryDto {
    return {
      id: event.id,
      title: event.title,
      audience: event.audience,
      timezone: event.timezone,
      capacity: event.capacity,
      externalUrl: event.externalUrl,
      status: event.status,
      recurrence: event.recurrence,
    };
  }

  /**
   * Reads the attendance recorded at an occurrence.
   *
   * @param manager - The manager to read through.
   * @param occurrenceId - The occurrence.
   * @param userId - One person, or null for everyone.
   * @returns Each record, by username.
   */
  private async attendanceOf(
    manager: EntityManager,
    occurrenceId: string,
    userId: string | null,
  ): Promise<AttendanceDto[]> {
    const records = await manager.find(ScopeEventAttendanceEntity, {
      where: { occurrenceId, ...(userId === null ? {} : { userId }) },
      order: { recordedAt: 'ASC', id: 'ASC' },
    });
    const names = await usernamesFor(
      manager,
      records.map(record => record.userId),
    );
    const characters = await this._rsvps.characterNames(
      manager,
      records.map(record => record.characterId),
    );

    return records
      .map(record => ({
        userId: record.userId,
        username: names.get(record.userId) ?? null,
        attended: record.attended,
        characterName:
          record.characterId === null
            ? null
            : (characters.get(record.characterId) ?? null),
        recordedAt: record.recordedAt,
      }))
      .sort((a, b) => (a.username ?? '').localeCompare(b.username ?? '', 'en'));
  }

  /**
   * Requires that the reader runs the scope's events.
   *
   * @param viewer - Who is reading.
   * @throws ForbiddenException when they do not.
   */
  private assertManager(viewer: EventViewer): void {
    if (!viewer.mayManage) {
      throw new ForbiddenException('Only its event managers may read that.');
    }
  }
}

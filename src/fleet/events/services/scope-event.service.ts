import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, EntityManager, In, LessThan } from 'typeorm';

import { CRON_TIMEZONE } from 'src/cron/constants/cron.constants';
import { NotificationOutboxKind } from 'src/notification/outbox/notification-outbox-kind.enum';
import { canonicaliseTimezone } from 'src/shared/utilities/timezone.utility';

import { ActivityType } from '../../activity/enums/activity.enums';
import { recordActivity } from '../../activity/utilities/record-activity.utility';
import { FleetCommunityEntity } from '../../entities/fleet-community.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import { GovernanceScope } from '../../governance/utilities/governance-scope.utility';
import {
  EventPreviewDto,
  MoveOccurrenceDto,
  ScopeEventDefinitionDto,
} from '../dto/scope-event.dto';
import { ScopeEventActionEntity } from '../entities/scope-event-action.entity';
import { ScopeEventAudienceMemberEntity } from '../entities/scope-event-audience-member.entity';
import { ScopeEventOccurrenceEntity } from '../entities/scope-event-occurrence.entity';
import { ScopeEventEntity } from '../entities/scope-event.entity';
import { EventRecurrence } from '../enums/event-recurrence.enum';
import {
  OccurrenceStatus,
  ScopeEventActionKind,
  ScopeEventAudience,
  ScopeEventStatus,
} from '../enums/scope-event.enums';
import { cancelFutureOccurrences } from '../utilities/event-closure.utility';
import { noticeSubscribers } from '../utilities/event-notices.utility';
import {
  addMonths,
  EventSchedule,
  localDateOf,
  placeOccurrence,
  PlannedOccurrence,
  planOccurrences,
} from '../utilities/event-recurrence.utility';
import {
  assertEventActive,
  assertOccurrenceAhead,
  assertScopeOpen,
  findEventInScope,
  findOccurrenceOf,
} from '../utilities/event-scope.utility';
import {
  EventViewer,
  ScopeEventAccessService,
} from './scope-event-access.service';
import { ScopeEventRsvpService } from './scope-event-rsvp.service';

/** How far ahead occurrences are written out, in months. */
export const EVENT_HORIZON_MONTHS = 12;

/** What to say about a change to an occurrence that has started. */
const ALREADY_STARTED = 'This occurrence has started, so it cannot change.';

/** The fields an edit is logged by name for. */
const LOGGED_FIELDS = [
  'title',
  'description',
  'externalUrl',
  'audience',
  'timezone',
  'recurrence',
  'startDate',
  'startTime',
  'interval',
  'weekdays',
  'monthDay',
  'monthWeek',
  'monthWeekday',
  'endsOn',
  'occurrenceLimit',
  'durationMinutes',
  'capacity',
] as const;

/** An event's definition, checked and ready to store. */
interface CheckedDefinition {
  readonly fields: Omit<
    ScopeEventEntity,
    | 'id'
    | 'communityId'
    | 'fleetId'
    | 'armadaId'
    | 'status'
    | 'cancelledAt'
    | 'materialisedThrough'
    | 'createdByUserId'
    | 'createdAt'
    | 'updatedAt'
  >;
  readonly fleetIds: string[];
  readonly roles: FleetScopeRole[];
}

/**
 * A Community's, a Fleet's and an Armada's events, their rules and their
 * occurrences (FC-028).
 *
 * With Steve's decisions of 28 September 2026:
 *
 * - An event repeats once, weekly or monthly, on the clock of the timezone
 *   its organiser chose. Its occurrences are written out twelve months
 *   ahead, and a daily job keeps them twelve months ahead.
 * - Where the clock repeats a time the earlier is taken, and where it jumps
 *   over one the time moves forward; the preview shows each so placed.
 * - An edit changes what lies ahead only. Held occurrences, with their
 *   answers and attendance, are never touched. An occurrence still named
 *   keeps its answers; one moved, or no longer named, tells whoever is
 *   reminded of it.
 * - `events.manage` holders at the scope run its events. A closed scope's
 *   are cancelled with it, by {@link endEventsForClosure}.
 *
 * Every change is recorded in the event's change log.
 */
@Injectable()
export class ScopeEventService {
  private readonly _logger = new Logger(ScopeEventService.name);

  /**
   * Creates an instance of ScopeEventService.
   *
   * @param _dataSource - The database.
   * @param _access - Says who may see and run a scope's events.
   * @param _rsvps - Answers and the waitlist.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _access: ScopeEventAccessService,
    private readonly _rsvps: ScopeEventRsvpService,
  ) {}

  /**
   * Shows what a rule would come to over the next twelve months, without
   * saving anything.
   *
   * @param scope - The scope.
   * @param dto - The event as it would be saved.
   * @param userId - The organiser.
   * @returns The occurrences still to come, how each was placed, and any
   *   months skipped.
   */
  async preview(
    scope: GovernanceScope,
    dto: ScopeEventDefinitionDto,
    userId: string,
  ): Promise<EventPreviewDto> {
    await this.managerAt(scope, userId);

    const checked = await this.check(this._dataSource.manager, scope, dto);
    const now = new Date();
    const plan = planOccurrences(
      checked.fields as EventSchedule,
      this.horizonOf(checked.fields.timezone, now),
    );

    return {
      timezone: checked.fields.timezone,
      occurrences: plan.occurrences
        .filter(occurrence => occurrence.startsAt > now)
        .map(({ key, localStart, startsAt, endsAt, adjustment }) => ({
          key,
          localStart,
          startsAt,
          endsAt,
          adjustment,
        })),
      skippedMonths: plan.skippedMonths,
    };
  }

  /**
   * Creates an event and writes out its occurrences.
   *
   * @param scope - The scope.
   * @param dto - The event.
   * @param userId - The organiser.
   * @returns The event.
   * @throws BadRequestException when the rule is incomplete or names
   *   nothing still to come.
   * @throws ConflictException when the scope is not open.
   */
  async create(
    scope: GovernanceScope,
    dto: ScopeEventDefinitionDto,
    userId: string,
  ): Promise<ScopeEventEntity> {
    const viewer = await this.managerAt(scope, userId);

    assertScopeOpen(scope, viewer);

    return this._dataSource.transaction(async manager => {
      const checked = await this.check(manager, scope, dto);
      const now = new Date();
      const event = await manager.save(ScopeEventEntity, {
        ...checked.fields,
        communityId: scope.communityId,
        fleetId: scope.fleetId,
        armadaId: scope.armadaId,
        status: ScopeEventStatus.ACTIVE,
        cancelledAt: null,
        materialisedThrough: this.horizonOf(checked.fields.timezone, now),
        createdByUserId: userId,
      });

      await this.saveAudience(manager, event, checked);

      if ((await this.materialise(manager, event, now)) === 0) {
        throw new BadRequestException(
          'Nothing of this event lies ahead. Choose a first day to come.',
        );
      }

      await this.log(manager, event.id, ScopeEventActionKind.CREATED, userId);
      await this.feed(manager, event, ActivityType.EVENT_CREATED, userId, {
        key: event.id,
        occurredAt: now,
      });
      this._logger.log(`[create] Event created - EventId: ${event.id}`);

      return event;
    });
  }

  /**
   * Changes an event from now on.
   *
   * @param scope - The scope.
   * @param eventId - The event.
   * @param dto - The event as it should now be.
   * @param userId - The organiser.
   * @returns The event.
   * @throws NotFoundException when there is no such event here.
   * @throws BadRequestException when the rule is incomplete.
   * @throws ConflictException when the scope is not open or the event was
   *   cancelled.
   */
  async update(
    scope: GovernanceScope,
    eventId: string,
    dto: ScopeEventDefinitionDto,
    userId: string,
  ): Promise<ScopeEventEntity> {
    const viewer = await this.managerAt(scope, userId);

    assertScopeOpen(scope, viewer);

    return this._dataSource.transaction(async manager => {
      const event = await findEventInScope(manager, scope, eventId, true);

      assertEventActive(event);

      const checked = await this.check(manager, scope, dto);
      const now = new Date();
      const changed = LOGGED_FIELDS.filter(
        field =>
          JSON.stringify(event[field]) !==
          JSON.stringify(checked.fields[field]),
      );
      const capacityRose =
        checked.fields.capacity === null ||
        (event.capacity !== null && checked.fields.capacity > event.capacity);

      Object.assign(event, checked.fields);
      event.materialisedThrough = this.horizonOf(event.timezone, now);

      const saved = await manager.save(ScopeEventEntity, event);

      await manager.delete(ScopeEventAudienceMemberEntity, { eventId });
      await this.saveAudience(manager, saved, checked);
      await this.rebuild(manager, saved, now);

      if (capacityRose) {
        await this.promoteAhead(manager, saved, now);
      }

      await this.log(manager, eventId, ScopeEventActionKind.EDITED, userId, {
        detail: { changed },
      });

      return saved;
    });
  }

  /**
   * Cancels an event: every occurrence still to come.
   *
   * @param scope - The scope.
   * @param eventId - The event.
   * @param userId - The organiser.
   * @throws NotFoundException when there is no such event here.
   * @throws ConflictException when the scope is not open or it was cancelled
   *   already.
   */
  async cancel(
    scope: GovernanceScope,
    eventId: string,
    userId: string,
  ): Promise<void> {
    const viewer = await this.managerAt(scope, userId);

    assertScopeOpen(scope, viewer);

    await this._dataSource.transaction(async manager => {
      const event = await findEventInScope(manager, scope, eventId, true);

      assertEventActive(event);

      const now = new Date();
      const cancelled = await cancelFutureOccurrences(manager, eventId, now);

      event.status = ScopeEventStatus.CANCELLED;
      event.cancelledAt = now;
      await manager.save(ScopeEventEntity, event);
      await this.log(manager, eventId, ScopeEventActionKind.CANCELLED, userId, {
        detail: { occurrencesCancelled: cancelled },
      });
      await this.feed(manager, event, ActivityType.EVENT_CANCELLED, userId, {
        key: eventId,
        occurredAt: now,
      });
    });
  }

  /**
   * Cancels one occurrence, leaving the rest of the event.
   *
   * @param scope - The scope.
   * @param eventId - The event.
   * @param occurrenceId - The occurrence.
   * @param userId - The organiser.
   * @throws NotFoundException when there is no such occurrence here.
   * @throws ConflictException when the scope is not open, or it was
   *   cancelled or has started.
   */
  async cancelOccurrence(
    scope: GovernanceScope,
    eventId: string,
    occurrenceId: string,
    userId: string,
  ): Promise<void> {
    const viewer = await this.managerAt(scope, userId);

    assertScopeOpen(scope, viewer);

    await this._dataSource.transaction(async manager => {
      const event = await findEventInScope(manager, scope, eventId);
      const occurrence = await findOccurrenceOf(
        manager,
        eventId,
        occurrenceId,
        true,
      );
      const now = new Date();

      assertEventActive(event);
      assertOccurrenceAhead(occurrence, now, ALREADY_STARTED);

      occurrence.status = OccurrenceStatus.CANCELLED;
      occurrence.cancelledAt = now;
      occurrence.isException = true;
      await manager.save(ScopeEventOccurrenceEntity, occurrence);
      await noticeSubscribers(
        manager,
        NotificationOutboxKind.EVENT_CANCELLED,
        eventId,
        occurrence,
      );
      await this.log(
        manager,
        eventId,
        ScopeEventActionKind.OCCURRENCE_CANCELLED,
        userId,
        { occurrenceId },
      );
      await this.feed(
        manager,
        event,
        ActivityType.OCCURRENCE_CANCELLED,
        userId,
        {
          key: occurrenceId,
          occurredAt: now,
          detail: { startsAt: occurrence.startsAt.toISOString() },
        },
      );
    });
  }

  /**
   * Moves one occurrence to another day or time on the event's clock.
   *
   * It keeps its answers, and says where it was first due.
   *
   * @param scope - The scope.
   * @param eventId - The event.
   * @param occurrenceId - The occurrence.
   * @param dto - Where it moves to.
   * @param userId - The organiser.
   * @throws NotFoundException when there is no such occurrence here.
   * @throws BadRequestException when the new time has passed.
   * @throws ConflictException when the scope is not open, or it was
   *   cancelled or has started.
   */
  async moveOccurrence(
    scope: GovernanceScope,
    eventId: string,
    occurrenceId: string,
    dto: MoveOccurrenceDto,
    userId: string,
  ): Promise<void> {
    const viewer = await this.managerAt(scope, userId);

    assertScopeOpen(scope, viewer);

    await this._dataSource.transaction(async manager => {
      const event = await findEventInScope(manager, scope, eventId);
      const occurrence = await findOccurrenceOf(
        manager,
        eventId,
        occurrenceId,
        true,
      );
      const now = new Date();

      assertEventActive(event);
      assertOccurrenceAhead(occurrence, now, ALREADY_STARTED);

      const placed = placeOccurrence(
        dto.date,
        dto.time,
        event.timezone,
        event.durationMinutes,
      );

      if (placed.startsAt <= now) {
        throw new BadRequestException('Move it to a time still to come.');
      }

      const from = occurrence.startsAt;

      occurrence.movedFromStartsAt = occurrence.movedFromStartsAt ?? from;
      this.applyPlacement(occurrence, placed);
      occurrence.isException = true;
      await manager.save(ScopeEventOccurrenceEntity, occurrence);
      await noticeSubscribers(
        manager,
        NotificationOutboxKind.EVENT_MOVED,
        eventId,
        occurrence,
      );
      await this.log(
        manager,
        eventId,
        ScopeEventActionKind.OCCURRENCE_MOVED,
        userId,
        {
          occurrenceId,
          detail: {
            from: from.toISOString(),
            to: placed.startsAt.toISOString(),
          },
        },
      );
      await this.feed(manager, event, ActivityType.OCCURRENCE_MOVED, userId, {
        key: `${occurrenceId}:${from.toISOString()}:${placed.startsAt.toISOString()}`,
        occurredAt: now,
        detail: {
          from: from.toISOString(),
          to: placed.startsAt.toISOString(),
        },
      });
    });
  }

  /**
   * Keeps every running event written out twelve months ahead. Daily.
   *
   * @returns How many occurrences were written.
   */
  @Cron('17 2 * * *', { timeZone: CRON_TIMEZONE })
  async extendHorizons(): Promise<number> {
    const now = new Date();
    const events = await this._dataSource.manager.find(ScopeEventEntity, {
      where: {
        status: ScopeEventStatus.ACTIVE,
        materialisedThrough: LessThan(addMonths(localDateOf(now, 'UTC'), 12)),
      },
    });
    let written = 0;

    for (const event of events) {
      written += await this._dataSource.transaction(async manager => {
        const count = await this.materialise(manager, event, now);

        event.materialisedThrough = this.horizonOf(event.timezone, now);
        await manager.save(ScopeEventEntity, event);

        return count;
      });
    }

    this._logger.log(
      `[extendHorizons] Occurrences written - Events: ${events.length}, Occurrences: ${written}`,
    );

    return written;
  }

  /**
   * Requires that somebody runs the scope's events.
   *
   * @param scope - The scope.
   * @param userId - The person.
   * @returns Who they are there.
   * @throws ForbiddenException when they do not hold `events.manage`.
   */
  private async managerAt(
    scope: GovernanceScope,
    userId: string,
  ): Promise<EventViewer> {
    const viewer = await this._access.viewerAt(scope, userId);

    if (!viewer.mayManage) {
      throw new ForbiddenException('Only its event managers may do that.');
    }

    return viewer;
  }

  /**
   * Checks an event's definition and shapes it for storing.
   *
   * Only the fields its kind of rule uses are kept, so a form that sends
   * what it showed for another kind is not refused for it.
   *
   * @param manager - The manager to read through.
   * @param scope - The scope.
   * @param dto - The event as sent.
   * @returns The definition, and its chosen Fleets and roles.
   * @throws BadRequestException when it is incomplete or inconsistent.
   */
  private async check(
    manager: EntityManager,
    scope: GovernanceScope,
    dto: ScopeEventDefinitionDto,
  ): Promise<CheckedDefinition> {
    const community = (await manager.findOne(FleetCommunityEntity, {
      where: { id: scope.communityId },
      select: { id: true, preferredTimezone: true },
    })) as FleetCommunityEntity;
    const timezone = canonicaliseTimezone(
      dto.timezone ?? community.preferredTimezone,
    );

    if (timezone === null) {
      throw new BadRequestException('That timezone is not one we know.');
    }

    const rule = this.ruleOf(dto);
    const audience = await this.audienceOf(manager, scope, dto);

    return {
      fields: {
        title: dto.title,
        description: dto.description ?? '',
        externalUrl: dto.externalUrl ?? null,
        audience: dto.audience,
        timezone,
        startDate: dto.startDate,
        startTime: dto.startTime,
        durationMinutes: dto.durationMinutes,
        capacity: dto.capacity ?? null,
        ...rule,
      },
      ...audience,
    };
  }

  /**
   * Keeps the rule fields its kind uses, and checks it is complete.
   *
   * @param dto - The event as sent.
   * @returns The rule's fields.
   * @throws BadRequestException when a field it needs is missing, or it ends
   *   two ways or before it starts.
   */
  private ruleOf(
    dto: ScopeEventDefinitionDto,
  ): Pick<
    ScopeEventEntity,
    | 'recurrence'
    | 'interval'
    | 'weekdays'
    | 'monthDay'
    | 'monthWeek'
    | 'monthWeekday'
    | 'endsOn'
    | 'occurrenceLimit'
  > {
    const once = dto.recurrence === EventRecurrence.NONE;
    const endsOn = once ? null : (dto.endsOn ?? null);
    const occurrenceLimit = once ? null : (dto.occurrenceLimit ?? null);

    if (endsOn !== null && occurrenceLimit !== null) {
      throw new BadRequestException(
        'Choose a last day or a number of times, not both.',
      );
    }

    if (endsOn !== null && endsOn < dto.startDate) {
      throw new BadRequestException('It cannot end before it starts.');
    }

    const rule = {
      recurrence: dto.recurrence,
      interval: once ? 1 : (dto.interval ?? 1),
      weekdays: [] as number[],
      monthDay: null as number | null,
      monthWeek: null as number | null,
      monthWeekday: null as number | null,
      endsOn,
      occurrenceLimit,
    };

    switch (dto.recurrence) {
      case EventRecurrence.WEEKLY:
        rule.weekdays = [...new Set(dto.weekdays ?? [])].sort((a, b) => a - b);

        if (rule.weekdays.length === 0) {
          throw new BadRequestException('Choose the days of the week.');
        }
        break;
      case EventRecurrence.MONTHLY_DAY:
        rule.monthDay = dto.monthDay ?? null;

        if (rule.monthDay === null) {
          throw new BadRequestException('Choose the day of the month.');
        }
        break;
      case EventRecurrence.MONTHLY_WEEKDAY:
        rule.monthWeek = dto.monthWeek ?? null;
        rule.monthWeekday = dto.monthWeekday ?? null;

        if (rule.monthWeek === null || rule.monthWeekday === null) {
          throw new BadRequestException(
            'Choose which weekday of the month, and which one.',
          );
        }
        break;
      case EventRecurrence.NONE:
        break;
    }

    return rule;
  }

  /**
   * Checks the chosen Fleets and roles of a SELECTED audience.
   *
   * @param manager - The manager to read through.
   * @param scope - The scope.
   * @param dto - The event as sent.
   * @returns The chosen Fleets and roles; none for any other audience.
   * @throws BadRequestException when nobody is chosen, a Fleet is chosen for
   *   a Fleet's own event, or a chosen Fleet is not in the Community.
   */
  private async audienceOf(
    manager: EntityManager,
    scope: GovernanceScope,
    dto: ScopeEventDefinitionDto,
  ): Promise<Pick<CheckedDefinition, 'fleetIds' | 'roles'>> {
    if (dto.audience !== ScopeEventAudience.SELECTED) {
      return { fleetIds: [], roles: [] };
    }

    const fleetIds = [...new Set(dto.audienceFleetIds ?? [])];
    const roles = [...new Set(dto.audienceRoles ?? [])];

    if (fleetIds.length === 0 && roles.length === 0) {
      throw new BadRequestException('Choose the Fleets or roles it is for.');
    }

    if (fleetIds.length > 0 && scope.kind === FleetScopeKind.FLEET) {
      throw new BadRequestException(
        'A Fleet’s own event is for roles in it, not other Fleets.',
      );
    }

    const found = await manager.count(StoFleetEntity, {
      where: { id: In(fleetIds), communityId: scope.communityId },
    });

    if (found !== fleetIds.length) {
      throw new BadRequestException('Choose Fleets in this Community.');
    }

    return { fleetIds, roles };
  }

  /**
   * Stores an event's chosen Fleets and roles.
   *
   * @param manager - The transaction.
   * @param event - The event.
   * @param checked - The checked definition.
   */
  private async saveAudience(
    manager: EntityManager,
    event: ScopeEventEntity,
    checked: CheckedDefinition,
  ): Promise<void> {
    const members = [
      ...checked.fleetIds.map(fleetId => ({ fleetId, role: null })),
      ...checked.roles.map(role => ({ fleetId: null, role })),
    ];

    if (members.length > 0) {
      await manager.save(
        ScopeEventAudienceMemberEntity,
        members.map(member => ({
          ...member,
          eventId: event.id,
          communityId: event.communityId,
        })),
      );
    }
  }

  /**
   * Writes out the occurrences the rule names that are still to come and
   * not yet written.
   *
   * @param manager - The transaction.
   * @param event - The event.
   * @param now - The moment of the change.
   * @returns How many were written.
   */
  private async materialise(
    manager: EntityManager,
    event: ScopeEventEntity,
    now: Date,
  ): Promise<number> {
    const existing = await manager.find(ScopeEventOccurrenceEntity, {
      where: { eventId: event.id },
      select: { occurrenceKey: true },
    });
    const written = new Set(existing.map(row => row.occurrenceKey));
    const fresh = this.planAhead(event, now).filter(
      planned => !written.has(planned.key) && planned.startsAt > now,
    );

    if (fresh.length > 0) {
      await manager.save(
        ScopeEventOccurrenceEntity,
        fresh.map(planned => ({
          eventId: event.id,
          occurrenceKey: planned.key,
          localStart: planned.localStart,
          startsAt: planned.startsAt,
          endsAt: planned.endsAt,
          adjustment: planned.adjustment,
        })),
      );
    }

    return fresh.length;
  }

  /**
   * Brings what lies ahead into line with an edited rule.
   *
   * Occurrences that have started are left alone. One the rule still names
   * keeps its answers and moves if its time changed; one moved on its own
   * keeps its time; one no longer named is cancelled; one the rule names
   * again after being dropped by an earlier edit comes back.
   *
   * @param manager - The transaction.
   * @param event - The event, as edited.
   * @param now - The moment of the change.
   */
  private async rebuild(
    manager: EntityManager,
    event: ScopeEventEntity,
    now: Date,
  ): Promise<void> {
    const planned = new Map(
      this.planAhead(event, now).map(occurrence => [
        occurrence.key,
        occurrence,
      ]),
    );
    const existing = await manager.find(ScopeEventOccurrenceEntity, {
      where: { eventId: event.id },
      lock: { mode: 'pessimistic_write' },
    });

    for (const occurrence of existing) {
      if (occurrence.startsAt <= now) {
        continue;
      }

      const next = planned.get(occurrence.occurrenceKey);

      await this.bringInLine(manager, event, occurrence, next, now);
    }

    await this.materialise(manager, event, now);
  }

  /**
   * Brings one occurrence still to come into line with an edited rule.
   *
   * @param manager - The transaction.
   * @param event - The event, as edited.
   * @param occurrence - The occurrence.
   * @param next - What the rule now names for its day, if anything.
   * @param now - The moment of the change.
   */
  private async bringInLine(
    manager: EntityManager,
    event: ScopeEventEntity,
    occurrence: ScopeEventOccurrenceEntity,
    next: PlannedOccurrence | undefined,
    now: Date,
  ): Promise<void> {
    const named = next !== undefined && next.startsAt > now;
    const scheduled = occurrence.status === OccurrenceStatus.SCHEDULED;

    if (!named) {
      if (scheduled) {
        occurrence.status = OccurrenceStatus.CANCELLED;
        occurrence.cancelledAt = now;
        await manager.save(ScopeEventOccurrenceEntity, occurrence);
        await noticeSubscribers(
          manager,
          NotificationOutboxKind.EVENT_CANCELLED,
          event.id,
          occurrence,
        );
      }

      return;
    }

    if (occurrence.isException) {
      // Moved or cancelled on its own, which an edit to the series does not
      // undo. A moved one lasts as long as the event now does.
      occurrence.endsAt = new Date(
        occurrence.startsAt.getTime() + event.durationMinutes * 60_000,
      );
      await manager.save(ScopeEventOccurrenceEntity, occurrence);

      return;
    }

    const moved = occurrence.startsAt.getTime() !== next.startsAt.getTime();

    if (!scheduled) {
      occurrence.status = OccurrenceStatus.SCHEDULED;
      occurrence.cancelledAt = null;
    } else if (moved) {
      occurrence.movedFromStartsAt =
        occurrence.movedFromStartsAt ?? occurrence.startsAt;
    }

    this.applyPlacement(occurrence, next);
    await manager.save(ScopeEventOccurrenceEntity, occurrence);

    if (scheduled && moved) {
      await noticeSubscribers(
        manager,
        NotificationOutboxKind.EVENT_MOVED,
        event.id,
        occurrence,
      );
    }
  }

  /**
   * Gives newly free places ahead to those waiting, after a capacity rises.
   *
   * @param manager - The transaction.
   * @param event - The event.
   * @param now - The moment of the change.
   */
  private async promoteAhead(
    manager: EntityManager,
    event: ScopeEventEntity,
    now: Date,
  ): Promise<void> {
    const ahead = await manager.find(ScopeEventOccurrenceEntity, {
      where: { eventId: event.id, status: OccurrenceStatus.SCHEDULED },
      lock: { mode: 'pessimistic_write' },
    });

    for (const occurrence of ahead) {
      await this._rsvps.promote(manager, event, occurrence, now);
    }
  }

  /**
   * Plans the rule through the horizon.
   *
   * @param event - The event.
   * @param now - The moment of the change.
   * @returns The occurrences it names.
   */
  private planAhead(event: ScopeEventEntity, now: Date): PlannedOccurrence[] {
    return planOccurrences(event, this.horizonOf(event.timezone, now))
      .occurrences;
  }

  /**
   * The last day written out: twelve months on, on the event's clock.
   *
   * @param timezone - The event's timezone.
   * @param now - The moment.
   * @returns The day, as `YYYY-MM-DD`.
   */
  private horizonOf(timezone: string, now: Date): string {
    return addMonths(localDateOf(now, timezone), EVENT_HORIZON_MONTHS);
  }

  /**
   * Puts a placement's times on an occurrence.
   *
   * @param occurrence - The occurrence.
   * @param placed - Where it now falls.
   */
  private applyPlacement(
    occurrence: ScopeEventOccurrenceEntity,
    placed: PlannedOccurrence,
  ): void {
    occurrence.localStart = placed.localStart;
    occurrence.startsAt = placed.startsAt;
    occurrence.endsAt = placed.endsAt;
    occurrence.adjustment = placed.adjustment;
  }

  /**
   * Adds a line to an event's change log.
   *
   * @param manager - The transaction.
   * @param eventId - The event.
   * @param action - What was done.
   * @param actorUserId - Who did it.
   * @param extra - The occurrence it was to, and anything worth keeping.
   */
  private async log(
    manager: EntityManager,
    eventId: string,
    action: ScopeEventActionKind,
    actorUserId: string,
    extra: {
      occurrenceId?: string;
      detail?: Record<string, unknown>;
    } = {},
  ): Promise<void> {
    await manager.save(ScopeEventActionEntity, {
      eventId,
      action,
      actorUserId,
      occurrenceId: extra.occurrenceId ?? null,
      detail: extra.detail ?? null,
    });
  }

  /**
   * Puts what was done on the scope's activity feed (FC-029), where
   * whoever may see the event now sees it.
   *
   * @param manager - The transaction.
   * @param event - The event.
   * @param type - What was done.
   * @param actorUserId - Who did it.
   * @param item - What makes it recorded once, when, and its references.
   */
  private async feed(
    manager: EntityManager,
    event: ScopeEventEntity,
    type: ActivityType,
    actorUserId: string,
    item: {
      key: string;
      occurredAt: Date;
      detail?: Record<string, unknown>;
    },
  ): Promise<void> {
    await recordActivity(manager, [
      {
        communityId: event.communityId,
        fleetId: event.fleetId,
        armadaId: event.armadaId,
        type,
        actorUserId,
        sourceId: event.id,
        detail: item.detail ?? null,
        idempotencyKey: `${type}:${item.key}`,
        occurredAt: item.occurredAt,
      },
    ]);
  }
}

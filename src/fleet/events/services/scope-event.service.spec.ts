import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { NotificationOutboxKind } from 'src/notification/outbox/notification-outbox-kind.enum';
import { NotificationOutboxEntity } from 'src/notification/outbox/notification-outbox.entity';

import {
  COMMUNITY,
  COMMUNITY_ID,
  eventsWorld,
  EventsWorld,
  FLEET,
  FLEET_ID,
  MANAGER_ID,
  MEMBER_ID,
  OTHER_FLEET_ID,
  seedEvent,
} from '../../../../test/scope-events-world';
import { ActivityEventEntity } from '../../activity/entities/activity-event.entity';
import { ActivityType } from '../../activity/enums/activity.enums';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import { FleetScopeStatus } from '../../enums/fleet-scope-status.enum';
import { ScopeEventDefinitionDto } from '../dto/scope-event.dto';
import { ScopeEventActionEntity } from '../entities/scope-event-action.entity';
import { ScopeEventAudienceMemberEntity } from '../entities/scope-event-audience-member.entity';
import { ScopeEventOccurrenceEntity } from '../entities/scope-event-occurrence.entity';
import { ScopeEventReminderEntity } from '../entities/scope-event-reminder.entity';
import { ScopeEventRsvpEntity } from '../entities/scope-event-rsvp.entity';
import {
  EventRecurrence,
  OccurrenceAdjustment,
} from '../enums/event-recurrence.enum';
import {
  OccurrenceStatus,
  RsvpResponse,
  ScopeEventActionKind,
  ScopeEventAudience,
  ScopeEventStatus,
} from '../enums/scope-event.enums';

const NOW = new Date('2029-12-01T12:00:00Z');

/**
 * A weekly Friday event, from 4 January 2030, at eight in London.
 *
 * @param overrides - What differs.
 * @returns The definition.
 */
function weekly(
  overrides: Partial<ScopeEventDefinitionDto> = {},
): ScopeEventDefinitionDto {
  return {
    title: 'Refit night',
    audience: ScopeEventAudience.PUBLIC,
    recurrence: EventRecurrence.WEEKLY,
    startDate: '2030-01-04',
    startTime: '20:00',
    weekdays: [5],
    durationMinutes: 120,
    ...overrides,
  };
}

describe('ScopeEventService', () => {
  let world: EventsWorld;

  const occurrences = () =>
    world.db.rows<ScopeEventOccurrenceEntity & Record<string, unknown>>(
      ScopeEventOccurrenceEntity,
    );
  const notices = () =>
    world.db.rows<NotificationOutboxEntity & Record<string, unknown>>(
      NotificationOutboxEntity,
    );
  const log = () =>
    world.db.rows<ScopeEventActionEntity & Record<string, unknown>>(
      ScopeEventActionEntity,
    );
  const activity = () =>
    world.db.rows<ActivityEventEntity & Record<string, unknown>>(
      ActivityEventEntity,
    );

  /**
   * Seeds one occurrence.
   *
   * @param overrides - What differs from the one on 4 January 2030.
   * @returns The row.
   */
  function seedOccurrence(
    overrides: Partial<ScopeEventOccurrenceEntity> = {},
  ): ScopeEventOccurrenceEntity {
    const row = {
      id: `occurrence-${occurrences().length + 1}`,
      eventId: '28000000-0000-4000-8000-0000000000e1',
      occurrenceKey: '2030-01-04',
      localStart: '2030-01-04T20:00',
      startsAt: new Date('2030-01-04T20:00:00Z'),
      endsAt: new Date('2030-01-04T22:00:00Z'),
      adjustment: OccurrenceAdjustment.NONE,
      status: OccurrenceStatus.SCHEDULED,
      cancelledAt: null,
      isException: false,
      movedFromStartsAt: null,
      ...overrides,
    } as ScopeEventOccurrenceEntity;

    world.db.seed(ScopeEventOccurrenceEntity, [
      row as unknown as Record<string, unknown>,
    ]);

    return row;
  }

  /**
   * Has somebody asked to be reminded of the seeded event.
   *
   * @param userId - Who.
   */
  function subscribe(userId: string): void {
    world.db.seed(ScopeEventReminderEntity, [
      {
        eventId: '28000000-0000-4000-8000-0000000000e1',
        userId,
        leadMinutes: [60],
      },
    ]);
  }

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    world = eventsWorld();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('preview', () => {
    it('shows what lies ahead, on the Community’s clock by default', async () => {
      const preview = await world.events.preview(
        FLEET,
        weekly({ occurrenceLimit: 3 }),
        MANAGER_ID,
      );

      expect(preview).toEqual({
        timezone: 'Europe/London',
        occurrences: [
          expect.objectContaining({
            key: '2030-01-04',
            localStart: '2030-01-04T20:00',
            startsAt: new Date('2030-01-04T20:00:00Z'),
          }),
          expect.objectContaining({ key: '2030-01-11' }),
          expect.objectContaining({ key: '2030-01-18' }),
        ],
        skippedMonths: [],
      });
      expect(occurrences()).toHaveLength(0);
    });

    it('flags a time the clock jumps over, and skips a short month', async () => {
      const preview = await world.events.preview(
        FLEET,
        weekly({
          recurrence: EventRecurrence.MONTHLY_DAY,
          startDate: '2030-01-31',
          startTime: '01:30',
          monthDay: 31,
          timezone: 'Europe/London',
        }),
        MANAGER_ID,
      );

      expect(preview.skippedMonths).toContain('2030-02');
      expect(
        preview.occurrences.find(({ key }) => key === '2030-03-31'),
      ).toEqual(
        expect.objectContaining({
          localStart: '2030-03-31T02:30',
          adjustment: OccurrenceAdjustment.MISSING_TIME,
        }),
      );
    });

    it('leaves out what has already passed', async () => {
      const preview = await world.events.preview(
        FLEET,
        weekly({ startDate: '2029-11-02' }),
        MANAGER_ID,
      );

      expect(preview.occurrences[0].key).toBe('2029-12-07');
    });

    it('is for event managers only', async () => {
      await expect(
        world.events.preview(FLEET, weekly(), MEMBER_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses a timezone nobody knows', async () => {
      await expect(
        world.events.preview(
          FLEET,
          weekly({ timezone: 'Mars/Olympus' }),
          MANAGER_ID,
        ),
      ).rejects.toThrow('That timezone is not one we know.');
    });
  });

  describe('create', () => {
    it('writes out a year of occurrences and logs it', async () => {
      const event = await world.events.create(FLEET, weekly(), MANAGER_ID);

      expect(event).toEqual(
        expect.objectContaining({
          communityId: COMMUNITY_ID,
          fleetId: FLEET_ID,
          armadaId: null,
          timezone: 'Europe/London',
          weekdays: [5],
          monthDay: null,
          status: ScopeEventStatus.ACTIVE,
          materialisedThrough: '2030-12-01',
          createdByUserId: MANAGER_ID,
          description: '',
          externalUrl: null,
          capacity: null,
        }),
      );
      expect(occurrences()).toHaveLength(48);
      expect(occurrences()[47].occurrenceKey).toBe('2030-11-29');
      expect(log()).toEqual([
        expect.objectContaining({
          eventId: event.id,
          action: ScopeEventActionKind.CREATED,
          actorUserId: MANAGER_ID,
        }),
      ]);
      expect(activity()).toEqual([
        expect.objectContaining({
          communityId: COMMUNITY_ID,
          fleetId: FLEET_ID,
          armadaId: null,
          type: ActivityType.EVENT_CREATED,
          actorUserId: MANAGER_ID,
          sourceId: event.id,
          detail: null,
          idempotencyKey: `EVENT_CREATED:${event.id}`,
          occurredAt: NOW,
        }),
      ]);
    });

    it('keeps only the fields its kind of rule uses', async () => {
      const event = await world.events.create(
        FLEET,
        weekly({
          recurrence: EventRecurrence.NONE,
          weekdays: [1, 2],
          monthDay: 3,
          interval: 4,
          occurrenceLimit: 9,
          capacity: 20,
          externalUrl: 'https://discord.test/e',
          description: 'Bring ships.',
        }),
        MANAGER_ID,
      );

      expect(event).toEqual(
        expect.objectContaining({
          weekdays: [],
          monthDay: null,
          interval: 1,
          occurrenceLimit: null,
          capacity: 20,
          externalUrl: 'https://discord.test/e',
          description: 'Bring ships.',
        }),
      );
      expect(occurrences()).toHaveLength(1);
    });

    it('keeps the day and week of a monthly rule', async () => {
      const event = await world.events.create(
        FLEET,
        weekly({
          recurrence: EventRecurrence.MONTHLY_WEEKDAY,
          monthWeek: -1,
          monthWeekday: 5,
          interval: 2,
        }),
        MANAGER_ID,
      );

      expect(event).toEqual(
        expect.objectContaining({
          weekdays: [],
          monthWeek: -1,
          monthWeekday: 5,
          interval: 2,
        }),
      );
    });

    it('refuses an event with nothing ahead', async () => {
      await expect(
        world.events.create(
          FLEET,
          weekly({
            recurrence: EventRecurrence.NONE,
            startDate: '2029-11-30',
          }),
          MANAGER_ID,
        ),
      ).rejects.toThrow('Nothing of this event lies ahead.');
    });

    it('refuses a closed scope', async () => {
      world.status = FleetScopeStatus.CLOSED;

      await expect(
        world.events.create(FLEET, weekly(), MANAGER_ID),
      ).rejects.toThrow(ConflictException);
    });

    it.each([
      [
        'ending two ways',
        { endsOn: '2030-06-01', occurrenceLimit: 3 },
        'Choose a last day or a number of times, not both.',
      ],
      [
        'ending before it starts',
        { endsOn: '2029-12-31' },
        'It cannot end before it starts.',
      ],
      ['a week with no days', { weekdays: [] }, 'Choose the days of the week.'],
      [
        'a week with its days left out',
        { weekdays: undefined },
        'Choose the days of the week.',
      ],
      [
        'a monthly weekday with no weekday',
        { recurrence: EventRecurrence.MONTHLY_WEEKDAY, monthWeek: 2 },
        'Choose which weekday of the month, and which one.',
      ],
      [
        'a monthly day with no day',
        { recurrence: EventRecurrence.MONTHLY_DAY },
        'Choose the day of the month.',
      ],
      [
        'a monthly weekday with no week',
        { recurrence: EventRecurrence.MONTHLY_WEEKDAY, monthWeekday: 5 },
        'Choose which weekday of the month, and which one.',
      ],
    ])('refuses %s', async (_case, overrides, message) => {
      await expect(
        world.events.create(FLEET, weekly(overrides), MANAGER_ID),
      ).rejects.toThrow(new BadRequestException(message));
    });

    describe('for chosen Fleets and roles', () => {
      beforeEach(() => {
        world.db.seed(StoFleetEntity, [
          { id: FLEET_ID, communityId: COMMUNITY_ID },
          { id: OTHER_FLEET_ID, communityId: 'another-community' },
        ]);
      });

      it('keeps whom a Community event is for', async () => {
        const event = await world.events.create(
          COMMUNITY,
          weekly({
            audience: ScopeEventAudience.SELECTED,
            audienceFleetIds: [FLEET_ID, FLEET_ID],
            audienceRoles: [FleetScopeRole.OFFICER],
          }),
          MANAGER_ID,
        );

        expect(world.db.rows(ScopeEventAudienceMemberEntity)).toEqual([
          expect.objectContaining({
            eventId: event.id,
            communityId: COMMUNITY_ID,
            fleetId: FLEET_ID,
            role: null,
          }),
          expect.objectContaining({
            fleetId: null,
            role: FleetScopeRole.OFFICER,
          }),
        ]);
      });

      it('refuses nobody chosen', async () => {
        await expect(
          world.events.create(
            COMMUNITY,
            weekly({ audience: ScopeEventAudience.SELECTED }),
            MANAGER_ID,
          ),
        ).rejects.toThrow('Choose the Fleets or roles it is for.');
      });

      it('refuses other Fleets for a Fleet’s own event', async () => {
        await expect(
          world.events.create(
            FLEET,
            weekly({
              audience: ScopeEventAudience.SELECTED,
              audienceFleetIds: [FLEET_ID],
            }),
            MANAGER_ID,
          ),
        ).rejects.toThrow('A Fleet’s own event is for roles in it');
      });

      it('refuses a Fleet of another Community', async () => {
        await expect(
          world.events.create(
            COMMUNITY,
            weekly({
              audience: ScopeEventAudience.SELECTED,
              audienceFleetIds: [OTHER_FLEET_ID],
            }),
            MANAGER_ID,
          ),
        ).rejects.toThrow('Choose Fleets in this Community.');
      });

      it('keeps only roles for a Fleet’s own event', async () => {
        await world.events.create(
          FLEET,
          weekly({
            audience: ScopeEventAudience.SELECTED,
            audienceRoles: [FleetScopeRole.ADMIN],
          }),
          MANAGER_ID,
        );

        expect(world.db.rows(ScopeEventAudienceMemberEntity)).toEqual([
          expect.objectContaining({ role: FleetScopeRole.ADMIN }),
        ]);
      });
    });
  });

  describe('update', () => {
    it('changes what lies ahead only, and tells subscribers', async () => {
      const event = seedEvent(world.db, {
        recurrence: EventRecurrence.WEEKLY,
        weekdays: [5],
        startDate: '2029-11-02',
        capacity: 1,
      });
      const past = seedOccurrence({
        occurrenceKey: '2029-11-30',
        startsAt: new Date('2029-11-30T20:00:00Z'),
        endsAt: new Date('2029-11-30T22:00:00Z'),
      });
      // Fortnightly from 2 November names 30 November, 14 and 28 December,
      // then 11 and 25 January.
      const dropped = seedOccurrence({
        occurrenceKey: '2029-12-07',
        startsAt: new Date('2029-12-07T20:00:00Z'),
      });
      const kept = seedOccurrence({
        occurrenceKey: '2029-12-14',
        startsAt: new Date('2029-12-14T20:00:00Z'),
      });
      const movedAlone = seedOccurrence({
        occurrenceKey: '2029-12-28',
        startsAt: new Date('2029-12-27T18:00:00Z'),
        isException: true,
      });
      const cancelledAlone = seedOccurrence({
        occurrenceKey: '2030-01-11',
        startsAt: new Date('2030-01-11T20:00:00Z'),
        status: OccurrenceStatus.CANCELLED,
        cancelledAt: NOW,
        isException: true,
      });
      const droppedEarlier = seedOccurrence({
        occurrenceKey: '2030-01-25',
        startsAt: new Date('2030-01-25T20:00:00Z'),
        status: OccurrenceStatus.CANCELLED,
        cancelledAt: NOW,
      });

      subscribe(MEMBER_ID);
      world.db.seed(ScopeEventRsvpEntity, [
        {
          occurrenceId: kept.id,
          userId: MEMBER_ID,
          response: RsvpResponse.GOING,
          waitlistedAt: new Date('2029-11-20T00:00:00Z'),
        },
      ]);

      // Fortnightly now, at nine, with no limit.
      await world.events.update(
        FLEET,
        event.id,
        weekly({
          startDate: '2029-11-02',
          startTime: '21:00',
          interval: 2,
          weekdays: [5],
        }),
        MANAGER_ID,
      );

      expect(past.startsAt).toEqual(new Date('2029-11-30T20:00:00Z'));
      expect(kept).toEqual(
        expect.objectContaining({
          startsAt: new Date('2029-12-14T21:00:00Z'),
          localStart: '2029-12-14T21:00',
          movedFromStartsAt: new Date('2029-12-14T20:00:00Z'),
          status: OccurrenceStatus.SCHEDULED,
        }),
      );
      expect(dropped.status).toBe(OccurrenceStatus.CANCELLED);
      expect(movedAlone.startsAt).toEqual(new Date('2029-12-27T18:00:00Z'));
      expect(movedAlone.endsAt).toEqual(new Date('2029-12-27T20:00:00Z'));
      expect(cancelledAlone.status).toBe(OccurrenceStatus.CANCELLED);
      expect(droppedEarlier).toEqual(
        expect.objectContaining({
          status: OccurrenceStatus.SCHEDULED,
          cancelledAt: null,
          startsAt: new Date('2030-01-25T21:00:00Z'),
        }),
      );
      expect(notices().map(({ kind, subjectId }) => [kind, subjectId])).toEqual(
        expect.arrayContaining([
          [NotificationOutboxKind.EVENT_MOVED, kept.id],
          [NotificationOutboxKind.EVENT_CANCELLED, dropped.id],
          [NotificationOutboxKind.EVENT_PROMOTED, kept.id],
        ]),
      );
      expect(
        world.db
          .rows<ScopeEventRsvpEntity & Record<string, unknown>>(
            ScopeEventRsvpEntity,
          )
          .map(rsvp => rsvp.waitlistedAt),
      ).toEqual([null]);
      expect(log()[log().length - 1]).toEqual(
        expect.objectContaining({
          action: ScopeEventActionKind.EDITED,
          detail: {
            changed: expect.arrayContaining([
              'startTime',
              'interval',
              'capacity',
            ]),
          },
        }),
      );
    });

    it('sorts the weekdays, and gives no places when capacity falls', async () => {
      const event = seedEvent(world.db, {
        recurrence: EventRecurrence.WEEKLY,
        weekdays: [5],
        capacity: 5,
      });
      const occurrence = seedOccurrence();

      world.db.seed(ScopeEventRsvpEntity, [
        {
          occurrenceId: occurrence.id,
          userId: MEMBER_ID,
          response: RsvpResponse.GOING,
          waitlistedAt: new Date('2029-11-20T00:00:00Z'),
        },
      ]);

      const saved = await world.events.update(
        FLEET,
        event.id,
        weekly({ weekdays: [5, 2, 5], capacity: 3 }),
        MANAGER_ID,
      );

      expect(saved.weekdays).toEqual([2, 5]);
      expect(notices()).toEqual([]);
    });

    it('keeps a time unchanged, quietly', async () => {
      const event = seedEvent(world.db, {
        recurrence: EventRecurrence.WEEKLY,
        weekdays: [5],
      });
      const occurrence = seedOccurrence();

      subscribe(MEMBER_ID);

      await world.events.update(
        FLEET,
        event.id,
        weekly({ title: 'Refit night, renamed', capacity: 5 }),
        MANAGER_ID,
      );

      expect(occurrence.movedFromStartsAt).toBeNull();
      expect(notices()).toEqual([]);
    });

    it('keeps an occurrence the rule no longer names cancelled, quietly', async () => {
      const event = seedEvent(world.db, {
        recurrence: EventRecurrence.WEEKLY,
        weekdays: [5],
      });
      const gone = seedOccurrence({
        occurrenceKey: '2030-01-05',
        startsAt: new Date('2030-01-05T20:00:00Z'),
        status: OccurrenceStatus.CANCELLED,
        cancelledAt: NOW,
      });

      await world.events.update(FLEET, event.id, weekly(), MANAGER_ID);

      expect(gone.status).toBe(OccurrenceStatus.CANCELLED);
      expect(notices()).toEqual([]);
    });

    it('refuses a cancelled event', async () => {
      const event = seedEvent(world.db, {
        status: ScopeEventStatus.CANCELLED,
        cancelledAt: NOW,
      });

      await expect(
        world.events.update(FLEET, event.id, weekly(), MANAGER_ID),
      ).rejects.toThrow('This event was cancelled.');
    });

    it('refuses an event of another scope', async () => {
      const event = seedEvent(world.db);

      await expect(
        world.events.update(COMMUNITY, event.id, weekly(), MANAGER_ID),
      ).rejects.toThrow('Not found');
    });
  });

  describe('cancel', () => {
    it('cancels what lies ahead, and says so', async () => {
      const event = seedEvent(world.db);
      const ahead = seedOccurrence();

      subscribe(MEMBER_ID);

      await world.events.cancel(FLEET, event.id, MANAGER_ID);

      expect(event.status).toBe(ScopeEventStatus.CANCELLED);
      expect(event.cancelledAt).toEqual(NOW);
      expect(ahead.status).toBe(OccurrenceStatus.CANCELLED);
      expect(notices()).toEqual([
        expect.objectContaining({
          kind: NotificationOutboxKind.EVENT_CANCELLED,
          userId: MEMBER_ID,
        }),
      ]);
      expect(log()).toEqual([
        expect.objectContaining({
          action: ScopeEventActionKind.CANCELLED,
          detail: { occurrencesCancelled: 1 },
        }),
      ]);
      expect(activity()).toEqual([
        expect.objectContaining({
          type: ActivityType.EVENT_CANCELLED,
          sourceId: event.id,
          idempotencyKey: `EVENT_CANCELLED:${event.id}`,
        }),
      ]);
    });

    it('refuses one already cancelled', async () => {
      const event = seedEvent(world.db, {
        status: ScopeEventStatus.CANCELLED,
        cancelledAt: NOW,
      });

      await expect(
        world.events.cancel(FLEET, event.id, MANAGER_ID),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('one occurrence', () => {
    it('is cancelled on its own, and says so', async () => {
      const event = seedEvent(world.db);
      const occurrence = seedOccurrence();

      subscribe(MEMBER_ID);

      await world.events.cancelOccurrence(
        FLEET,
        event.id,
        occurrence.id,
        MANAGER_ID,
      );

      expect(occurrence).toEqual(
        expect.objectContaining({
          status: OccurrenceStatus.CANCELLED,
          isException: true,
        }),
      );
      expect(notices()).toHaveLength(1);
      expect(log()).toEqual([
        expect.objectContaining({
          action: ScopeEventActionKind.OCCURRENCE_CANCELLED,
          occurrenceId: occurrence.id,
        }),
      ]);
      expect(activity()).toEqual([
        expect.objectContaining({
          type: ActivityType.OCCURRENCE_CANCELLED,
          sourceId: event.id,
          detail: { startsAt: '2030-01-04T20:00:00.000Z' },
          idempotencyKey: `OCCURRENCE_CANCELLED:${occurrence.id}`,
        }),
      ]);
    });

    it('is moved on its own, keeping where it was first due', async () => {
      const event = seedEvent(world.db);
      const occurrence = seedOccurrence({
        movedFromStartsAt: new Date('2030-01-03T20:00:00Z'),
      });

      subscribe(MEMBER_ID);

      await world.events.moveOccurrence(
        FLEET,
        event.id,
        occurrence.id,
        { date: '2030-01-05', time: '19:30' },
        MANAGER_ID,
      );

      expect(occurrence).toEqual(
        expect.objectContaining({
          occurrenceKey: '2030-01-04',
          startsAt: new Date('2030-01-05T19:30:00Z'),
          endsAt: new Date('2030-01-05T21:30:00Z'),
          movedFromStartsAt: new Date('2030-01-03T20:00:00Z'),
          isException: true,
        }),
      );
      expect(notices()).toEqual([
        expect.objectContaining({ kind: NotificationOutboxKind.EVENT_MOVED }),
      ]);
      expect(log()[0].detail).toEqual({
        from: '2030-01-04T20:00:00.000Z',
        to: '2030-01-05T19:30:00.000Z',
      });
      expect(activity()).toEqual([
        expect.objectContaining({
          type: ActivityType.OCCURRENCE_MOVED,
          sourceId: event.id,
          detail: {
            from: '2030-01-04T20:00:00.000Z',
            to: '2030-01-05T19:30:00.000Z',
          },
          idempotencyKey: `OCCURRENCE_MOVED:${occurrence.id}:2030-01-04T20:00:00.000Z:2030-01-05T19:30:00.000Z`,
        }),
      ]);
    });

    it('remembers where it was first due on its first move', async () => {
      const event = seedEvent(world.db);
      const occurrence = seedOccurrence();

      await world.events.moveOccurrence(
        FLEET,
        event.id,
        occurrence.id,
        { date: '2030-01-05', time: '19:30' },
        MANAGER_ID,
      );

      expect(occurrence.movedFromStartsAt).toEqual(
        new Date('2030-01-04T20:00:00Z'),
      );
    });

    it('is not moved into the past', async () => {
      const event = seedEvent(world.db);
      const occurrence = seedOccurrence();

      await expect(
        world.events.moveOccurrence(
          FLEET,
          event.id,
          occurrence.id,
          { date: '2029-11-01', time: '19:30' },
          MANAGER_ID,
        ),
      ).rejects.toThrow('Move it to a time still to come.');
    });

    it('is not changed once started', async () => {
      const event = seedEvent(world.db);
      const occurrence = seedOccurrence({
        startsAt: new Date('2029-12-01T11:00:00Z'),
      });

      await expect(
        world.events.cancelOccurrence(
          FLEET,
          event.id,
          occurrence.id,
          MANAGER_ID,
        ),
      ).rejects.toThrow('This occurrence has started, so it cannot change.');
    });

    it('is not changed on a closed scope', async () => {
      world.status = FleetScopeStatus.CLOSED;

      await expect(
        world.events.moveOccurrence(
          FLEET,
          'event',
          'occurrence',
          { date: '2030-01-05', time: '19:30' },
          MANAGER_ID,
        ),
      ).rejects.toThrow(ConflictException);
      await expect(
        world.events.cancelOccurrence(FLEET, 'event', 'occurrence', MANAGER_ID),
      ).rejects.toThrow(ConflictException);
      await expect(
        world.events.cancel(FLEET, 'event', MANAGER_ID),
      ).rejects.toThrow(ConflictException);
      await expect(
        world.events.update(FLEET, 'event', weekly(), MANAGER_ID),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('extendHorizons', () => {
    it('keeps a running event written out a year ahead', async () => {
      const event = seedEvent(world.db, {
        recurrence: EventRecurrence.WEEKLY,
        weekdays: [5],
        startDate: '2030-01-04',
        materialisedThrough: '2030-01-10',
      });

      seedOccurrence();
      seedEvent(world.db, {
        id: 'cancelled-event',
        status: ScopeEventStatus.CANCELLED,
        cancelledAt: NOW,
        materialisedThrough: '2030-01-10',
      });

      await expect(world.events.extendHorizons()).resolves.toBe(47);
      expect(event.materialisedThrough).toBe('2030-12-01');
      expect(
        occurrences().filter(({ eventId }) => eventId === event.id),
      ).toHaveLength(48);
    });
  });
});

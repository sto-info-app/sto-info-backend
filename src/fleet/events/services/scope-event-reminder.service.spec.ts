import { ConflictException, NotFoundException } from '@nestjs/common';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { NotificationSeverity } from 'src/notification/enums/notification-severity.enum';
import { NotificationOutboxKind } from 'src/notification/outbox/notification-outbox-kind.enum';
import { NotificationOutboxEntity } from 'src/notification/outbox/notification-outbox.entity';

import {
  ARMADA_ID,
  eventsWorld,
  EventsWorld,
  FLEET,
  MEMBER_ID,
  seedEvent,
  STRANGER_ID,
} from '../../../../test/scope-events-world';
import { StoArmadaEntity } from '../../entities/sto-armada.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { ScopeEventOccurrenceEntity } from '../entities/scope-event-occurrence.entity';
import { ScopeEventReminderEntity } from '../entities/scope-event-reminder.entity';
import { ScopeEventRsvpEntity } from '../entities/scope-event-rsvp.entity';
import { ScopeEventEntity } from '../entities/scope-event.entity';
import {
  OccurrenceStatus,
  RsvpResponse,
  ScopeEventAudience,
  ScopeEventStatus,
} from '../enums/scope-event.enums';

const NOW = new Date('2029-12-01T12:00:00Z');
const SITE = 'https://stoinfo.test';

describe('ScopeEventReminderService', () => {
  let world: EventsWorld;
  let event: ScopeEventEntity;
  let occurrence: Record<string, unknown>;
  const originalSite = process.env.APP_FRONTEND_URL;

  /**
   * Builds a notice about the occurrence.
   *
   * @param kind - What it tells.
   * @param overrides - What else differs.
   * @returns The notice.
   */
  const notice = (
    kind: NotificationOutboxKind,
    overrides: Partial<NotificationOutboxEntity> = {},
  ): NotificationOutboxEntity =>
    ({
      id: 'notice-1',
      userId: MEMBER_ID,
      kind,
      subjectId: 'next',
      detail:
        kind === NotificationOutboxKind.EVENT_REMINDER
          ? { leadMinutes: 60 }
          : null,
      ...overrides,
    }) as NotificationOutboxEntity;

  const compose = (sent: NotificationOutboxEntity) =>
    world.reminders.compose(sent, world.db.asManager(), NOW);

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    process.env.APP_FRONTEND_URL = SITE;
    world = eventsWorld();
    event = seedEvent(world.db);
    occurrence = {
      id: 'next',
      eventId: event.id,
      startsAt: new Date('2029-12-07T20:00:00Z'),
      status: OccurrenceStatus.SCHEDULED,
    };
    world.db
      .seed(ScopeEventOccurrenceEntity, [occurrence])
      .seed(StoFleetEntity, [
        {
          id: event.fleetId,
          exactGameName: 'Fixture Public Fleet',
          slug: 'fixture-public-fleet',
          platform: { name: 'Windows' },
        },
      ])
      .seed(ScopeEventReminderEntity, [
        { eventId: event.id, userId: MEMBER_ID, leadMinutes: [60] },
      ]);
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env.APP_FRONTEND_URL = originalSite;
  });

  it('writes the outbox’s event notices', () => {
    world.reminders.onModuleInit();

    expect(world.registry.require(NotificationOutboxKind.EVENT_MOVED)).toBe(
      world.reminders,
    );
    expect(world.reminders.kinds).toEqual([
      NotificationOutboxKind.EVENT_REMINDER,
      NotificationOutboxKind.EVENT_CANCELLED,
      NotificationOutboxKind.EVENT_MOVED,
      NotificationOutboxKind.EVENT_PROMOTED,
    ]);
  });

  describe('subscribing', () => {
    it('keeps each lead once, in order', async () => {
      await expect(
        world.reminders.subscribe(FLEET, event.id, STRANGER_ID, {
          leadMinutes: [1440, 15, 15],
        }),
      ).resolves.toEqual([15, 1440]);
      await world.reminders.subscribe(FLEET, event.id, MEMBER_ID, {
        leadMinutes: [15],
      });

      expect(
        world.db
          .rows<Record<string, unknown>>(ScopeEventReminderEntity)
          .map(row => [row.userId, row.leadMinutes]),
      ).toEqual([
        [MEMBER_ID, [15]],
        [STRANGER_ID, [15, 1440]],
      ]);
    });

    it('refuses an event the reader may not see, or one cancelled', async () => {
      event.audience = ScopeEventAudience.MEMBERS;
      await expect(
        world.reminders.subscribe(FLEET, event.id, STRANGER_ID, {
          leadMinutes: [15],
        }),
      ).rejects.toThrow(NotFoundException);

      event.status = ScopeEventStatus.CANCELLED;
      await expect(
        world.reminders.subscribe(FLEET, event.id, MEMBER_ID, {
          leadMinutes: [15],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('stops, and says when there was nothing to stop', async () => {
      await world.reminders.unsubscribe(FLEET, event.id, MEMBER_ID);

      expect(world.db.rows(ScopeEventReminderEntity)).toEqual([]);
      await expect(
        world.reminders.unsubscribe(FLEET, event.id, MEMBER_ID),
      ).rejects.toThrow('You are not being reminded of it.');
    });
  });

  it('queues what has come due in one statement, keyed as notices are', async () => {
    await world.reminders.queueDue(NOW);

    const [sql, parameters] = world.query.mock.calls[0] as [string, Date[]];

    expect(parameters).toEqual([NOW]);
    expect(sql).toContain('INSERT INTO "sto_info_app"."notification_outbox"');
    expect(sql).toContain('ON CONFLICT ("dedupeKey") DO NOTHING');
    expect(sql).toContain(
      `'EVENT_REMINDER:' || o."id" || ':' || r."userId" || ':' || lead || ':' || floor(extract(epoch FROM o."startsAt"))::bigint`,
    );
  });

  describe('compose', () => {
    it('writes a reminder on the event’s own clock, linking its page', async () => {
      await expect(
        compose(notice(NotificationOutboxKind.EVENT_REMINDER)),
      ).resolves.toEqual({
        title: 'Refit night starts in an hour',
        body: 'Refit night (Fixture Public Fleet) starts at 20:00 on Fri 7 Dec 2029 (Europe/London).',
        severity: NotificationSeverity.INFO,
        linkUrl: `${SITE}/fleets/communities/fixture-community/fleets/windows/fixture-public-fleet/events/${event.id}`,
      });
    });

    it.each([
      [
        NotificationOutboxKind.EVENT_CANCELLED,
        'Refit night is cancelled',
        'Refit night (Fixture Public Fleet), due at 20:00 on Fri 7 Dec 2029 (Europe/London), has been cancelled.',
        NotificationSeverity.WARNING,
      ],
      [
        NotificationOutboxKind.EVENT_MOVED,
        'Refit night has moved',
        'Refit night (Fixture Public Fleet) now starts at 20:00 on Fri 7 Dec 2029 (Europe/London).',
        NotificationSeverity.INFO,
      ],
    ])('writes %s', async (kind, title, body, severity) => {
      await expect(compose(notice(kind))).resolves.toEqual(
        expect.objectContaining({ title, body, severity }),
      );
    });

    it('tells somebody given a place that it is theirs, while it is', async () => {
      const promoted = notice(NotificationOutboxKind.EVENT_PROMOTED);

      await expect(compose(promoted)).resolves.toBeNull();

      world.db.seed(ScopeEventRsvpEntity, [
        {
          occurrenceId: 'next',
          userId: MEMBER_ID,
          response: RsvpResponse.GOING,
          waitlistedAt: null,
        },
      ]);

      await expect(compose(promoted)).resolves.toEqual(
        expect.objectContaining({
          title: 'You have a place at Refit night',
          body: 'A place came free at Refit night (Fixture Public Fleet), at 20:00 on Fri 7 Dec 2029 (Europe/London), and it is yours.',
          severity: NotificationSeverity.SUCCESS,
        }),
      );
    });

    it('sets aside a notice about nothing, or for somebody who may not see it', async () => {
      await expect(
        compose(
          notice(NotificationOutboxKind.EVENT_MOVED, { subjectId: 'gone' }),
        ),
      ).resolves.toBeNull();

      occurrence.eventId = 'gone-event';
      await expect(
        compose(notice(NotificationOutboxKind.EVENT_MOVED)),
      ).resolves.toBeNull();

      occurrence.eventId = event.id;
      world.standings.set(STRANGER_ID, { seesScope: false });
      await expect(
        compose(
          notice(NotificationOutboxKind.EVENT_CANCELLED, {
            userId: STRANGER_ID,
          }),
        ),
      ).resolves.toBeNull();

      event.audience = ScopeEventAudience.MEMBERS;
      await expect(
        compose(
          notice(NotificationOutboxKind.EVENT_CANCELLED, {
            userId: 'someone-else',
          }),
        ),
      ).resolves.toBeNull();
    });

    it('sets aside a reminder for what has started, or a lead no longer asked for', async () => {
      occurrence.startsAt = new Date('2029-12-01T11:00:00Z');
      await expect(
        compose(notice(NotificationOutboxKind.EVENT_REMINDER)),
      ).resolves.toBeNull();
      await expect(
        compose(notice(NotificationOutboxKind.EVENT_MOVED)),
      ).resolves.toBeNull();

      occurrence.startsAt = new Date('2029-12-07T20:00:00Z');
      await expect(
        compose(
          notice(NotificationOutboxKind.EVENT_REMINDER, {
            detail: { leadMinutes: 15 },
          }),
        ),
      ).resolves.toBeNull();

      world.db.rows(ScopeEventReminderEntity).splice(0);
      await expect(
        compose(notice(NotificationOutboxKind.EVENT_REMINDER)),
      ).resolves.toBeNull();
    });

    it('names a Community’s and an Armada’s event, and links nothing without a site address', async () => {
      delete process.env.APP_FRONTEND_URL;
      event.fleetId = null;

      await expect(
        compose(notice(NotificationOutboxKind.EVENT_CANCELLED)),
      ).resolves.toEqual(
        expect.objectContaining({
          linkUrl: null,
          body: expect.stringContaining('(Fixture Community)'),
        }),
      );

      process.env.APP_FRONTEND_URL = SITE;
      event.armadaId = ARMADA_ID;
      world.db.seed(StoArmadaEntity, [
        {
          id: ARMADA_ID,
          exactGameName: 'Fixture Test Armada',
          slug: 'fixture-test-armada',
          platform: { name: 'Windows' },
        },
      ]);

      await expect(
        compose(notice(NotificationOutboxKind.EVENT_CANCELLED)),
      ).resolves.toEqual(
        expect.objectContaining({
          linkUrl: `${SITE}/fleets/communities/fixture-community/armadas/windows/fixture-test-armada/events/${event.id}`,
        }),
      );
    });
  });
});

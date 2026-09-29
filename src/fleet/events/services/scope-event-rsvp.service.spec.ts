import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
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
import { CharacterEntity } from 'src/sto/character/entities/character.entity';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';

import {
  eventsWorld,
  EventsWorld,
  FLEET,
  MANAGER_ID,
  MEMBER_ID,
  OTHER_MEMBER_ID,
  seedEvent,
  STRANGER_ID,
} from '../../../../test/scope-events-world';
import { FleetAudience } from '../../enums/fleet-audience.enum';
import { FleetScopeStatus } from '../../enums/fleet-scope-status.enum';
import { ScopeEventOccurrenceEntity } from '../entities/scope-event-occurrence.entity';
import { ScopeEventRsvpEntity } from '../entities/scope-event-rsvp.entity';
import { ScopeEventEntity } from '../entities/scope-event.entity';
import { OccurrenceAdjustment } from '../enums/event-recurrence.enum';
import {
  OccurrenceStatus,
  RsvpResponse,
  ScopeEventAudience,
  ScopeEventStatus,
} from '../enums/scope-event.enums';

const NOW = new Date('2029-12-01T12:00:00Z');
const EVENT_ID = '28000000-0000-4000-8000-0000000000e1';

describe('ScopeEventRsvpService', () => {
  let world: EventsWorld;
  let event: ScopeEventEntity;
  let occurrence: ScopeEventOccurrenceEntity;

  const rsvps = () =>
    world.db.rows<ScopeEventRsvpEntity & Record<string, unknown>>(
      ScopeEventRsvpEntity,
    );
  const notices = () =>
    world.db.rows<NotificationOutboxEntity & Record<string, unknown>>(
      NotificationOutboxEntity,
    );
  const answer = (
    userId: string,
    response: RsvpResponse,
    characterId?: string | null,
  ) =>
    world.rsvps.answer(FLEET, EVENT_ID, occurrence.id, userId, {
      response,
      characterId,
    });

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    world = eventsWorld();
    event = seedEvent(world.db, { capacity: 1 });
    occurrence = {
      id: 'occurrence-1',
      eventId: EVENT_ID,
      occurrenceKey: '2030-01-04',
      localStart: '2030-01-04T20:00',
      startsAt: new Date('2030-01-04T20:00:00Z'),
      endsAt: new Date('2030-01-04T22:00:00Z'),
      adjustment: OccurrenceAdjustment.NONE,
      status: OccurrenceStatus.SCHEDULED,
      cancelledAt: null,
      isException: false,
      movedFromStartsAt: null,
    } as ScopeEventOccurrenceEntity;
    world.db.seed(ScopeEventOccurrenceEntity, [
      occurrence as unknown as Record<string, unknown>,
    ]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('answer', () => {
    it('gives a place while there is one, holding the occurrence', async () => {
      await expect(answer(MEMBER_ID, RsvpResponse.GOING)).resolves.toEqual({
        response: RsvpResponse.GOING,
        characterId: null,
        waitlistPosition: null,
      });
      expect(world.db.locks).toContain(ScopeEventOccurrenceEntity);
    });

    it('queues Going once the places are taken', async () => {
      await answer(MEMBER_ID, RsvpResponse.GOING);

      await expect(
        answer(OTHER_MEMBER_ID, RsvpResponse.GOING),
      ).resolves.toEqual(expect.objectContaining({ waitlistPosition: 1 }));
      expect(rsvps()[1].waitlistedAt).toEqual(NOW);
    });

    it('changes nothing when the same answer comes again', async () => {
      await answer(MEMBER_ID, RsvpResponse.GOING);

      const first = rsvps()[0];

      await answer(MEMBER_ID, RsvpResponse.GOING);

      expect(rsvps()).toEqual([first]);
    });

    it('keeps a place when only the Character changes', async () => {
      await answer(MEMBER_ID, RsvpResponse.GOING);
      await answer(OTHER_MEMBER_ID, RsvpResponse.GOING);

      await expect(
        answer(MEMBER_ID, RsvpResponse.GOING, `character-of-${MEMBER_ID}`),
      ).resolves.toEqual({
        response: RsvpResponse.GOING,
        characterId: `character-of-${MEMBER_ID}`,
        waitlistPosition: null,
      });
      expect(notices()).toEqual([]);
    });

    it('gives the place to the first waiting, and tells them', async () => {
      await answer(MEMBER_ID, RsvpResponse.GOING);
      await answer(OTHER_MEMBER_ID, RsvpResponse.GOING);

      await answer(MEMBER_ID, RsvpResponse.MAYBE);

      expect(rsvps().map(rsvp => [rsvp.userId, rsvp.waitlistedAt])).toEqual([
        [MEMBER_ID, null],
        [OTHER_MEMBER_ID, null],
      ]);
      expect(notices()).toEqual([
        expect.objectContaining({
          kind: NotificationOutboxKind.EVENT_PROMOTED,
          userId: OTHER_MEMBER_ID,
          subjectId: occurrence.id,
        }),
      ]);
    });

    it('gives everyone a place when there is no capacity', async () => {
      event.capacity = null;
      await answer(MEMBER_ID, RsvpResponse.GOING);

      await expect(
        answer(OTHER_MEMBER_ID, RsvpResponse.GOING),
      ).resolves.toEqual(expect.objectContaining({ waitlistPosition: null }));
    });

    it('takes a Maybe or a Can’t go without a place', async () => {
      await expect(answer(MEMBER_ID, RsvpResponse.NOT_GOING)).resolves.toEqual(
        expect.objectContaining({ response: RsvpResponse.NOT_GOING }),
      );
    });

    it('refuses somebody else’s Character', async () => {
      await expect(
        answer(MEMBER_ID, RsvpResponse.GOING, 'character-of-someone'),
      ).rejects.toThrow(
        new BadRequestException('That Character is not one of theirs.'),
      );
    });

    it('lets anybody signed in answer a public event', async () => {
      await expect(answer(STRANGER_ID, RsvpResponse.MAYBE)).resolves.toEqual(
        expect.objectContaining({ response: RsvpResponse.MAYBE }),
      );
    });

    it('answers somebody the event is not shown to as absent', async () => {
      event.audience = ScopeEventAudience.MEMBERS;

      await expect(answer(STRANGER_ID, RsvpResponse.GOING)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses somebody who sees it but may not answer', async () => {
      world.standings.set(STRANGER_ID, {
        audiences: [FleetAudience.COMMUNITY],
      });
      event.audience = ScopeEventAudience.COMMUNITY;

      await expect(answer(STRANGER_ID, RsvpResponse.GOING)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('refuses a closed scope, a cancelled event or occurrence, and one started', async () => {
      world.status = FleetScopeStatus.CLOSED;
      await expect(answer(MEMBER_ID, RsvpResponse.GOING)).rejects.toThrow(
        ConflictException,
      );

      world.status = FleetScopeStatus.ACTIVE;
      occurrence.status = OccurrenceStatus.CANCELLED;
      await expect(answer(MEMBER_ID, RsvpResponse.GOING)).rejects.toThrow(
        'This occurrence was cancelled.',
      );

      occurrence.status = OccurrenceStatus.SCHEDULED;
      occurrence.startsAt = new Date('2029-12-01T11:00:00Z');
      await expect(answer(MEMBER_ID, RsvpResponse.GOING)).rejects.toThrow(
        'This has started, so answers are closed.',
      );

      event.status = ScopeEventStatus.CANCELLED;
      await expect(answer(MEMBER_ID, RsvpResponse.GOING)).rejects.toThrow(
        'This event was cancelled.',
      );
    });

    it('answers an occurrence of another event as absent', async () => {
      await expect(
        world.rsvps.answer(FLEET, EVENT_ID, 'no-such', MEMBER_ID, {
          response: RsvpResponse.GOING,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('withdraw', () => {
    it('gives up a place to the first waiting', async () => {
      await answer(MEMBER_ID, RsvpResponse.GOING);
      await answer(OTHER_MEMBER_ID, RsvpResponse.GOING);

      await world.rsvps.withdraw(FLEET, EVENT_ID, occurrence.id, MEMBER_ID);

      expect(rsvps()).toEqual([
        expect.objectContaining({
          userId: OTHER_MEMBER_ID,
          waitlistedAt: null,
        }),
      ]);
      expect(notices()).toHaveLength(1);
    });

    it('frees nothing when the answer held no place', async () => {
      await answer(MEMBER_ID, RsvpResponse.MAYBE);

      await world.rsvps.withdraw(FLEET, EVENT_ID, occurrence.id, MEMBER_ID);

      expect(rsvps()).toEqual([]);
      expect(notices()).toEqual([]);
    });

    it('says when there is no answer to take back', async () => {
      await expect(
        world.rsvps.withdraw(FLEET, EVENT_ID, occurrence.id, MEMBER_ID),
      ).rejects.toThrow('You have not answered this.');
    });
  });

  describe('promote', () => {
    const waiting = (userId: string, at: string) => ({
      occurrenceId: occurrence.id,
      userId,
      response: RsvpResponse.GOING,
      waitlistedAt: new Date(at),
    });

    it('gives everyone waiting a place when there is no capacity', async () => {
      world.db.seed(ScopeEventRsvpEntity, [
        waiting(MEMBER_ID, '2029-11-02T00:00:00Z'),
        waiting(OTHER_MEMBER_ID, '2029-11-01T00:00:00Z'),
      ]);

      await world.rsvps.promote(
        world.db.asManager(),
        { capacity: null },
        occurrence,
        NOW,
      );

      expect(notices().map(notice => notice.userId)).toEqual([
        OTHER_MEMBER_ID,
        MEMBER_ID,
      ]);
    });

    it('gives nothing once started or cancelled', async () => {
      world.db.seed(ScopeEventRsvpEntity, [
        waiting(MEMBER_ID, '2029-11-02T00:00:00Z'),
      ]);

      await world.rsvps.promote(
        world.db.asManager(),
        { capacity: null },
        { ...occurrence, startsAt: NOW },
        NOW,
      );
      await world.rsvps.promote(
        world.db.asManager(),
        { capacity: null },
        { ...occurrence, status: OccurrenceStatus.CANCELLED },
        NOW,
      );

      expect(notices()).toEqual([]);
    });

    it('gives nothing while the places are over-full', async () => {
      world.db.seed(ScopeEventRsvpEntity, [
        {
          occurrenceId: occurrence.id,
          userId: 'a',
          response: RsvpResponse.GOING,
          waitlistedAt: null,
        },
        {
          occurrenceId: occurrence.id,
          userId: 'b',
          response: RsvpResponse.GOING,
          waitlistedAt: null,
        },
        waiting(MEMBER_ID, '2029-11-02T00:00:00Z'),
      ]);

      await world.rsvps.promote(
        world.db.asManager(),
        { capacity: 1 },
        occurrence,
        NOW,
      );

      expect(notices()).toEqual([]);
    });
  });

  describe('reading answers', () => {
    beforeEach(() => {
      world.db
        .seed(UserProfileEntity, [
          { userId: MEMBER_ID, username: 'Member' },
          { userId: OTHER_MEMBER_ID, username: 'Other' },
          { userId: MANAGER_ID, username: 'Manager' },
        ])
        .seed(CharacterEntity, [
          { id: 'character-1', fullHandle: 'Rex@member' },
        ])
        .seed(ScopeEventRsvpEntity, [
          {
            id: 'r1',
            occurrenceId: occurrence.id,
            userId: MANAGER_ID,
            response: RsvpResponse.NOT_GOING,
            characterId: null,
            waitlistedAt: null,
            respondedAt: new Date('2029-11-01T00:00:00Z'),
          },
          {
            id: 'r2',
            occurrenceId: occurrence.id,
            userId: OTHER_MEMBER_ID,
            response: RsvpResponse.GOING,
            characterId: 'gone-character',
            waitlistedAt: new Date('2029-11-03T00:00:00Z'),
            respondedAt: new Date('2029-11-02T00:00:00Z'),
          },
          {
            id: 'r3',
            occurrenceId: occurrence.id,
            userId: 'nameless',
            response: RsvpResponse.MAYBE,
            characterId: null,
            waitlistedAt: null,
            respondedAt: new Date('2029-11-03T00:00:00Z'),
          },
          {
            id: 'r4',
            occurrenceId: occurrence.id,
            userId: MEMBER_ID,
            response: RsvpResponse.GOING,
            characterId: 'character-1',
            waitlistedAt: null,
            respondedAt: new Date('2029-11-04T00:00:00Z'),
          },
        ]);
    });

    it('counts each answer, Can’t go for managers only', async () => {
      const manager = world.db.asManager();

      await expect(
        world.rsvps.countsFor(manager, [occurrence.id, 'none'], true),
      ).resolves.toEqual(
        new Map([
          [occurrence.id, { going: 1, maybe: 1, waitlisted: 1, notGoing: 1 }],
          ['none', { going: 0, maybe: 0, waitlisted: 0, notGoing: 0 }],
        ]),
      );
      expect(
        (await world.rsvps.countsFor(manager, [occurrence.id], false)).get(
          occurrence.id,
        ),
      ).toEqual({ going: 1, maybe: 1, waitlisted: 1, notGoing: null });
      await expect(world.rsvps.countsFor(manager, [], false)).resolves.toEqual(
        new Map(),
      );
    });

    it('lists those with a place, then waiting, then Maybe, then Can’t go', async () => {
      await expect(
        world.rsvps.people(world.db.asManager(), occurrence.id, true),
      ).resolves.toEqual([
        {
          userId: MEMBER_ID,
          username: 'Member',
          characterName: 'Rex@member',
          response: RsvpResponse.GOING,
          waitlisted: false,
        },
        {
          userId: OTHER_MEMBER_ID,
          username: 'Other',
          characterName: null,
          response: RsvpResponse.GOING,
          waitlisted: true,
        },
        {
          userId: 'nameless',
          username: null,
          characterName: null,
          response: RsvpResponse.MAYBE,
          waitlisted: false,
        },
        {
          userId: MANAGER_ID,
          username: 'Manager',
          characterName: null,
          response: RsvpResponse.NOT_GOING,
          waitlisted: false,
        },
      ]);
    });

    it('lists those with places in the order they answered', async () => {
      world.db.seed(ScopeEventRsvpEntity, [
        {
          id: 'r5',
          occurrenceId: occurrence.id,
          userId: MANAGER_ID,
          response: RsvpResponse.GOING,
          characterId: null,
          waitlistedAt: null,
          respondedAt: new Date('2029-11-05T00:00:00Z'),
        },
      ]);

      const people = await world.rsvps.people(
        world.db.asManager(),
        occurrence.id,
        false,
      );

      expect(people.slice(0, 2).map(person => person.username)).toEqual([
        'Member',
        'Manager',
      ]);
    });

    it('lists nobody for an occurrence nobody answered', async () => {
      await expect(
        world.rsvps.people(world.db.asManager(), 'none', true),
      ).resolves.toEqual([]);
    });

    it('leaves out Can’t go for anybody but managers', async () => {
      const people = await world.rsvps.people(
        world.db.asManager(),
        occurrence.id,
        false,
      );

      expect(people.map(person => person.response)).not.toContain(
        RsvpResponse.NOT_GOING,
      );
    });

    it('shows somebody their own answer, and nothing when signed out', async () => {
      const manager = world.db.asManager();

      await expect(
        world.rsvps.mine(manager, occurrence.id, OTHER_MEMBER_ID),
      ).resolves.toEqual({
        response: RsvpResponse.GOING,
        characterId: 'gone-character',
        waitlistPosition: 1,
      });
      await expect(
        world.rsvps.mine(manager, occurrence.id, null),
      ).resolves.toBeNull();
      await expect(
        world.rsvps.mine(manager, occurrence.id, STRANGER_ID),
      ).resolves.toBeNull();
    });
  });
});

import {
  BadRequestException,
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

import { CharacterEntity } from 'src/sto/character/entities/character.entity';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';

import {
  COMMUNITY,
  COMMUNITY_ID,
  eventsWorld,
  EventsWorld,
  FLEET,
  FLEET_ID,
  MANAGER_ID,
  MEMBER_ID,
  OTHER_MEMBER_ID,
  seedEvent,
  STRANGER_ID,
} from '../../../../test/scope-events-world';
import { ScopeMembershipEntity } from '../../entities/scope-membership.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import { ScopeMembershipStatus } from '../../enums/scope-membership-status.enum';
import { ScopeEventActionEntity } from '../entities/scope-event-action.entity';
import { ScopeEventAttendanceEntity } from '../entities/scope-event-attendance.entity';
import { ScopeEventAudienceMemberEntity } from '../entities/scope-event-audience-member.entity';
import { ScopeEventOccurrenceEntity } from '../entities/scope-event-occurrence.entity';
import { ScopeEventReminderEntity } from '../entities/scope-event-reminder.entity';
import { ScopeEventRsvpEntity } from '../entities/scope-event-rsvp.entity';
import { ScopeEventEntity } from '../entities/scope-event.entity';
import { OccurrenceAdjustment } from '../enums/event-recurrence.enum';
import {
  OccurrenceStatus,
  RsvpResponse,
  ScopeEventActionKind,
  ScopeEventAudience,
  ScopeEventStatus,
} from '../enums/scope-event.enums';

const NOW = new Date('2029-12-01T12:00:00Z');

describe('ScopeEventReadService', () => {
  let world: EventsWorld;
  let event: ScopeEventEntity;

  /**
   * Seeds one occurrence of the event.
   *
   * @param id - Its ID.
   * @param startsAt - When it starts.
   * @param overrides - What else differs.
   */
  function occurrence(
    id: string,
    startsAt: string,
    overrides: Partial<ScopeEventOccurrenceEntity> = {},
  ): void {
    world.db.seed(ScopeEventOccurrenceEntity, [
      {
        id,
        eventId: event.id,
        occurrenceKey: startsAt.slice(0, 10),
        localStart: startsAt.slice(0, 16),
        startsAt: new Date(startsAt),
        endsAt: new Date(new Date(startsAt).getTime() + 7_200_000),
        adjustment: OccurrenceAdjustment.NONE,
        status: OccurrenceStatus.SCHEDULED,
        movedFromStartsAt: null,
        ...overrides,
      },
    ]);
  }

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    world = eventsWorld();
    event = seedEvent(world.db, { capacity: 10 });
    occurrence('held', '2029-11-30T20:00:00Z');
    occurrence('next', '2029-12-07T20:00:00Z');
    occurrence('later', '2029-12-14T20:00:00Z', {
      status: OccurrenceStatus.CANCELLED,
    });
    occurrence('far', '2030-03-01T20:00:00Z');
    world.db
      .seed(UserProfileEntity, [
        { userId: MEMBER_ID, username: 'Member' },
        { userId: MANAGER_ID, username: 'Manager' },
      ])
      .seed(CharacterEntity, [{ id: 'character-1', fullHandle: 'Rex@member' }])
      .seed(ScopeEventRsvpEntity, [
        {
          occurrenceId: 'next',
          userId: MEMBER_ID,
          response: RsvpResponse.GOING,
          characterId: 'character-1',
          waitlistedAt: null,
        },
        {
          occurrenceId: 'next',
          userId: MANAGER_ID,
          response: RsvpResponse.NOT_GOING,
          characterId: null,
          waitlistedAt: null,
        },
      ]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * An approved membership of the Fleet.
   *
   * @param userId - Whose.
   * @returns The row.
   */
  const membership = (userId: string): Record<string, unknown> => ({
    communityId: COMMUNITY_ID,
    fleetId: FLEET_ID,
    userId,
    status: ScopeMembershipStatus.APPROVED,
    deletedAt: null,
  });

  describe('calendar', () => {
    it('lists the next month of what the reader may see, earliest first', async () => {
      const calendar = await world.reads.calendar(FLEET, MEMBER_ID, {});

      expect(calendar).toEqual(
        expect.objectContaining({
          from: NOW,
          to: new Date('2030-01-01T12:00:00Z'),
          mayManage: false,
          isOpen: true,
          isSuspended: false,
        }),
      );
      expect(calendar.entries.map(entry => entry.occurrence.id)).toEqual([
        'next',
        'later',
      ]);
      expect(calendar.entries[0]).toEqual({
        event: {
          id: event.id,
          title: 'Refit night',
          audience: ScopeEventAudience.PUBLIC,
          timezone: 'Europe/London',
          capacity: 10,
          externalUrl: null,
          status: event.status,
          recurrence: event.recurrence,
        },
        occurrence: expect.objectContaining({
          key: '2029-12-07',
          counts: { going: 1, maybe: 0, waitlisted: 0, notGoing: null },
          mine: {
            response: RsvpResponse.GOING,
            characterId: 'character-1',
            waitlistPosition: null,
          },
        }),
      });
    });

    it('reads the stretch asked for, up to 93 days', async () => {
      const calendar = await world.reads.calendar(FLEET, null, {
        from: '2029-11-01T00:00:00Z',
        to: '2030-01-31T00:00:00Z',
      });

      expect(calendar.entries.map(entry => entry.occurrence.id)).toEqual([
        'held',
        'next',
        'later',
      ]);
    });

    it('refuses a stretch backwards or too long', async () => {
      await expect(
        world.reads.calendar(FLEET, null, {
          from: '2030-01-01T00:00:00Z',
          to: '2029-12-31T00:00:00Z',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        world.reads.calendar(FLEET, null, { to: '2030-06-01T00:00:00Z' }),
      ).rejects.toThrow('Ask for up to 93 days');
    });

    it('shows nothing of events the reader may not see', async () => {
      event.audience = ScopeEventAudience.MEMBERS;

      const calendar = await world.reads.calendar(FLEET, STRANGER_ID, {});

      expect(calendar.entries).toEqual([]);
    });

    it('reads a Community’s own events only', async () => {
      const calendar = await world.reads.calendar(COMMUNITY, MEMBER_ID, {});

      expect(calendar.entries).toEqual([]);
    });
  });

  describe('detail', () => {
    it('shows an event, its rule and what lies ahead', async () => {
      world.db.seed(ScopeEventReminderEntity, [
        { eventId: event.id, userId: MEMBER_ID, leadMinutes: [15, 60] },
      ]);

      const detail = await world.reads.detail(FLEET, event.id, MEMBER_ID);

      expect(detail).toEqual(
        expect.objectContaining({
          id: event.id,
          startDate: '2030-01-04',
          startTime: '20:00',
          durationMinutes: 120,
          audienceFleetIds: [],
          audienceRoles: [],
          myReminders: [15, 60],
          mayManage: false,
          mayAnswer: true,
          isOpen: true,
        }),
      );
      expect(detail.upcoming.map(summary => summary.id)).toEqual([
        'next',
        'later',
        'far',
      ]);
    });

    it('shows managers whom a chosen audience is for', async () => {
      event.audience = ScopeEventAudience.SELECTED;
      world.db.seed(ScopeEventAudienceMemberEntity, [
        { eventId: event.id, fleetId: FLEET_ID, role: null },
        { eventId: event.id, fleetId: null, role: FleetScopeRole.OFFICER },
      ]);

      const detail = await world.reads.detail(FLEET, event.id, MANAGER_ID);

      expect(detail.audienceFleetIds).toEqual([FLEET_ID]);
      expect(detail.audienceRoles).toEqual([FleetScopeRole.OFFICER]);
      expect(detail.upcoming[0].counts.notGoing).toBe(1);
    });

    it('shows a signed-out reader no reminders of theirs', async () => {
      const detail = await world.reads.detail(FLEET, event.id, null);

      expect(detail.myReminders).toEqual([]);
      expect(detail.mayAnswer).toBe(false);
    });

    it('answers an event the reader may not see as absent', async () => {
      event.audience = ScopeEventAudience.OFFICERS;

      await expect(
        world.reads.detail(FLEET, event.id, MEMBER_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('occurrence', () => {
    it('shows members who answered, but not Can’t go', async () => {
      const detail = await world.reads.occurrence(
        FLEET,
        event.id,
        'next',
        OTHER_MEMBER_ID,
      );

      expect(detail.people.map(person => person.username)).toEqual(['Member']);
      expect(detail.myAttendance).toBeNull();
      expect(detail.mayManage).toBe(false);
    });

    it('shows managers everyone, and nobody else anyone', async () => {
      await expect(
        world.reads.occurrence(FLEET, event.id, 'next', MANAGER_ID),
      ).resolves.toEqual(
        expect.objectContaining({
          people: [
            expect.objectContaining({ username: 'Member' }),
            expect.objectContaining({ username: 'Manager' }),
          ],
        }),
      );
      await expect(
        world.reads.occurrence(FLEET, event.id, 'next', STRANGER_ID),
      ).resolves.toEqual(expect.objectContaining({ people: [] }));
    });

    it('shows somebody their own attendance', async () => {
      world.db.seed(ScopeEventAttendanceEntity, [
        {
          occurrenceId: 'held',
          userId: MEMBER_ID,
          attended: true,
          characterId: 'character-1',
          recordedAt: NOW,
        },
      ]);

      const detail = await world.reads.occurrence(
        FLEET,
        event.id,
        'held',
        MEMBER_ID,
      );

      expect(detail.myAttendance).toEqual({
        userId: MEMBER_ID,
        username: 'Member',
        attended: true,
        characterName: 'Rex@member',
        recordedAt: NOW,
      });
      await expect(
        world.reads.occurrence(FLEET, event.id, 'held', null),
      ).resolves.toEqual(expect.objectContaining({ myAttendance: null }));
    });

    it('answers an occurrence of another event as absent', async () => {
      await expect(
        world.reads.occurrence(FLEET, event.id, 'nothing', MEMBER_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('for managers', () => {
    it('lists who came, by name', async () => {
      world.db.seed(ScopeEventAttendanceEntity, [
        {
          occurrenceId: 'held',
          userId: MEMBER_ID,
          attended: true,
          characterId: null,
          recordedAt: NOW,
        },
        {
          occurrenceId: 'held',
          userId: 'nameless',
          attended: false,
          characterId: 'gone',
          recordedAt: NOW,
        },
        {
          occurrenceId: 'held',
          userId: MANAGER_ID,
          attended: false,
          characterId: null,
          recordedAt: NOW,
        },
      ]);

      const sheet = await world.reads.attendance(
        FLEET,
        event.id,
        'held',
        MANAGER_ID,
      );

      expect(
        sheet.records.map(record => [record.username, record.characterName]),
      ).toEqual([
        [null, null],
        ['Manager', null],
        ['Member', null],
      ]);
    });

    it('offers everybody who answered, then the members who did not', async () => {
      world.db
        .seed(UserProfileEntity, [
          { userId: OTHER_MEMBER_ID, username: 'Other' },
        ])
        .seed(ScopeMembershipEntity, [
          membership(MEMBER_ID),
          membership(OTHER_MEMBER_ID),
          membership('nameless'),
          membership('nameless-too'),
        ]);

      const sheet = await world.reads.attendance(
        FLEET,
        event.id,
        'next',
        MANAGER_ID,
      );

      expect(sheet.candidates).toEqual([
        { userId: MEMBER_ID, username: 'Member', response: RsvpResponse.GOING },
        {
          userId: MANAGER_ID,
          username: 'Manager',
          response: RsvpResponse.NOT_GOING,
        },
        { userId: 'nameless', username: null, response: null },
        { userId: 'nameless-too', username: null, response: null },
        { userId: OTHER_MEMBER_ID, username: 'Other', response: null },
      ]);
    });

    it('reads the change log, newest first, by name', async () => {
      world.db.seed(ScopeEventActionEntity, [
        {
          id: 'a1',
          eventId: event.id,
          occurrenceId: null,
          action: ScopeEventActionKind.CREATED,
          actorUserId: MANAGER_ID,
          subjectUserId: null,
          detail: null,
          createdAt: new Date('2029-11-01T00:00:00Z'),
        },
        {
          id: 'a2',
          eventId: event.id,
          occurrenceId: 'held',
          action: ScopeEventActionKind.ATTENDANCE_RECORDED,
          actorUserId: null,
          subjectUserId: MEMBER_ID,
          detail: { attended: true },
          createdAt: new Date('2029-11-30T23:00:00Z'),
        },
        {
          id: 'a3',
          eventId: event.id,
          occurrenceId: null,
          action: ScopeEventActionKind.EDITED,
          actorUserId: 'gone-user',
          subjectUserId: 'gone-subject',
          detail: null,
          createdAt: new Date('2029-11-15T00:00:00Z'),
        },
      ]);

      const history = await world.reads.history(FLEET, event.id, MANAGER_ID);

      expect(
        history.map(entry => [entry.id, entry.actorName, entry.subjectName]),
      ).toEqual([
        ['a2', null, 'Member'],
        ['a3', null, null],
        ['a1', 'Manager', null],
      ]);
    });

    it('is refused to anybody else', async () => {
      await expect(
        world.reads.history(FLEET, event.id, MEMBER_ID),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        world.reads.attendance(FLEET, event.id, 'held', MEMBER_ID),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('somebody’s own upcoming events', () => {
    beforeEach(() => {
      world.db.seed(StoFleetEntity, [
        {
          id: FLEET_ID,
          exactGameName: 'Fixture Fleet',
          slug: 'fixture-fleet',
          platform: { name: 'Windows' },
        },
      ]);
    });

    const mine = (userId: string) => world.reads.upcomingFor(userId);

    it('is empty for somebody who answered and asked for nothing', async () => {
      await expect(mine(OTHER_MEMBER_ID)).resolves.toEqual({ entries: [] });
    });

    it('lists what they will go to in the next thirty days, with its scope', async () => {
      const { entries } = await mine(MEMBER_ID);

      expect(entries).toEqual([
        {
          event: expect.objectContaining({
            id: event.id,
            title: 'Refit night',
          }),
          occurrence: expect.objectContaining({
            id: 'next',
            mine: expect.objectContaining({ response: RsvpResponse.GOING }),
          }),
          scope: {
            kind: FleetScopeKind.FLEET,
            name: 'Fixture Fleet',
            path: '/fleets/communities/fixture-community/fleets/windows/fixture-fleet',
          },
        },
      ]);
    });

    it('lists each occurrence still going ahead of an event they are reminded of, once', async () => {
      world.db.seed(ScopeEventReminderEntity, [
        { eventId: event.id, userId: MEMBER_ID, leadMinutes: [60] },
      ]);

      const { entries } = await mine(MEMBER_ID);

      expect(entries.map(entry => entry.occurrence.id)).toEqual(['next']);
    });

    it('leaves out what they cannot go to', async () => {
      await expect(mine(MANAGER_ID)).resolves.toEqual({ entries: [] });
    });

    it('leaves out a cancelled event', async () => {
      event.status = ScopeEventStatus.CANCELLED;

      await expect(mine(MEMBER_ID)).resolves.toEqual({ entries: [] });
    });

    it('leaves out an event they may no longer see', async () => {
      world.standings.set(MEMBER_ID, { seesScope: false });

      await expect(mine(MEMBER_ID)).resolves.toEqual({ entries: [] });
    });

    it('leaves out an event they may see only at a scope that has gone', async () => {
      world.db.rows(StoFleetEntity).splice(0);

      await expect(mine(MEMBER_ID)).resolves.toEqual({ entries: [] });
    });

    it('asks once per event however many of its occurrences are listed', async () => {
      world.db.seed(ScopeEventRsvpEntity, [
        {
          occurrenceId: 'far',
          userId: MEMBER_ID,
          response: RsvpResponse.MAYBE,
          characterId: null,
          waitlistedAt: null,
        },
      ]);
      jest.setSystemTime(new Date('2030-02-15T12:00:00Z'));
      occurrence('soon', '2030-02-20T20:00:00Z');
      world.db.seed(ScopeEventReminderEntity, [
        { eventId: event.id, userId: MEMBER_ID, leadMinutes: [60] },
      ]);

      const viewerOf = jest.spyOn(world.access, 'viewerOf');
      const { entries } = await mine(MEMBER_ID);

      expect(entries.map(entry => entry.occurrence.id)).toEqual([
        'soon',
        'far',
      ]);
      expect(viewerOf).toHaveBeenCalledTimes(1);
    });
  });
});

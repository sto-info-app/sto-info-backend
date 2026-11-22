import { ConflictException, ForbiddenException } from '@nestjs/common';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import {
  COMMUNITY_ID,
  eventsWorld,
  EventsWorld,
  FLEET,
  FLEET_ID,
  MANAGER_ID,
  MEMBER_ID,
  seedEvent,
  STRANGER_ID,
} from '../../../../test/scope-events-world';
import { ScopeMembershipEntity } from '../../entities/scope-membership.entity';
import { ScopeMembershipStatus } from '../../enums/scope-membership-status.enum';
import { ScopeEventActionEntity } from '../entities/scope-event-action.entity';
import { ScopeEventAttendanceEntity } from '../entities/scope-event-attendance.entity';
import { ScopeEventOccurrenceEntity } from '../entities/scope-event-occurrence.entity';
import { ScopeEventRsvpEntity } from '../entities/scope-event-rsvp.entity';
import {
  OccurrenceStatus,
  RsvpResponse,
  ScopeEventActionKind,
} from '../enums/scope-event.enums';

const NOW = new Date('2029-12-01T12:00:00Z');
const EVENT_ID = '28000000-0000-4000-8000-0000000000e1';

describe('ScopeEventAttendanceService', () => {
  let world: EventsWorld;
  let occurrence: Record<string, unknown>;

  const record = (attended: boolean, userId = MEMBER_ID) =>
    world.attendance.record(
      FLEET,
      EVENT_ID,
      'held',
      { userId, attended },
      MANAGER_ID,
    );

  /**
   * Has somebody answered the occurrence.
   *
   * @param userId - Who.
   * @param characterId - The Character they answered with.
   */
  const answered = (userId: string, characterId: string | null): void => {
    world.db.seed(ScopeEventRsvpEntity, [
      {
        occurrenceId: 'held',
        userId,
        response: RsvpResponse.GOING,
        characterId,
        waitlistedAt: null,
      },
    ]);
  };

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    world = eventsWorld();
    seedEvent(world.db);
    occurrence = {
      id: 'held',
      eventId: EVENT_ID,
      startsAt: new Date('2029-12-01T11:00:00Z'),
      status: OccurrenceStatus.SCHEDULED,
    };
    world.db
      .seed(ScopeEventOccurrenceEntity, [occurrence])
      .seed(ScopeMembershipEntity, [
        {
          communityId: COMMUNITY_ID,
          fleetId: FLEET_ID,
          userId: MEMBER_ID,
          status: ScopeMembershipStatus.APPROVED,
          deletedAt: null,
        },
      ]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('records a member who never answered, with no Character, and logs it', async () => {
    await record(true);

    expect(world.db.rows(ScopeEventAttendanceEntity)).toEqual([
      expect.objectContaining({
        occurrenceId: 'held',
        userId: MEMBER_ID,
        attended: true,
        characterId: null,
        recordedByUserId: MANAGER_ID,
      }),
    ]);
    expect(world.db.rows(ScopeEventActionEntity)).toEqual([
      expect.objectContaining({
        action: ScopeEventActionKind.ATTENDANCE_RECORDED,
        actorUserId: MANAGER_ID,
        subjectUserId: MEMBER_ID,
        occurrenceId: 'held',
        detail: { attended: true },
      }),
    ]);
  });

  it('records somebody who answered as the Character they answered with', async () => {
    answered(STRANGER_ID, `character-of-${STRANGER_ID}`);

    await record(true, STRANGER_ID);

    expect(world.db.rows(ScopeEventAttendanceEntity)).toEqual([
      expect.objectContaining({
        userId: STRANGER_ID,
        characterId: `character-of-${STRANGER_ID}`,
      }),
    ]);
  });

  it('records no Character that is no longer theirs', async () => {
    answered(MEMBER_ID, 'character-of-someone');

    await record(false);

    expect(world.db.rows(ScopeEventAttendanceEntity)).toEqual([
      expect.objectContaining({ attended: false, characterId: null }),
    ]);
  });

  it('corrects what was recorded, rather than adding to it', async () => {
    await record(true);
    await record(false);

    expect(world.db.rows(ScopeEventAttendanceEntity)).toEqual([
      expect.objectContaining({ attended: false }),
    ]);
  });

  it('is for event managers only', async () => {
    await expect(
      world.attendance.record(
        FLEET,
        EVENT_ID,
        'held',
        { userId: MEMBER_ID, attended: true },
        MEMBER_ID,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('waits until the occurrence has started', async () => {
    occurrence.startsAt = new Date('2029-12-01T13:00:00Z');

    await expect(record(true)).rejects.toThrow(
      'Attendance is recorded once it has started.',
    );
  });

  it('refuses a cancelled occurrence', async () => {
    occurrence.status = OccurrenceStatus.CANCELLED;

    await expect(record(true)).rejects.toThrow(ConflictException);
  });

  it('refuses somebody who neither answered nor is a member', async () => {
    await expect(record(true, STRANGER_ID)).rejects.toThrow(
      'They neither answered nor are one of its members.',
    );
  });
});

import { beforeEach, describe, expect, it } from '@jest/globals';

import { NotificationOutboxKind } from 'src/notification/outbox/notification-outbox-kind.enum';
import { NotificationOutboxEntity } from 'src/notification/outbox/notification-outbox.entity';

import { InMemoryManager } from '../../../../test/in-memory-manager';
import {
  ARMADA_ID,
  COMMUNITY_ID,
  FLEET_ID,
  MANAGER_ID,
  MEMBER_ID,
} from '../../../../test/scope-events-world';
import { ScopeEventActionEntity } from '../entities/scope-event-action.entity';
import { ScopeEventOccurrenceEntity } from '../entities/scope-event-occurrence.entity';
import { ScopeEventReminderEntity } from '../entities/scope-event-reminder.entity';
import { ScopeEventEntity } from '../entities/scope-event.entity';
import {
  OccurrenceStatus,
  ScopeEventActionKind,
  ScopeEventStatus,
} from '../enums/scope-event.enums';
import {
  cancelFutureOccurrences,
  endEventsForClosure,
} from './event-closure.utility';

const NOW = new Date('2029-12-01T12:00:00Z');

describe('event closure', () => {
  let db: InMemoryManager;

  /**
   * Seeds an event with one occurrence held and one to come.
   *
   * @param id - The event.
   * @param scope - Its Fleet or Armada, if any.
   */
  function event(
    id: string,
    scope: { fleetId?: string; armadaId?: string } = {},
  ): void {
    db.seed(ScopeEventEntity, [
      {
        id,
        communityId: COMMUNITY_ID,
        fleetId: scope.fleetId ?? null,
        armadaId: scope.armadaId ?? null,
        status: ScopeEventStatus.ACTIVE,
        cancelledAt: null,
      },
    ]).seed(ScopeEventOccurrenceEntity, [
      {
        id: `${id}-held`,
        eventId: id,
        startsAt: new Date('2029-11-30T20:00:00Z'),
        status: OccurrenceStatus.SCHEDULED,
      },
      {
        id: `${id}-ahead`,
        eventId: id,
        startsAt: new Date('2029-12-07T20:00:00Z'),
        status: OccurrenceStatus.SCHEDULED,
      },
    ]);
  }

  const statusOf = (id: string) =>
    db
      .rows<Record<string, unknown>>(ScopeEventEntity)
      .find(row => row.id === id)?.status;

  beforeEach(() => {
    db = new InMemoryManager();
    event('community-event');
    event('fleet-event', { fleetId: FLEET_ID });
    event('armada-event', { armadaId: ARMADA_ID });
    db.seed(ScopeEventReminderEntity, [
      { eventId: 'fleet-event', userId: MEMBER_ID, leadMinutes: [60] },
    ]);
  });

  it('cancels only what lies ahead, and tells whoever is reminded', async () => {
    await expect(
      cancelFutureOccurrences(db.asManager(), 'fleet-event', NOW),
    ).resolves.toBe(1);

    const [held, ahead] = db
      .rows<Record<string, unknown>>(ScopeEventOccurrenceEntity)
      .filter(row => row.eventId === 'fleet-event');

    expect(held.status).toBe(OccurrenceStatus.SCHEDULED);
    expect(ahead).toEqual(
      expect.objectContaining({
        status: OccurrenceStatus.CANCELLED,
        cancelledAt: NOW,
      }),
    );
    expect(db.rows(NotificationOutboxEntity)).toEqual([
      expect.objectContaining({
        kind: NotificationOutboxKind.EVENT_CANCELLED,
        subjectId: 'fleet-event-ahead',
        userId: MEMBER_ID,
      }),
    ]);
  });

  it('ends a closing Fleet’s events only, and logs it', async () => {
    await endEventsForClosure(
      db.asManager(),
      { communityId: COMMUNITY_ID, fleetId: FLEET_ID, armadaId: null },
      MANAGER_ID,
      NOW,
    );

    expect(statusOf('fleet-event')).toBe(ScopeEventStatus.CANCELLED);
    expect(statusOf('community-event')).toBe(ScopeEventStatus.ACTIVE);
    expect(statusOf('armada-event')).toBe(ScopeEventStatus.ACTIVE);
    expect(db.rows(ScopeEventActionEntity)).toEqual([
      expect.objectContaining({
        eventId: 'fleet-event',
        action: ScopeEventActionKind.CLOSED_WITH_SCOPE,
        actorUserId: MANAGER_ID,
        detail: { occurrencesCancelled: 1 },
      }),
    ]);
    expect(db.locks).toEqual([]);
  });

  it('ends a closing Armada’s events only', async () => {
    await endEventsForClosure(
      db.asManager(),
      { communityId: COMMUNITY_ID, fleetId: null, armadaId: ARMADA_ID },
      MANAGER_ID,
      NOW,
    );

    expect(statusOf('armada-event')).toBe(ScopeEventStatus.CANCELLED);
    expect(statusOf('fleet-event')).toBe(ScopeEventStatus.ACTIVE);
  });

  it('ends every event in a closing Community', async () => {
    await endEventsForClosure(
      db.asManager(),
      { communityId: COMMUNITY_ID, fleetId: null, armadaId: null },
      MANAGER_ID,
      NOW,
    );

    expect(
      db.rows<Record<string, unknown>>(ScopeEventEntity).map(row => row.status),
    ).toEqual([
      ScopeEventStatus.CANCELLED,
      ScopeEventStatus.CANCELLED,
      ScopeEventStatus.CANCELLED,
    ]);
  });
});

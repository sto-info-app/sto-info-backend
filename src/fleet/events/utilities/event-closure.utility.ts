import { EntityManager, FindOptionsWhere, MoreThan } from 'typeorm';

import { NotificationOutboxKind } from 'src/notification/outbox/notification-outbox-kind.enum';

import { ScopeEventActionEntity } from '../entities/scope-event-action.entity';
import { ScopeEventOccurrenceEntity } from '../entities/scope-event-occurrence.entity';
import { ScopeEventEntity } from '../entities/scope-event.entity';
import {
  OccurrenceStatus,
  ScopeEventActionKind,
  ScopeEventStatus,
} from '../enums/scope-event.enums';
import { noticeSubscribers } from './event-notices.utility';

/** The scope being closed, as the closure knows it. */
export interface ClosingScope {
  readonly communityId: string;
  /** The Fleet, when a Fleet is closing. */
  readonly fleetId: string | null;
  /** The Armada, when an Armada is closing. */
  readonly armadaId: string | null;
}

/**
 * Cancels every occurrence of an event still to come, and tells whoever is
 * reminded of each.
 *
 * Past occurrences, with their answers and attendance, are left exactly as
 * they were.
 *
 * @param manager - The transaction.
 * @param eventId - The event.
 * @param now - The moment of the change.
 * @returns How many were cancelled.
 */
export async function cancelFutureOccurrences(
  manager: EntityManager,
  eventId: string,
  now: Date,
): Promise<number> {
  const ahead = await manager.find(ScopeEventOccurrenceEntity, {
    where: {
      eventId,
      status: OccurrenceStatus.SCHEDULED,
      startsAt: MoreThan(now),
    },
  });

  for (const occurrence of ahead) {
    occurrence.status = OccurrenceStatus.CANCELLED;
    occurrence.cancelledAt = now;
    await manager.save(ScopeEventOccurrenceEntity, occurrence);
    await noticeSubscribers(
      manager,
      NotificationOutboxKind.EVENT_CANCELLED,
      eventId,
      occurrence,
    );
  }

  return ahead.length;
}

/**
 * Ends the events of a scope being closed (FC-028).
 *
 * Steve's decision of 28 September 2026: closing a scope cancels every
 * occurrence still to come, and tells whoever is reminded of each. A
 * Community's closure reaches its Fleets' and Armadas' events too, since
 * they close with it. Past occurrences stay readable, with what was
 * answered and attended.
 *
 * Called inside the closure's own transaction, so the events end exactly
 * when the scope does.
 *
 * @param manager - The closure's transaction.
 * @param scope - The scope being closed.
 * @param actorUserId - Who closed it, for the change log.
 * @param now - The moment of closure.
 */
export async function endEventsForClosure(
  manager: EntityManager,
  scope: ClosingScope,
  actorUserId: string,
  now: Date,
): Promise<void> {
  const where: FindOptionsWhere<ScopeEventEntity> = {
    communityId: scope.communityId,
    status: ScopeEventStatus.ACTIVE,
    ...(scope.fleetId === null ? {} : { fleetId: scope.fleetId }),
    ...(scope.armadaId === null ? {} : { armadaId: scope.armadaId }),
  };
  const events = await manager.find(ScopeEventEntity, {
    where,
    lock: { mode: 'pessimistic_write' },
  });

  for (const event of events) {
    const cancelled = await cancelFutureOccurrences(manager, event.id, now);

    event.status = ScopeEventStatus.CANCELLED;
    event.cancelledAt = now;
    await manager.save(ScopeEventEntity, event);
    await manager.save(ScopeEventActionEntity, {
      eventId: event.id,
      action: ScopeEventActionKind.CLOSED_WITH_SCOPE,
      actorUserId,
      detail: { occurrencesCancelled: cancelled },
    });
  }
}

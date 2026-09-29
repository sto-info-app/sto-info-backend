import { EntityManager } from 'typeorm';

import { NotificationOutboxKind } from 'src/notification/outbox/notification-outbox-kind.enum';
import { queueOutbox } from 'src/notification/outbox/notification-outbox.utility';

import { ScopeEventOccurrenceEntity } from '../entities/scope-event-occurrence.entity';
import { ScopeEventReminderEntity } from '../entities/scope-event-reminder.entity';

/** The kinds of notice an event raises. */
export type EventNoticeKind =
  | NotificationOutboxKind.EVENT_REMINDER
  | NotificationOutboxKind.EVENT_CANCELLED
  | NotificationOutboxKind.EVENT_MOVED
  | NotificationOutboxKind.EVENT_PROMOTED;

/** The kinds of event notice every subscriber is sent. */
type SubscriberNoticeKind =
  NotificationOutboxKind.EVENT_CANCELLED | NotificationOutboxKind.EVENT_MOVED;

/**
 * The key that makes an event notice sent once (FC-028).
 *
 * A cancellation is news once per person. A move is news once per place it
 * moves to, so a second move is a second notice. A promotion is news once per
 * place given. A reminder is sent once per lead for each time the occurrence
 * is due, so one moved after its reminder is reminded of again. The reminder
 * query builds reminder keys in SQL the same way:
 * `EVENT_REMINDER:<occurrence>:<user>:<lead>:<start, in epoch seconds>`.
 *
 * @param kind - What it tells.
 * @param occurrence - The occurrence it is about.
 * @param userId - Who it is for.
 * @param leadMinutes - For a reminder, how long before.
 * @returns The key.
 */
export function noticeKeyOf(
  kind: EventNoticeKind,
  occurrence: Pick<ScopeEventOccurrenceEntity, 'id' | 'startsAt'>,
  userId: string,
  leadMinutes: number | null = null,
): string {
  const parts = [kind, occurrence.id, userId];

  if (kind === NotificationOutboxKind.EVENT_MOVED) {
    parts.push(occurrence.startsAt.toISOString());
  }

  if (kind === NotificationOutboxKind.EVENT_PROMOTED) {
    parts.push(String(Date.now()));
  }

  if (leadMinutes !== null) {
    parts.push(
      String(leadMinutes),
      String(Math.floor(occurrence.startsAt.getTime() / 1000)),
    );
  }

  return parts.join(':');
}

/**
 * Queues event notices in the transaction making the change they tell of.
 *
 * Through the notification outbox, so a notice is never sent for a change
 * that did not commit, nor lost to a failure after one that did.
 *
 * @param manager - The transaction.
 * @param kind - What they tell.
 * @param occurrence - The occurrence they are about.
 * @param userIds - Who they are for.
 */
export async function queueNotices(
  manager: EntityManager,
  kind: EventNoticeKind,
  occurrence: Pick<ScopeEventOccurrenceEntity, 'id' | 'startsAt'>,
  userIds: readonly string[],
): Promise<void> {
  await queueOutbox(
    manager,
    [...new Set(userIds)].map(userId => ({
      userId,
      kind,
      subjectId: occurrence.id,
      dedupeKey: noticeKeyOf(kind, occurrence, userId),
    })),
  );
}

/**
 * Tells everybody reminded of an event about a change to one occurrence.
 *
 * Steve's decision of 28 September 2026: somebody who asked to be reminded
 * of an event is told when an occurrence they would be reminded of is
 * cancelled or moved. Nobody else is: an event is feed, not inbox.
 *
 * @param manager - The transaction.
 * @param kind - A cancellation or a move.
 * @param eventId - The event.
 * @param occurrence - The occurrence, as it now is.
 */
export async function noticeSubscribers(
  manager: EntityManager,
  kind: SubscriberNoticeKind,
  eventId: string,
  occurrence: Pick<ScopeEventOccurrenceEntity, 'id' | 'startsAt'>,
): Promise<void> {
  const subscribers = await manager.find(ScopeEventReminderEntity, {
    where: { eventId },
    select: { userId: true },
  });

  await queueNotices(
    manager,
    kind,
    occurrence,
    subscribers.map(subscriber => subscriber.userId),
  );
}

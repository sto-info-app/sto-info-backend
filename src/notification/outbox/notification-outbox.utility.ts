import { EntityManager, QueryDeepPartialEntity } from 'typeorm';

import { NotificationOutboxKind } from './notification-outbox-kind.enum';
import { NotificationOutboxEntity } from './notification-outbox.entity';

/** One notice to queue. */
export interface OutboxEntry {
  /** Who it is for. */
  readonly userId: string;
  /** What it tells them. */
  readonly kind: NotificationOutboxKind;
  /** The record it is about. */
  readonly subjectId: string;
  /** Anything else its handler needs. */
  readonly detail?: Record<string, unknown> | null;
  /** What makes it sent once. */
  readonly dedupeKey: string;
}

/**
 * Queues notices in the transaction making the change they tell of
 * (FC-028, FC-029).
 *
 * A plain function taking the transaction, rather than a service method, so
 * a change anywhere — a closure, an import — can queue in its own
 * transaction without the module that makes it depending on this one. A
 * notice already queued with the same key is left as it is.
 *
 * @param manager - The transaction.
 * @param entries - The notices.
 */
export async function queueOutbox(
  manager: EntityManager,
  entries: readonly OutboxEntry[],
): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  await manager
    .createQueryBuilder()
    .insert()
    .into(NotificationOutboxEntity)
    .values(
      entries.map(
        entry =>
          ({
            userId: entry.userId,
            kind: entry.kind,
            subjectId: entry.subjectId,
            detail: entry.detail ?? null,
            dedupeKey: entry.dedupeKey,
          }) as QueryDeepPartialEntity<NotificationOutboxEntity>,
      ),
    )
    .orIgnore()
    .execute();
}

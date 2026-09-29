import { EntityManager, QueryDeepPartialEntity } from 'typeorm';

import { ActivityEventEntity } from '../entities/activity-event.entity';
import { ACTIVITY_VISIBILITY, ActivityType } from '../enums/activity.enums';

/** One thing that happened, to record. */
export interface ActivityRecord {
  /** The Community it happened in. */
  readonly communityId: string;
  /** The Fleet it happened at, if it was a Fleet's. */
  readonly fleetId?: string | null;
  /** The Armada it happened at, if it was an Armada's. */
  readonly armadaId?: string | null;
  /** What happened. */
  readonly type: ActivityType;
  /** Who did it. */
  readonly actorUserId?: string | null;
  /** Who it happened to. */
  readonly subjectUserId?: string | null;
  /** The record it is about. */
  readonly sourceId?: string | null;
  /** References and counts only, never names or text. */
  readonly detail?: Record<string, unknown> | null;
  /**
   * What makes it recorded once: the change that made it, such as the import
   * or the placement, so a replay or a retry writes nothing more.
   */
  readonly idempotencyKey: string;
  /** When it happened. */
  readonly occurredAt: Date;
}

/**
 * Records things that happened, in the transaction making them (FC-029).
 *
 * A plain function taking the transaction, as the notification outbox's is,
 * so any feature records activity without depending on the feed's module.
 * The visibility is the type's, from {@link ACTIVITY_VISIBILITY}, never the
 * caller's choice. One already recorded with the same key is left as it is.
 *
 * @param manager - The transaction.
 * @param records - What happened.
 */
export async function recordActivity(
  manager: EntityManager,
  records: readonly ActivityRecord[],
): Promise<void> {
  if (records.length === 0) {
    return;
  }

  await manager
    .createQueryBuilder()
    .insert()
    .into(ActivityEventEntity)
    .values(
      records.map(
        record =>
          ({
            communityId: record.communityId,
            fleetId: record.fleetId ?? null,
            armadaId: record.armadaId ?? null,
            type: record.type,
            visibility: ACTIVITY_VISIBILITY[record.type],
            actorUserId: record.actorUserId ?? null,
            subjectUserId: record.subjectUserId ?? null,
            sourceId: record.sourceId ?? null,
            detail: record.detail ?? null,
            idempotencyKey: record.idempotencyKey,
            occurredAt: record.occurredAt,
          }) as QueryDeepPartialEntity<ActivityEventEntity>,
      ),
    )
    .orIgnore()
    .execute();
}

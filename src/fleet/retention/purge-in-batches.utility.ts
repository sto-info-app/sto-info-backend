import {
  EntityManager,
  EntityTarget,
  FindOptionsSelect,
  FindOptionsWhere,
  In,
  ObjectLiteral,
} from 'typeorm';

import {
  RETENTION_BATCH_SIZE,
  RETENTION_MAX_BATCHES,
} from './retention.constants';

/** What one bounded purge did. */
export interface PurgeTally {
  /** How many rows went. */
  readonly deleted: number;
  /** False when it stopped at its limit with rows perhaps still due. */
  readonly complete: boolean;
}

/** How far one purge goes; the defaults are the jobs'. */
export interface PurgeLimits {
  readonly batchSize?: number;
  readonly maxBatches?: number;
  /** Whether soft-deleted rows are found too. */
  readonly withDeleted?: boolean;
}

/**
 * Deletes rows a batch at a time, each batch its own statement (FC-037). A
 * run that stops, at its limit or on a failure, leaves only whole batches
 * done, and the next run finds what is still due and carries on.
 *
 * @param manager - The manager to delete through.
 * @param entity - The table.
 * @param where - What is due.
 * @param limits - How far to go.
 * @returns How many went, and whether that was all.
 */
export async function purgeInBatches<T extends ObjectLiteral & { id: string }>(
  manager: EntityManager,
  entity: EntityTarget<T>,
  where: FindOptionsWhere<T> | FindOptionsWhere<T>[],
  limits: PurgeLimits = {},
): Promise<PurgeTally> {
  const batchSize = limits.batchSize ?? RETENTION_BATCH_SIZE;
  const maxBatches = limits.maxBatches ?? RETENTION_MAX_BATCHES;
  let deleted = 0;

  for (let batch = 0; batch < maxBatches; batch++) {
    const rows = await manager.find(entity, {
      where,
      select: { id: true } as FindOptionsSelect<T>,
      take: batchSize,
      withDeleted: limits.withDeleted ?? false,
    });

    if (rows.length > 0) {
      const removed = await manager.delete(entity, {
        id: In(rows.map(row => row.id)),
      } as FindOptionsWhere<T>);

      deleted += removed.affected ?? 0;
    }

    if (rows.length < batchSize) {
      return { deleted, complete: true };
    }
  }

  return { deleted, complete: false };
}

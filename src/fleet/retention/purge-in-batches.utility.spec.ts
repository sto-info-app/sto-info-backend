import { describe, expect, it, jest } from '@jest/globals';
import { LessThan } from 'typeorm';

import { InMemoryManager } from '../../../test/in-memory-manager';
import { purgeInBatches } from './purge-in-batches.utility';
import { RetentionRunEntity } from './retention-run.entity';

/**
 * A manager holding some runs, numbered from 1.
 *
 * @param count - How many.
 * @returns It.
 */
const holding = (count: number): InMemoryManager =>
  new InMemoryManager().seed(
    RetentionRunEntity,
    Array.from({ length: count }, (_, index) => ({
      id: `run-${index + 1}`,
      startedAt: new Date(index),
    })),
  );

describe('purgeInBatches (FC-037)', () => {
  it('deletes everything due, a batch at a time', async () => {
    const db = holding(5);
    const remove = jest.spyOn(db, 'delete');

    await expect(
      purgeInBatches(
        db.asManager(),
        RetentionRunEntity,
        { startedAt: LessThan(new Date(4)) },
        { batchSize: 2 },
      ),
    ).resolves.toEqual({ deleted: 4, complete: true });
    expect(remove).toHaveBeenCalledTimes(2);
    expect(db.rows(RetentionRunEntity).map(row => row.id)).toEqual(['run-5']);
  });

  it('stops at its limit and says so, leaving the rest for the next run', async () => {
    const db = holding(5);
    const where = { startedAt: LessThan(new Date(10)) };
    const limits = { batchSize: 2, maxBatches: 1 };

    await expect(
      purgeInBatches(db.asManager(), RetentionRunEntity, where, limits),
    ).resolves.toEqual({ deleted: 2, complete: false });
    await expect(
      purgeInBatches(db.asManager(), RetentionRunEntity, where, {
        batchSize: 2,
      }),
    ).resolves.toEqual({ deleted: 3, complete: true });
    expect(db.rows(RetentionRunEntity)).toEqual([]);
  });

  it('asks once, and deletes nothing, when nothing is due', async () => {
    const db = holding(1);
    const remove = jest.spyOn(db, 'delete');

    await expect(
      purgeInBatches(db.asManager(), RetentionRunEntity, {
        startedAt: LessThan(new Date(0)),
      }),
    ).resolves.toEqual({ deleted: 0, complete: true });
    expect(remove).not.toHaveBeenCalled();
  });

  it('finds soft-deleted rows when asked, and counts none the driver does not report', async () => {
    const find = jest.fn<(...args: unknown[]) => Promise<{ id: string }[]>>(
      async () => [{ id: 'a' }],
    );
    const manager = { find, delete: jest.fn(async () => ({})) };

    await expect(
      purgeInBatches(
        manager as never,
        RetentionRunEntity,
        {},
        { withDeleted: true },
      ),
    ).resolves.toEqual({ deleted: 0, complete: true });
    expect(find).toHaveBeenCalledWith(
      RetentionRunEntity,
      expect.objectContaining({ take: 500, withDeleted: true }),
    );
  });
});

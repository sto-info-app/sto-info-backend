import { jest } from '@jest/globals';

/**
 * Stands in for the insert-or-ignore that `recordActivity` and `queueOutbox`
 * make (FC-028, FC-029), for specs whose manager is a hand-made mock rather
 * than the in-memory one.
 *
 * Spread `createQueryBuilder` into the mock manager, then read what was
 * recorded with `recorded()`.
 *
 * @returns The builder, and the rows given to it.
 */
export function insertRecorder(): {
  createQueryBuilder: jest.Mock<() => unknown>;
  recorded: () => Record<string, unknown>[];
} {
  const rows: Record<string, unknown>[] = [];
  const builder = {
    insert: () => builder,
    into: () => builder,
    values: (values: Record<string, unknown>[]) => {
      rows.push(...values);

      return builder;
    },
    orIgnore: () => builder,
    execute: () => Promise.resolve(),
  };

  return {
    createQueryBuilder: jest.fn(() => builder),
    recorded: () => rows,
  };
}

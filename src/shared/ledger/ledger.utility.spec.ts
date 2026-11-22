import { describe, expect, it, jest } from '@jest/globals';

import {
  chunksOf,
  eachLimited,
  ledgerKey,
  noTimings,
  parseLedgerKey,
  timed,
} from './ledger.utility';

const ID = '31000000-0000-4000-8000-000000000001';
const AT = '2026-09-30T12:00:00.000Z';
const PREFIX = 'test/hold-ledger/';

describe('ledger utilities (FC-042)', () => {
  describe('keys', () => {
    it('names a marker by when, what about and what, and reads it back', () => {
      const key = ledgerKey(PREFIX, AT, ID, 'PLACED');

      expect(key).toBe(`${PREFIX}${AT}_${ID}_PLACED.json`);
      expect(parseLedgerKey(PREFIX, key)).toEqual({
        key,
        createdAt: AT,
        id: ID,
        kind: 'PLACED',
      });
    });

    it('names a marker of a ledger of one thing without a kind', () => {
      const key = ledgerKey(PREFIX, AT, ID);

      expect(key).toBe(`${PREFIX}${AT}_${ID}.json`);
      expect(parseLedgerKey(PREFIX, key)?.kind).toBeNull();
    });

    it.each([
      ['another prefix', `prod/hold-ledger/${AT}_${ID}.json`],
      ['not JSON', `${PREFIX}${AT}_${ID}.txt`],
      ['one part', `${PREFIX}${AT}.json`],
      ['four parts', `${PREFIX}${AT}_${ID}_PLACED_AGAIN.json`],
      ['an empty part', `${PREFIX}${AT}__PLACED.json`],
      ['no time', `${PREFIX}yesterday_${ID}.json`],
      ['no UUID', `${PREFIX}${AT}_erasure-1.json`],
    ])('refuses a key with %s', (_what, key) => {
      expect(parseLedgerKey(PREFIX, key)).toBeNull();
    });
  });

  it('splits a list into chunks', () => {
    expect(chunksOf([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunksOf([], 2)).toEqual([]);
  });

  describe('eachLimited', () => {
    it('runs a few at a time, keeping the order of what each came to', async () => {
      let running = 0;
      let most = 0;
      const results = await eachLimited([1, 2, 3, 4, 5], 2, async n => {
        running++;
        most = Math.max(most, running);
        await new Promise(resolve => setTimeout(resolve, 6 - n));
        running--;

        return n * 10;
      });

      expect(results).toEqual([10, 20, 30, 40, 50]);
      expect(most).toBe(2);
    });

    it('does nothing with nothing', async () => {
      const step = jest.fn(async () => 1);

      await expect(eachLimited([], 4, step)).resolves.toEqual([]);
      expect(step).not.toHaveBeenCalled();
    });

    it('stops taking items at the first failure', async () => {
      const step = jest.fn(async (n: number) => {
        if (n === 1) {
          throw new Error('Bucket unreachable');
        }

        return n;
      });

      await expect(eachLimited([1, 2, 3, 4], 1, step)).rejects.toThrow(
        'Bucket unreachable',
      );
      expect(step).toHaveBeenCalledTimes(1);
    });
  });

  describe('timed', () => {
    it('adds what a step took to its part, whether it succeeds or not', async () => {
      const timings = noTimings();

      await expect(timed(timings, 'list', async () => 'listed')).resolves.toBe(
        'listed',
      );
      await expect(
        timed(timings, 'replay', async () => {
          await new Promise(resolve => setTimeout(resolve, 5));
          throw new Error('Failed');
        }),
      ).rejects.toThrow('Failed');

      expect(timings.list).toBeGreaterThanOrEqual(0);
      expect(timings.replay).toBeGreaterThan(0);
      expect(timings.compare).toBe(0);
      expect(timings.backfill).toBe(0);
    });
  });
});

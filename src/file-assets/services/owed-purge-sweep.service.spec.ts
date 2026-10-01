import { Logger } from '@nestjs/common';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { DataSource, EntityManager, FindOperator } from 'typeorm';

import { FileAssetEntity } from '../entities/file-asset.entity';
import { AssetWithdrawalService } from './asset-withdrawal.service';
import {
  OWED_PURGE_BATCH,
  OWED_PURGE_SWEEP_LOCK,
  OwedPurgeSweepService,
  readOwedPurges,
} from './owed-purge-sweep.service';

/**
 * Builds a revoked asset with a purge outstanding.
 *
 * @param id - Its identifier.
 * @returns The asset.
 */
const owedAsset = (id: string): FileAssetEntity =>
  ({ id, purgeRequiredAt: new Date(), purgedAt: null }) as FileAssetEntity;

describe('OwedPurgeSweepService (FC-043)', () => {
  let find: jest.Mock<(...args: unknown[]) => Promise<FileAssetEntity[]>>;
  let runnerQuery: jest.Mock<
    (sql: string, params?: unknown[]) => Promise<unknown>
  >;
  let release: jest.Mock<() => Promise<void>>;
  let settleOwedPurge: jest.Mock<(asset: FileAssetEntity) => Promise<boolean>>;
  let log: jest.SpiedFunction<Logger['log']>;
  let warn: jest.SpiedFunction<Logger['warn']>;
  let error: jest.SpiedFunction<Logger['error']>;
  let service: OwedPurgeSweepService;

  beforeEach(() => {
    find = jest.fn(() =>
      Promise.resolve([owedAsset('asset-1'), owedAsset('asset-2')]),
    );
    runnerQuery = jest.fn((sql: string) =>
      Promise.resolve(
        sql.includes('pg_try_advisory_lock') ? [{ locked: true }] : [],
      ),
    );
    release = jest.fn(() => Promise.resolve());
    settleOwedPurge = jest.fn((asset: FileAssetEntity) =>
      Promise.resolve(asset.id === 'asset-1'),
    );
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

    service = new OwedPurgeSweepService(
      {
        createQueryRunner: () => ({
          connect: () => Promise.resolve(),
          query: runnerQuery,
          release,
        }),
        manager: { find },
      } as unknown as DataSource,
      { settleOwedPurge } as unknown as AssetWithdrawalService,
    );
  });

  afterEach(() => {
    // Spies on a prototype are restored by name, not by restoreAllMocks.
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
    jest.restoreAllMocks();
  });

  it('asks again about the oldest owed purges, a batch at a time', async () => {
    await expect(service.tick()).resolves.toEqual({ purged: 1, failed: 1 });

    const [entity, options] = find.mock.calls[0] as [
      unknown,
      {
        where: Record<string, FindOperator<unknown>>;
        order: unknown;
        take: number;
      },
    ];

    expect(entity).toBe(FileAssetEntity);
    expect(options.where.purgeRequiredAt.type).toBe('not');
    expect(options.where.purgedAt.type).toBe('isNull');
    expect(options.order).toEqual({ purgeRequiredAt: 'ASC', id: 'ASC' });
    expect(options.take).toBe(OWED_PURGE_BATCH);
    expect(settleOwedPurge).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(
      '[sweep] Owed purges retried - Purged: 1, Failed: 1',
    );
  });

  it('holds the lock while it runs, and lets it go', async () => {
    await service.tick();

    expect(runnerQuery).toHaveBeenCalledWith(
      'SELECT pg_try_advisory_lock($1::bigint) AS "locked"',
      [OWED_PURGE_SWEEP_LOCK],
    );
    expect(runnerQuery).toHaveBeenCalledWith(
      'SELECT pg_advisory_unlock($1::bigint)',
      [OWED_PURGE_SWEEP_LOCK],
    );
    expect(release).toHaveBeenCalled();
  });

  it('says nothing when nothing is owed', async () => {
    find.mockResolvedValue([]);

    await expect(service.sweep()).resolves.toEqual({ purged: 0, failed: 0 });
    expect(log).not.toHaveBeenCalled();
  });

  it('leaves the run to another instance holding the lock', async () => {
    runnerQuery.mockResolvedValueOnce([{ locked: false }]);

    await expect(service.tick()).resolves.toBeNull();
    expect(find).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
  });

  it('skips a tick while the last one is still going', async () => {
    let finish: (assets: FileAssetEntity[]) => void = () => {};

    find.mockImplementationOnce(
      () =>
        new Promise<FileAssetEntity[]>(resolve => {
          finish = resolve;
        }),
    );

    const first = service.tick();

    await expect(service.tick()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      '[tick] Previous run still going; skipped',
    );

    while (find.mock.calls.length === 0) {
      await new Promise(resolve => setImmediate(resolve));
    }

    finish([]);
    await expect(first).resolves.toEqual({ purged: 0, failed: 0 });
  });

  it.each([
    [new TypeError('boom'), 'TypeError'],
    ['no connection', 'string'],
  ])('survives a run that fails with %p', async (failure, named) => {
    find.mockRejectedValueOnce(failure);

    await expect(service.tick()).resolves.toBeNull();
    expect(error).toHaveBeenCalledWith(
      `[tick] Owed purge run failed - Error: ${named}`,
    );
    expect(runnerQuery).toHaveBeenCalledWith(
      'SELECT pg_advisory_unlock($1::bigint)',
      [OWED_PURGE_SWEEP_LOCK],
    );
  });
});

describe('readOwedPurges (FC-043)', () => {
  it('counts what is owed and overdue in one aggregate, by the database clock', async () => {
    const calls: Array<[string, unknown[]]> = [];
    const chain: Record<string, unknown> = {};

    for (const step of [
      'select',
      'addSelect',
      'where',
      'andWhere',
      'setParameters',
    ]) {
      chain[step] = (...args: unknown[]) => {
        calls.push([step, args]);

        return chain;
      };
    }
    chain.getRawOne = () =>
      Promise.resolve({ owed: 2, overdue: 1, oldestHours: 30 });

    const manager = {
      createQueryBuilder: (entity: unknown, alias: string) => {
        calls.push(['createQueryBuilder', [entity, alias]]);

        return chain;
      },
    } as unknown as EntityManager;

    await expect(readOwedPurges(manager, 24)).resolves.toEqual({
      owed: 2,
      overdue: 1,
      oldestHours: 30,
    });
    expect(calls).toContainEqual([
      'createQueryBuilder',
      [FileAssetEntity, 'asset'],
    ]);
    expect(calls).toContainEqual([
      'where',
      ['asset."purgeRequiredAt" IS NOT NULL'],
    ]);
    expect(calls).toContainEqual(['andWhere', ['asset."purgedAt" IS NULL']]);
    expect(calls).toContainEqual(['setParameters', [{ overdueHours: 24 }]]);
  });
});

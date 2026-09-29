import { Logger } from '@nestjs/common';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';

import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';

import { ScanUsageWindowDto } from '../dto/scan-diagnostics.dto';
import {
  SCAN_REJECTION_PAGE_SIZE,
  ScanDiagnosticsService,
} from './scan-diagnostics.service';

const NOW = new Date('2026-09-26T12:00:00.000Z');

/**
 * Builds one window of the usage view, as PostgreSQL returns it.
 *
 * @param window - The window.
 * @param position - Its place in the view's order.
 * @returns The row.
 */
function usageRow(
  window: ScanUsageWindowDto['window'],
  position: number,
): ScanUsageWindowDto & { position: number } {
  return {
    window,
    position,
    initialScans: 3,
    rescans: 1,
    retriedScans: 1,
    retries: 2,
    clean: 2,
    infected: 1,
    unsupported: 0,
    contentTypeMismatch: 0,
    tooLarge: 0,
    hashMismatch: 0,
    objectMissing: 0,
    retriesExhausted: 0,
    failed: 0,
    inProgress: 1,
    scanMedianMs: 2000,
    scanP95Ms: 3800,
    scanMaxMs: 4000,
    waitMedianMs: 4000,
    waitP95Ms: 12100,
    waitMaxMs: 13000,
  };
}

const ENGINE_ROW = {
  engine: 'clamav',
  engineVersion: '1.4.3',
  signatureVersion: '27500',
  definitionsBuiltAt: new Date('2026-09-26T08:39:00.000Z'),
  reportedAt: new Date('2026-09-26T11:55:00.000Z'),
};

describe('ScanDiagnosticsService', () => {
  let query: jest.Mock<(sql: string) => Promise<unknown>>;
  let getJobCounts: jest.Mock<
    (...types: string[]) => Promise<Record<string, number>>
  >;
  let getRawMany: jest.Mock<() => Promise<unknown[]>>;
  let builder: Record<string, jest.Mock>;
  let findOne: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  let findAndCount: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  let warn: jest.SpiedFunction<Logger['warn']>;
  let service: ScanDiagnosticsService;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

    query = jest.fn((sql: string) =>
      Promise.resolve(
        sql.includes('scan_usage')
          ? [usageRow('24h', 1), usageRow('7d', 2), usageRow('30d', 3)]
          : [ENGINE_ROW],
      ),
    );
    getJobCounts = jest.fn(() =>
      Promise.resolve({
        waiting: 2,
        prioritized: 1,
        delayed: 4,
        active: 1,
        failed: 0,
      }),
    );
    getRawMany = jest.fn(() =>
      Promise.resolve([
        { state: FileAssetState.SCANNING, count: 3 },
        { state: FileAssetState.RETRY_PENDING, count: 1 },
      ]),
    );
    builder = {};
    for (const method of ['select', 'addSelect', 'where', 'groupBy']) {
      builder[method] = jest.fn(() => builder);
    }
    builder.getRawMany = getRawMany as unknown as jest.Mock;

    findOne = jest.fn(() => Promise.resolve(null));
    findAndCount = jest.fn(() => Promise.resolve([[], 0]));

    service = new ScanDiagnosticsService(
      { query } as unknown as DataSource,
      { getJobCounts } as unknown as Queue,
      {
        createQueryBuilder: jest.fn(() => builder),
        findOne,
        findAndCount,
      } as unknown as Repository<FileAssetEntity>,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    warn.mockRestore();
  });

  describe('usage', () => {
    it('reads the worker’s usage view in window order', async () => {
      const result = await service.read();

      expect(query).toHaveBeenCalledWith(
        'SELECT * FROM "sto_info_worker"."scan_usage" ORDER BY "position"',
      );
      expect(result.usage?.map(window => window.window)).toEqual([
        '24h',
        '7d',
        '30d',
      ]);
    });

    it('drops the view’s ordering column', async () => {
      const result = await service.read();

      expect(result.usage?.[0]).not.toHaveProperty('position');
      expect(result.usage?.[0]).toEqual(
        expect.objectContaining({ initialScans: 3, waitP95Ms: 12100 }),
      );
    });

    it('is null, not an error, when the view cannot be read', async () => {
      // The worker's migrations not having run here is the likely cause.
      query.mockImplementation((sql: string) =>
        sql.includes('scan_usage')
          ? Promise.reject(
              Object.assign(new Error('relation does not exist'), {
                code: '42P01',
              }),
            )
          : Promise.resolve([ENGINE_ROW]),
      );

      const result = await service.read();

      expect(result.usage).toBeNull();
      expect(result.engine).not.toBeNull();
      expect(warn).toHaveBeenCalledWith(
        '[readUsage] Source unavailable - Error: Error, Code: 42P01',
      );
    });

    it('does not log the error’s message, which can quote the statement', async () => {
      query.mockImplementation(() =>
        Promise.reject(new Error('secret statement text')),
      );

      await service.read();

      for (const [message] of warn.mock.calls) {
        expect(String(message)).not.toContain('secret statement text');
      }
      expect(warn).toHaveBeenCalledWith(
        '[readUsage] Source unavailable - Error: Error',
      );
    });
  });

  describe('engine status', () => {
    it('reports the latest attempt’s engine and how old its signatures are', async () => {
      const result = await service.read();

      expect(result.engine).toEqual({
        ...ENGINE_ROW,
        // 12:00 less 08:39 is 3 hours 21 minutes, which is 3.35, rounded to
        // one place.
        signatureAgeHours: 3.4,
      });
    });

    it('has no signature age when the build time was never reported', async () => {
      query.mockImplementation((sql: string) =>
        Promise.resolve(
          sql.includes('scan_usage')
            ? []
            : [{ ...ENGINE_ROW, definitionsBuiltAt: null }],
        ),
      );

      const result = await service.read();

      expect(result.engine?.signatureAgeHours).toBeNull();
    });

    it('is null when nothing has been scanned', async () => {
      query.mockImplementation(() => Promise.resolve([]));

      const result = await service.read();

      expect(result.engine).toBeNull();
      expect(result.usage).toEqual([]);
    });

    it('is null when the view cannot be read', async () => {
      query.mockImplementation((sql: string) =>
        sql.includes('scan_engine_status')
          ? Promise.reject('not an error object')
          : Promise.resolve([]),
      );

      const result = await service.read();

      expect(result.engine).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        '[readEngine] Source unavailable - Error: string',
      );
    });
  });

  describe('queue', () => {
    it('counts prioritised requests as waiting ones', async () => {
      const result = await service.read();

      expect(getJobCounts).toHaveBeenCalledWith(
        'waiting',
        'prioritized',
        'delayed',
        'active',
        'failed',
      );
      expect(result.queue).toEqual({
        waiting: 3,
        delayed: 4,
        active: 1,
        failed: 0,
      });
    });

    it('treats a state the queue did not report as none', async () => {
      getJobCounts.mockImplementationOnce(() => Promise.resolve({}));

      const result = await service.read();

      expect(result.queue).toEqual({
        waiting: 0,
        delayed: 0,
        active: 0,
        failed: 0,
      });
    });

    it('is null when Redis cannot be reached', async () => {
      getJobCounts.mockImplementationOnce(() =>
        Promise.reject(Object.assign(new Error('down'), { code: 42 })),
      );

      const result = await service.read();

      expect(result.queue).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        '[readQueue] Source unavailable - Error: Error',
      );
    });
  });

  describe('assets awaiting a verdict', () => {
    it('counts each waiting state, with zero for one that has none', async () => {
      const result = await service.read();

      expect(builder.where).toHaveBeenCalledWith(
        'asset.state IN (:...states)',
        {
          states: [
            FileAssetState.QUARANTINED,
            FileAssetState.SCANNING,
            FileAssetState.RETRY_PENDING,
          ],
        },
      );
      expect(result.awaiting).toEqual({
        quarantined: 0,
        scanning: 3,
        retryPending: 1,
      });
    });
  });

  it('stamps the figures with the moment they were read', async () => {
    const result = await service.read();

    expect(result.generatedAt).toEqual(NOW);
  });

  // FC-039: an admin sees why an asset was refused, and with what — the
  // code and the engine's versions — but never a signature name, which the
  // asset does not hold, nor anything else about the asset.
  describe('refused assets', () => {
    const REJECTED = {
      id: 'asset-1',
      kind: 'PROFILE_IMAGE',
      state: FileAssetState.REJECTED,
      rejectionCode: 'MALWARE_DETECTED',
      scanEngine: 'clamav',
      scanEngineVersion: '1.4.3',
      scanSignatureVersion: '27500',
      policyVersion: 3,
      createdAt: new Date('2026-09-26T10:00:00.000Z'),
      lastVerdictAt: new Date('2026-09-26T10:01:00.000Z'),
      ownerUserId: 'owner-1',
      objectKey: 'quarantine/asset-1',
      originalFilename: 'holiday.png',
    };
    const DETAIL = {
      id: 'asset-1',
      kind: 'PROFILE_IMAGE',
      state: FileAssetState.REJECTED,
      rejectionCode: 'MALWARE_DETECTED',
      scanEngine: 'clamav',
      scanEngineVersion: '1.4.3',
      scanSignatureVersion: '27500',
      policyVersion: 3,
      createdAt: REJECTED.createdAt,
      lastVerdictAt: REJECTED.lastVerdictAt,
    };

    it('reads one asset’s outcome and nothing else about it', async () => {
      findOne.mockResolvedValue(REJECTED);

      await expect(service.asset('asset-1')).resolves.toEqual(DETAIL);
      expect(findOne).toHaveBeenCalledWith({ where: { id: 'asset-1' } });
    });

    it('says when there is no such asset', async () => {
      await expect(service.asset('asset-9')).rejects.toThrow('Not found');
    });

    it('lists refused assets, newest verdict first, a page at a time', async () => {
      findAndCount.mockResolvedValue([[REJECTED], 26]);

      await expect(service.rejections(2)).resolves.toEqual({
        items: [DETAIL],
        total: 26,
        page: 2,
        pageSize: SCAN_REJECTION_PAGE_SIZE,
      });
      expect(findAndCount).toHaveBeenCalledWith({
        where: { state: FileAssetState.REJECTED },
        order: { lastVerdictAt: 'DESC', id: 'DESC' },
        skip: SCAN_REJECTION_PAGE_SIZE,
        take: SCAN_REJECTION_PAGE_SIZE,
      });
    });

    it('reads the first page when asked for none', async () => {
      await service.rejections();

      expect(findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0 }),
      );
    });
  });
});

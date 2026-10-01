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

import { SiteAdminActionEntity } from 'src/audit/site-admin/site-admin-action.entity';
import { SiteAdminActionKind } from 'src/audit/site-admin/site-admin-action.enum';
import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';
import { PublicationPauseDto } from 'src/file-assets/publication/publication-pause.dto';
import { PublicationPauseService } from 'src/file-assets/publication/publication-pause.service';
import { OperationsAlertEntity } from 'src/operations/alerts/operations-alert.entity';
import { OperationsAlertKind } from 'src/operations/alerts/operations-alert.enum';

import { ScanUsageWindowDto } from '../dto/scan-diagnostics.dto';
import {
  SCAN_REJECTION_PAGE_SIZE,
  ScanDiagnosticsService,
} from './scan-diagnostics.service';

const NOW = new Date('2026-09-26T12:00:00.000Z');

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';

/** One worker's heartbeat, as the query returns it. */
const HEARTBEAT_ROW = {
  workerId: 'worker-a',
  state: 'PAUSED',
  pauseReason: 'SIGNATURES_TOO_OLD',
  definitionsVersion: '27500',
  definitionsBuiltAt: new Date('2026-09-24T08:00:00.000Z'),
  jobsInHand: 0,
  startedAt: new Date('2026-09-26T09:00:00.000Z'),
  beatAt: new Date('2026-09-26T11:59:40.000Z'),
  pausedSince: new Date('2026-09-26T11:40:00.000Z'),
  secondsSinceBeat: 20.4,
  secondsPaused: 1_199.9,
  secondsSinceDefinitions: 187_380,
};

const PUBLICATION: PublicationPauseDto = {
  paused: false,
  pausedAt: null,
  pausedByUserId: null,
  pausedByUsername: null,
  queuePaused: false,
  held: 0,
};

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
  let insert: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  let findAlerts: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  let getRepository: jest.Mock<(entity: unknown) => unknown>;
  let readPublication: jest.Mock<() => Promise<PublicationPauseDto>>;
  let service: ScanDiagnosticsService;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

    query = jest.fn((sql: string) =>
      Promise.resolve(
        sql.includes('scan_usage')
          ? [usageRow('24h', 1), usageRow('7d', 2), usageRow('30d', 3)]
          : sql.includes('worker_heartbeat_status')
            ? [HEARTBEAT_ROW]
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

    insert = jest.fn(() => Promise.resolve(undefined));
    findAlerts = jest.fn(() => Promise.resolve([]));
    getRepository = jest.fn(() => ({ find: findAlerts }));
    readPublication = jest.fn(() => Promise.resolve(PUBLICATION));

    service = new ScanDiagnosticsService(
      {
        query,
        manager: { insert },
        getRepository,
      } as unknown as DataSource,
      { getJobCounts } as unknown as Queue,
      {
        createQueryBuilder: jest.fn(() => builder),
        findOne,
        findAndCount,
      } as unknown as Repository<FileAssetEntity>,
      { read: readPublication } as unknown as PublicationPauseService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    warn.mockRestore();
  });

  describe('usage', () => {
    it('reads the worker’s usage view in window order', async () => {
      const result = await service.read(ADMIN_ID);

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
      const result = await service.read(ADMIN_ID);

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

      const result = await service.read(ADMIN_ID);

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

      await service.read(ADMIN_ID);

      for (const [message] of warn.mock.calls) {
        expect(String(message)).not.toContain('secret statement text');
      }
      expect(warn).toHaveBeenCalledWith(
        '[readUsage] Source unavailable - Error: Error',
      );
    });
  });

  describe('engine status', () => {
    // FC-041: a rescan is deduplicated against the worker's signatures.
    it('reads the definition epoch, or the worker’s own unknown', async () => {
      await expect(service.currentDefinitionEpoch()).resolves.toBe('27500');

      query.mockResolvedValue([]);

      await expect(service.currentDefinitionEpoch()).resolves.toBe('unknown');

      query.mockResolvedValue([{ ...ENGINE_ROW, signatureVersion: null }]);

      await expect(service.currentDefinitionEpoch()).resolves.toBe('unknown');
    });

    it('reports the latest attempt’s engine and how old its signatures are', async () => {
      const result = await service.read(ADMIN_ID);

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

      const result = await service.read(ADMIN_ID);

      expect(result.engine?.signatureAgeHours).toBeNull();
    });

    it('is null when nothing has been scanned', async () => {
      query.mockImplementation(() => Promise.resolve([]));

      const result = await service.read(ADMIN_ID);

      expect(result.engine).toBeNull();
      expect(result.usage).toEqual([]);
    });

    it('is null when the view cannot be read', async () => {
      query.mockImplementation((sql: string) =>
        sql.includes('scan_engine_status')
          ? Promise.reject('not an error object')
          : Promise.resolve([]),
      );

      const result = await service.read(ADMIN_ID);

      expect(result.engine).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        '[readEngine] Source unavailable - Error: string',
      );
    });
  });

  describe('queue', () => {
    it('counts prioritised requests as waiting ones', async () => {
      const result = await service.read(ADMIN_ID);

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

      const result = await service.read(ADMIN_ID);

      expect(result.queue).toEqual({
        waiting: 0,
        delayed: 0,
        active: 0,
        failed: 0,
      });
    });

    // FC-042: BullMQ holds a command while Redis is down; the page must not.
    it('is null when Redis does not answer in time', async () => {
      getJobCounts.mockImplementationOnce(
        () => new Promise<Record<string, number>>(() => {}),
      );

      const reading = service.read(ADMIN_ID);

      await jest.advanceTimersByTimeAsync(5_000);

      const result = await reading;

      expect(result.queue).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        '[readQueue] Source unavailable - Error: RedisTimeoutError',
      );
    });

    it('is null when Redis cannot be reached', async () => {
      getJobCounts.mockImplementationOnce(() =>
        Promise.reject(Object.assign(new Error('down'), { code: 42 })),
      );

      const result = await service.read(ADMIN_ID);

      expect(result.queue).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        '[readQueue] Source unavailable - Error: Error',
      );
    });
  });

  describe('assets awaiting a verdict', () => {
    it('counts each waiting state, with zero for one that has none', async () => {
      const result = await service.read(ADMIN_ID);

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
    const result = await service.read(ADMIN_ID);

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

      await expect(service.asset('asset-1', ADMIN_ID)).resolves.toEqual(DETAIL);
      expect(findOne).toHaveBeenCalledWith({ where: { id: 'asset-1' } });
      // FC-042: every read is logged, naming the asset read.
      expect(insert).toHaveBeenCalledWith(
        SiteAdminActionEntity,
        expect.objectContaining({
          action: SiteAdminActionKind.SCAN_DIAGNOSTICS_VIEWED,
          actorUserId: ADMIN_ID,
          subjectKind: 'ASSET',
          subjectId: 'asset-1',
        }),
      );
    });

    it('says when there is no such asset, and logs nothing', async () => {
      await expect(service.asset('asset-9', ADMIN_ID)).rejects.toThrow(
        'Not found',
      );
      expect(insert).not.toHaveBeenCalled();
    });

    it('lists refused assets, newest verdict first, a page at a time', async () => {
      findAndCount.mockResolvedValue([[REJECTED], 26]);

      await expect(service.rejections(2, ADMIN_ID)).resolves.toEqual({
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
      expect(insert).toHaveBeenCalledWith(
        SiteAdminActionEntity,
        expect.objectContaining({
          action: SiteAdminActionKind.SCAN_DIAGNOSTICS_VIEWED,
          subjectKind: 'REJECTIONS',
          subjectId: 'ALL',
          reason: 'Read the refused assets on Scan Diagnostics',
          detail: { page: 2 },
        }),
      );
    });
  });

  // FC-042.
  describe('logging', () => {
    // The page reads the first page of refusals with the diagnostics each
    // time it opens; one entry stands for both.
    it('does not log the first page of refusals on its own', async () => {
      await service.rejections(1, ADMIN_ID);

      expect(insert).not.toHaveBeenCalled();
    });

    it('logs every read of the page', async () => {
      await service.read(ADMIN_ID);
      await service.read(ADMIN_ID);

      expect(insert).toHaveBeenCalledTimes(2);
      expect(insert).toHaveBeenCalledWith(SiteAdminActionEntity, {
        action: SiteAdminActionKind.SCAN_DIAGNOSTICS_VIEWED,
        actorUserId: ADMIN_ID,
        targetUserId: null,
        subjectKind: 'DIAGNOSTICS',
        subjectId: 'ALL',
        reason: 'Read Scan Diagnostics',
        detail: null,
        ipAddress: null,
      });
    });
  });

  // FC-042.
  describe('worker heartbeats', () => {
    it('reads every worker, with ages on the database’s clock', async () => {
      const result = await service.read(ADMIN_ID);

      const [sql] = query.mock.calls.find(([statement]) =>
        statement.includes('worker_heartbeat_status'),
      )!;

      expect(sql).toContain('EXTRACT(EPOCH FROM now() - h."beatAt")');
      expect(sql).toContain('ORDER BY h."beatAt" DESC');
      expect(result.workers).toEqual([
        {
          workerId: 'worker-a',
          state: 'PAUSED',
          pauseReason: 'SIGNATURES_TOO_OLD',
          definitionsVersion: '27500',
          definitionsBuiltAt: HEARTBEAT_ROW.definitionsBuiltAt,
          // 187,380 seconds is 52.05 hours.
          signatureAgeHours: 52.1,
          jobsInHand: 0,
          startedAt: HEARTBEAT_ROW.startedAt,
          beatAt: HEARTBEAT_ROW.beatAt,
          secondsSinceBeat: 20,
          live: true,
          pausedSince: HEARTBEAT_ROW.pausedSince,
          pausedMinutes: 19,
        },
      ]);
    });

    it('says a worker that has not beaten for two minutes is not live', async () => {
      query.mockImplementation((sql: string) =>
        Promise.resolve(
          sql.includes('worker_heartbeat_status')
            ? [
                {
                  ...HEARTBEAT_ROW,
                  state: 'RUNNING',
                  pauseReason: null,
                  pausedSince: null,
                  secondsPaused: null,
                  definitionsBuiltAt: null,
                  secondsSinceDefinitions: null,
                  secondsSinceBeat: 120.5,
                },
                // A clock a little ahead of the database's.
                {
                  ...HEARTBEAT_ROW,
                  workerId: 'worker-b',
                  secondsSinceBeat: -1,
                },
              ]
            : [],
        ),
      );

      const workers = await service.readHeartbeats();

      expect(workers?.[0]).toEqual(
        expect.objectContaining({
          live: false,
          secondsSinceBeat: 121,
          pausedMinutes: null,
          signatureAgeHours: null,
        }),
      );
      expect(workers?.[1]).toEqual(
        expect.objectContaining({ live: true, secondsSinceBeat: 0 }),
      );
    });

    it('is null, not an error, when the view cannot be read', async () => {
      query.mockImplementation((sql: string) =>
        sql.includes('worker_heartbeat_status')
          ? Promise.reject(
              Object.assign(new Error('permission denied'), { code: '42501' }),
            )
          : Promise.resolve([]),
      );

      const result = await service.read(ADMIN_ID);

      expect(result.workers).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        '[readHeartbeats] Source unavailable - Error: Error, Code: 42501',
      );
    });
  });

  // FC-042.
  describe('alerts and the publication pause', () => {
    it('shows the open alerts, oldest first, and the pause', async () => {
      const openedAt = new Date('2026-09-26T11:00:00.000Z');
      const lastSeenAt = new Date('2026-09-26T11:59:00.000Z');

      findAlerts.mockResolvedValue([
        {
          id: 'alert-1',
          kind: OperationsAlertKind.WORKER_PAUSED,
          openedAt,
          lastSeenAt,
          clearedAt: null,
          detail: { pausedWorkers: 1, pausedMinutes: 19 },
        },
      ]);

      const result = await service.read(ADMIN_ID);

      expect(getRepository).toHaveBeenCalledWith(OperationsAlertEntity);
      expect(findAlerts).toHaveBeenCalledWith({
        where: { clearedAt: expect.anything() },
        order: { openedAt: 'ASC' },
      });
      expect(result.alerts).toEqual([
        {
          kind: OperationsAlertKind.WORKER_PAUSED,
          openedAt,
          lastSeenAt,
          detail: { pausedWorkers: 1, pausedMinutes: 19 },
        },
      ]);
      expect(result.publication).toBe(PUBLICATION);
    });
  });
});

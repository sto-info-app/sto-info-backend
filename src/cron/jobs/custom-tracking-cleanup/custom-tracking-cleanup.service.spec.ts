import { Logger } from '@nestjs/common';

import { jest } from '@jest/globals';

import { CUSTOM_TRACKING_RETENTION_DAYS } from 'src/custom-tracking/constants/custom-tracking-retention.constants';
import {
  CustomTrackingObservabilityService,
  CustomTrackingPurgeSummary,
} from 'src/custom-tracking/observability/custom-tracking-observability.service';
import { CustomTrackingImageCleanupService } from 'src/custom-tracking/retention/custom-tracking-image-cleanup.service';
import { CustomTrackingPurgeService } from 'src/custom-tracking/retention/custom-tracking-purge.service';

import { CustomTrackingCleanupService } from './custom-tracking-cleanup.service';

describe('CustomTrackingCleanupService', () => {
  let service: CustomTrackingCleanupService;
  let purgeExpired: jest.Mock<
    (threshold: Date) => Promise<CustomTrackingPurgeSummary>
  >;
  let reconcile: jest.Mock<() => Promise<unknown>>;
  let retentionSwept: jest.Mock<(...args: unknown[]) => void>;

  const summary: CustomTrackingPurgeSummary = {
    sections: 1,
    tabs: 2,
    fields: 3,
    options: 0,
    values: 4,
    images: 1,
    retained: 1,
  };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    purgeExpired = jest.fn(async () => summary);
    reconcile = jest.fn(async () => undefined);
    retentionSwept = jest.fn();

    service = new CustomTrackingCleanupService(
      { purgeExpired } as unknown as CustomTrackingPurgeService,
      { reconcile } as unknown as CustomTrackingImageCleanupService,
      { retentionSwept } as unknown as CustomTrackingObservabilityService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('sweeps back to the published retention period', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-05T03:26:00.000Z'));

    await service.cleanup();

    const expected = new Date('2026-09-05T03:26:00.000Z');

    expected.setDate(expected.getDate() - CUSTOM_TRACKING_RETENTION_DAYS);

    expect(purgeExpired).toHaveBeenCalledWith(expected);

    jest.useRealTimers();
  });

  it('reports what the sweep removed', async () => {
    await service.cleanup();

    expect(retentionSwept).toHaveBeenCalledWith(summary);
  });

  // The sweep holds a transaction, so it queues pictures rather than deleting
  // them. Draining immediately afterwards is what turns that separation from a
  // delay into an implementation detail.
  it('deletes the pictures the sweep left behind, and only afterwards', async () => {
    await service.cleanup();

    expect(reconcile).toHaveBeenCalled();
    expect(purgeExpired.mock.invocationCallOrder[0]).toBeLessThan(
      reconcile.mock.invocationCallOrder[0],
    );
  });
});

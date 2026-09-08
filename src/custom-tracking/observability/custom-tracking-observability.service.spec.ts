import { Logger } from '@nestjs/common';

import { CustomTrackingFieldType } from '../enums/custom-tracking-field-type.enum';
import { CustomTrackingImageCleanupReason } from '../enums/custom-tracking-image-cleanup-reason.enum';
import { CustomTrackingObservabilityService } from './custom-tracking-observability.service';

describe('CustomTrackingObservabilityService', () => {
  let service: CustomTrackingObservabilityService;
  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;
  let error: jest.SpyInstance;

  const lastWarning = (): string => warn.mock.calls[0][0] as string;

  beforeEach(() => {
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    service = new CustomTrackingObservabilityService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // A hundred refusals a minute is only legible as abuse if you can see they
  // are all the same ceiling.
  it('names the ceiling a refusal ran into, and what it is', () => {
    service.limitReached('user-1', 'MAX_TABS_PER_SECTION', 12);

    expect(lastWarning()).toContain('MAX_TABS_PER_SECTION');
    expect(lastWarning()).toContain('Used: 12');
    expect(lastWarning()).toContain('UserId: user-1');
  });

  it('names the type of field whose answer was refused', () => {
    service.valueRefused(
      'user-1',
      'field-1',
      CustomTrackingFieldType.DATE_RANGE,
    );

    expect(lastWarning()).toContain('DATE_RANGE');
    expect(lastWarning()).toContain('FieldId: field-1');
  });

  it('records the class of an upload failure', () => {
    service.uploadRefused('user-1', 'field-1', 'BadRequestException');

    expect(lastWarning()).toContain('BadRequestException');
  });

  it('records a picture nothing will ever point at', () => {
    service.uploadAbandoned('image-1');

    expect(lastWarning()).toContain('image-1');
  });

  it('reports what the retention sweep removed', () => {
    service.retentionSwept({
      sections: 1,
      tabs: 2,
      fields: 3,
      options: 4,
      values: 5,
      images: 6,
      retained: 7,
    });

    expect(log.mock.calls[0][0]).toContain('Sections: 1');
    expect(log.mock.calls[0][0]).toContain('Retained: 7');
  });

  it('reports what the reconciliation pass did', () => {
    service.imagesReconciled({
      queued: 4,
      attempted: 4,
      deleted: 3,
      failed: 1,
    });

    expect(log.mock.calls[0][0]).toContain('Deleted: 3');
    expect(log.mock.calls[0][0]).toContain('Failed: 1');
  });

  // Ten consecutive failures means something retrying will not fix, and that
  // deserves a different level from a transient timeout.
  it('reports a stuck deletion as a fault rather than a warning', () => {
    service.imageCleanupStuck(
      'image-1',
      CustomTrackingImageCleanupReason.RETENTION,
      11,
    );

    expect(error).toHaveBeenCalled();
    expect(error.mock.calls[0][0]).toContain('Attempts: 11');
    expect(warn).not.toHaveBeenCalled();
  });
});

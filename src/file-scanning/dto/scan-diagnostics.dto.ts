import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** The windows the scan usage figures are reported over. */
export const SCAN_USAGE_WINDOWS = ['24h', '7d', '30d'] as const;

/** One of the windows the scan usage figures are reported over. */
export type ScanUsageWindow = (typeof SCAN_USAGE_WINDOWS)[number];

/**
 * What the scan worker did over one window.
 *
 * Read from the worker's `scan_usage` view, which carries totals only: no
 * asset, file, owner or signature name can be recovered from it.
 */
export class ScanUsageWindowDto {
  @ApiProperty({
    description: 'The window, ending now.',
    enum: SCAN_USAGE_WINDOWS,
  })
  window: ScanUsageWindow;

  @ApiProperty({ description: 'Scans of an asset for the first time.' })
  initialScans: number;

  @ApiProperty({
    description:
      'Scans of an asset scanned before, under newer signatures or policy, ' +
      'or as part of a campaign.',
  })
  rescans: number;

  @ApiProperty({ description: 'Scans that needed more than one claim.' })
  retriedScans: number;

  @ApiProperty({ description: 'Claims beyond the first, in total.' })
  retries: number;

  @ApiProperty({ description: 'Scans that found the file clean.' })
  clean: number;

  @ApiProperty({ description: 'Scans that found a match.' })
  infected: number;

  @ApiProperty({
    description: 'Archives, encrypted payloads or formats it could not open.',
  })
  unsupported: number;

  @ApiProperty({
    description: 'Files that were not what the upload said they were.',
  })
  contentTypeMismatch: number;

  @ApiProperty({ description: 'Files larger than the worker will read.' })
  tooLarge: number;

  @ApiProperty({
    description: 'Files whose bytes did not match the recorded hash.',
  })
  hashMismatch: number;

  @ApiProperty({ description: 'Files missing from quarantine.' })
  objectMissing: number;

  @ApiProperty({ description: 'Scans refused after every retry failed.' })
  retriesExhausted: number;

  @ApiProperty({ description: 'Scans that failed without a verdict.' })
  failed: number;

  @ApiProperty({ description: 'Scans still in progress.' })
  inProgress: number;

  @ApiPropertyOptional({
    description:
      'Median time from the scanner getting the bytes to its answer.',
    nullable: true,
  })
  scanMedianMs: number | null;

  @ApiPropertyOptional({
    description: '95th percentile of that time.',
    nullable: true,
  })
  scanP95Ms: number | null;

  @ApiPropertyOptional({ description: 'Longest of that time.', nullable: true })
  scanMaxMs: number | null;

  @ApiPropertyOptional({
    description: 'Median time from the request being queued to the answer.',
    nullable: true,
  })
  waitMedianMs: number | null;

  @ApiPropertyOptional({
    description: '95th percentile of that time.',
    nullable: true,
  })
  waitP95Ms: number | null;

  @ApiPropertyOptional({ description: 'Longest of that time.', nullable: true })
  waitMaxMs: number | null;
}

/** The scanner the latest attempt reported. */
export class ScanEngineStatusDto {
  @ApiProperty({ description: 'The scanner’s name.' })
  engine: string;

  @ApiPropertyOptional({
    description: 'Its version, or null when it did not say.',
    nullable: true,
  })
  engineVersion: string | null;

  @ApiPropertyOptional({
    description: 'Its signature database’s version, or null.',
    nullable: true,
  })
  signatureVersion: string | null;

  @ApiPropertyOptional({
    description: 'When the signature database was built, or null.',
    nullable: true,
  })
  definitionsBuiltAt: Date | null;

  @ApiPropertyOptional({
    description:
      'How old the signatures are now, in hours to one decimal place, or ' +
      'null when their build time is unknown.',
    nullable: true,
  })
  signatureAgeHours: number | null;

  @ApiProperty({ description: 'When the latest attempt reported this.' })
  reportedAt: Date;
}

/** Scan requests waiting on the worker, from the queue itself. */
export class ScanQueueDto {
  @ApiProperty({ description: 'Requests waiting to be picked up.' })
  waiting: number;

  @ApiProperty({
    description: 'Requests put back until the scanner is fit to judge.',
  })
  delayed: number;

  @ApiProperty({ description: 'Requests a worker is handling now.' })
  active: number;

  @ApiProperty({ description: 'Requests the queue gave up on.' })
  failed: number;
}

/** Assets the registry holds that have no final verdict yet. */
export class ScanAwaitingDto {
  @ApiProperty({ description: 'Stored in quarantine, not yet sent to scan.' })
  quarantined: number;

  @ApiProperty({ description: 'Sent to scan, with no verdict yet.' })
  scanning: number;

  @ApiProperty({ description: 'Waiting to be sent to scan again.' })
  retryPending: number;
}

/**
 * Everything the admin scan diagnostics page shows.
 *
 * Each part is read separately and is null when its source could not be
 * reached, so the page still shows what it can while something is down —
 * which is when it is most needed.
 */
export class ScanDiagnosticsDto {
  @ApiProperty({ description: 'When these figures were read.' })
  generatedAt: Date;

  @ApiPropertyOptional({
    description:
      'Usage over the last 24 hours, 7 days and 30 days, or null when the ' +
      'worker’s usage view could not be read.',
    type: [ScanUsageWindowDto],
    nullable: true,
  })
  usage: ScanUsageWindowDto[] | null;

  @ApiPropertyOptional({
    description:
      'The scanner the latest attempt reported, or null when nothing has ' +
      'been scanned or the view could not be read.',
    type: ScanEngineStatusDto,
    nullable: true,
  })
  engine: ScanEngineStatusDto | null;

  @ApiPropertyOptional({
    description: 'The scan request queue, or null when Redis is unreachable.',
    type: ScanQueueDto,
    nullable: true,
  })
  queue: ScanQueueDto | null;

  @ApiProperty({
    description: 'Assets the registry holds that have no final verdict yet.',
    type: ScanAwaitingDto,
  })
  awaiting: ScanAwaitingDto;
}

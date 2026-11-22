import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';

import { AdminReasonDto } from 'src/shared/dto/admin-reason.dto';

import { FAILED_JOB_QUEUES, FailedJobQueue } from './failed-job.constants';

/** Which failed jobs a site admin asks for. */
export class FailedJobsQueryDto {
  @ApiPropertyOptional({
    enum: FAILED_JOB_QUEUES,
    description: 'One queue only; every queue when left out.',
  })
  @IsOptional()
  @IsIn(FAILED_JOB_QUEUES)
  readonly queue?: FailedJobQueue;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page?: number;
}

/**
 * A site admin retrying every failed job, or one queue's — or discarding
 * every one a retry cannot help — with why.
 */
export class RetryAllFailedJobsDto extends AdminReasonDto {
  @ApiPropertyOptional({
    enum: FAILED_JOB_QUEUES,
    description: 'One queue only; every queue when left out.',
  })
  @IsOptional()
  @IsIn(FAILED_JOB_QUEUES)
  readonly queue?: FailedJobQueue;
}

/**
 * One job a queue gave up on (FC-042). Internal IDs and codes only: never
 * the job's data, and never the text of the error, which can quote a
 * statement's values or name a host.
 */
export class FailedJobDto {
  @ApiProperty({ enum: FAILED_JOB_QUEUES })
  queue: FailedJobQueue;

  @ApiProperty() jobId: string;

  @ApiProperty({ description: 'The kind of job.' })
  name: string;

  @ApiProperty({ description: 'How many times it was tried.' })
  attemptsMade: number;

  @ApiPropertyOptional({ nullable: true, type: Date })
  failedAt: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'What it was for: FILE_ASSET, CHAT_TRANSCRIPT or FLEET.',
  })
  subjectKind: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  subjectId: string | null;

  @ApiProperty({
    description:
      'Why it failed, as a code: a network error’s code (ECONNREFUSED), ' +
      'HTTP_<status>, TIMEOUT, STALLED, the thrown error’s class name, or ' +
      'UNKNOWN.',
  })
  reason: string;

  @ApiProperty({
    description:
      'Whether retrying it could change anything. A retry of one that ' +
      'cannot is refused; it can be discarded instead, singly or with ' +
      '"Discard unretryable". Any failed job can be discarded singly.',
  })
  retryable: boolean;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'Why a retry would change nothing: SETTLED (what it was for has ' +
      'moved on) or NO_SUBJECT (it names nothing).',
  })
  notRetryableBecause: string | null;
}

/** A page of failed jobs, queue by queue, newest failure first in each. */
export class FailedJobPageDto {
  @ApiProperty({ type: [FailedJobDto] })
  items: FailedJobDto[];

  @ApiProperty({ description: 'Failed jobs in every queue asked for.' })
  total: number;

  @ApiProperty() page: number;

  @ApiProperty() pageSize: number;

  @ApiProperty({
    description:
      'Failed jobs in each queue asked for; null for one Redis did not ' +
      'answer for within 5 seconds. When none answers, the list is a 503 ' +
      'rather than an empty page.',
    type: 'object',
    additionalProperties: { type: 'number', nullable: true },
  })
  counts: Record<string, number | null>;
}

/** What one queue's part of a "Retry all" came to. */
export class RetryAllQueueResultDto {
  @ApiProperty() retried: number;

  @ApiProperty({ description: 'Left alone, because a retry would not help.' })
  skipped: number;
}

/** What a "Retry all" came to. */
export class RetryAllResultDto {
  @ApiProperty() retried: number;

  @ApiProperty({ description: 'Left alone, because a retry would not help.' })
  skipped: number;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description:
      'Failed jobs still in the queues asked for, or null when Redis did ' +
      'not answer. More than were skipped means the run stopped at its limit.',
  })
  remaining: number | null;

  @ApiProperty({
    description: 'Retried and skipped, queue by queue.',
    type: 'object',
    additionalProperties: {
      type: 'object',
      properties: {
        retried: { type: 'number' },
        skipped: { type: 'number' },
      },
    },
  })
  byQueue: Record<string, RetryAllQueueResultDto>;
}

/** What one queue's part of a "Discard unretryable" came to. */
export class DiscardQueueResultDto {
  @ApiProperty() discarded: number;

  @ApiProperty({ description: 'Kept, because a retry could still help.' })
  kept: number;
}

/** What a "Discard unretryable" came to. */
export class DiscardUnretryableResultDto {
  @ApiProperty() discarded: number;

  @ApiProperty({ description: 'Kept, because a retry could still help.' })
  kept: number;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description:
      'Failed jobs still in the queues asked for, or null when Redis did ' +
      'not answer. More than were kept means the run stopped at its limit.',
  })
  remaining: number | null;

  @ApiProperty({
    description: 'Discarded and kept, queue by queue.',
    type: 'object',
    additionalProperties: {
      type: 'object',
      properties: {
        discarded: { type: 'number' },
        kept: { type: 'number' },
      },
    },
  })
  byQueue: Record<string, DiscardQueueResultDto>;
}

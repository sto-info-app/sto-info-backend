import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { Roles } from 'src/auth/roles.decorator';
import { RolesGuard } from 'src/auth/roles.guard';
import { UserId } from 'src/auth/user-id.decorator';
import { AdminReasonDto } from 'src/shared/dto/admin-reason.dto';
import { UserRole } from 'src/user/enums/user-role.enum';

import { FAILED_JOB_QUEUES, FailedJobQueue } from './failed-job.constants';
import {
  DiscardUnretryableResultDto,
  FailedJobPageDto,
  FailedJobsQueryDto,
  RetryAllFailedJobsDto,
  RetryAllResultDto,
} from './failed-jobs.dto';
import { FailedJobsService } from './failed-jobs.service';

/** The queues, as an enum-like object for `ParseEnumPipe`. */
const QUEUES = Object.fromEntries(
  FAILED_JOB_QUEUES.map(queue => [queue, queue]),
) as Record<FailedJobQueue, FailedJobQueue>;

/**
 * The site admins' failed jobs (FC-042), on Scan Diagnostics: every job a
 * queue gave up on, with "Retry", "Retry all", "Discard" and "Discard
 * unretryable", each taking a reason for the site admin log. IDs and codes
 * only; every read is logged.
 */
@ApiTags('File scanning (admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiForbiddenResponse({ description: 'The caller is not an administrator.' })
@ApiServiceUnavailableResponse({
  description:
    'Redis cannot be reached, or does not answer within 5 seconds: "The job ' +
    'queues cannot be reached." A "Retry all" or "Discard unretryable" it ' +
    'interrupts part way logs what it did first, and says so.',
})
@Controller('admin/file-scanning/failed-jobs')
export class FailedJobsController {
  /**
   * Creates an instance of FailedJobsController.
   *
   * @param _failedJobs - The failed jobs.
   */
  constructor(private readonly _failedJobs: FailedJobsService) {}

  /**
   * A page of failed jobs.
   *
   * @param adminUserId - The site admin reading them.
   * @param query - Which queue and page.
   * @returns The page.
   */
  @Get()
  @ApiOperation({ summary: 'List failed background jobs (admin)' })
  @ApiOkResponse({ type: FailedJobPageDto })
  list(
    @UserId() adminUserId: string,
    @Query() query: FailedJobsQueryDto,
  ): Promise<FailedJobPageDto> {
    return this._failedJobs.list(query.queue, query.page ?? 1, adminUserId);
  }

  /**
   * Retries every failed job a retry can help.
   *
   * @param adminUserId - The site admin.
   * @param dto - Which queue, and why.
   * @returns What was retried and what was left alone.
   */
  @Post('retry-all')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Retry every failed job a retry can help, with a reason (admin)',
  })
  @ApiOkResponse({ type: RetryAllResultDto })
  retryAll(
    @UserId() adminUserId: string,
    @Body() dto: RetryAllFailedJobsDto,
  ): Promise<RetryAllResultDto> {
    return this._failedJobs.retryAll(dto.queue, adminUserId, dto.reason);
  }

  /**
   * Discards every failed job a retry cannot help.
   *
   * @param adminUserId - The site admin.
   * @param dto - Which queue, and why.
   * @returns What was discarded and what was kept.
   */
  @Post('discard-unretryable')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Discard every failed job a retry cannot help, with a reason (admin)',
  })
  @ApiOkResponse({ type: DiscardUnretryableResultDto })
  discardUnretryable(
    @UserId() adminUserId: string,
    @Body() dto: RetryAllFailedJobsDto,
  ): Promise<DiscardUnretryableResultDto> {
    return this._failedJobs.discardUnretryable(
      dto.queue,
      adminUserId,
      dto.reason,
    );
  }

  /**
   * Retries one failed job.
   *
   * @param queue - Its queue.
   * @param jobId - The job.
   * @param adminUserId - The site admin.
   * @param dto - Why.
   */
  @Post(':queue/:jobId/retry')
  @HttpCode(204)
  @ApiOperation({ summary: 'Retry one failed job, with a reason (admin)' })
  @ApiParam({ name: 'queue', enum: FAILED_JOB_QUEUES })
  @ApiNoContentResponse({ description: 'Sent round again, and logged.' })
  @ApiNotFoundResponse({ description: 'The queue holds no such job.' })
  @ApiConflictResponse({
    description:
      'It has not failed, a retry would change nothing (the message says ' +
      'why), or somebody retried it first.',
  })
  async retry(
    @Param('queue', new ParseEnumPipe(QUEUES)) queue: FailedJobQueue,
    @Param('jobId') jobId: string,
    @UserId() adminUserId: string,
    @Body() dto: AdminReasonDto,
  ): Promise<void> {
    await this._failedJobs.retry(queue, jobId, adminUserId, dto.reason);
  }

  /**
   * Discards one failed job, whether or not a retry could help it.
   *
   * @param queue - Its queue.
   * @param jobId - The job.
   * @param adminUserId - The site admin.
   * @param dto - Why.
   */
  @Post(':queue/:jobId/discard')
  @HttpCode(204)
  @ApiOperation({ summary: 'Discard one failed job, with a reason (admin)' })
  @ApiParam({ name: 'queue', enum: FAILED_JOB_QUEUES })
  @ApiNoContentResponse({ description: 'Removed from its queue, and logged.' })
  @ApiNotFoundResponse({ description: 'The queue holds no such job.' })
  @ApiConflictResponse({
    description:
      'It has not failed, or somebody retried or discarded it first.',
  })
  async discard(
    @Param('queue', new ParseEnumPipe(QUEUES)) queue: FailedJobQueue,
    @Param('jobId') jobId: string,
    @UserId() adminUserId: string,
    @Body() dto: AdminReasonDto,
  ): Promise<void> {
    await this._failedJobs.discard(queue, jobId, adminUserId, dto.reason);
  }
}

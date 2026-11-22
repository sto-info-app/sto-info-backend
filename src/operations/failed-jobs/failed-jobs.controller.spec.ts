import { BadRequestException, ParseEnumPipe } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { ROLES_KEY } from 'src/auth/roles.decorator';
import { UserRole } from 'src/user/enums/user-role.enum';

import { FailedJobQueue } from './failed-job.constants';
import { FailedJobsController } from './failed-jobs.controller';
import {
  DiscardUnretryableResultDto,
  FailedJobPageDto,
  RetryAllResultDto,
} from './failed-jobs.dto';
import { FailedJobsService } from './failed-jobs.service';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';

describe('FailedJobsController', () => {
  let list: jest.Mock<
    (
      queue: FailedJobQueue | undefined,
      page: number,
      adminUserId: string,
    ) => Promise<FailedJobPageDto>
  >;
  let retry: jest.Mock<
    (
      queue: FailedJobQueue,
      jobId: string,
      adminUserId: string,
      reason: string,
    ) => Promise<void>
  >;
  let retryAll: jest.Mock<
    (
      queue: FailedJobQueue | undefined,
      adminUserId: string,
      reason: string,
    ) => Promise<RetryAllResultDto>
  >;
  let discard: jest.Mock<
    (
      queue: FailedJobQueue,
      jobId: string,
      adminUserId: string,
      reason: string,
    ) => Promise<void>
  >;
  let discardUnretryable: jest.Mock<
    (
      queue: FailedJobQueue | undefined,
      adminUserId: string,
      reason: string,
    ) => Promise<DiscardUnretryableResultDto>
  >;
  let controller: FailedJobsController;

  beforeEach(() => {
    list = jest.fn(() =>
      Promise.resolve('page' as unknown as FailedJobPageDto),
    );
    retry = jest.fn(() => Promise.resolve());
    retryAll = jest.fn(() =>
      Promise.resolve('result' as unknown as RetryAllResultDto),
    );
    discard = jest.fn(() => Promise.resolve());
    discardUnretryable = jest.fn(() =>
      Promise.resolve('discarded' as unknown as DiscardUnretryableResultDto),
    );
    controller = new FailedJobsController({
      list,
      retry,
      retryAll,
      discard,
      discardUnretryable,
    } as unknown as FailedJobsService);
  });

  it('lists a page of one queue, or every queue from the first page', async () => {
    await expect(
      controller.list(ADMIN_ID, { queue: 'file-scan', page: 2 }),
    ).resolves.toBe('page');
    expect(list).toHaveBeenCalledWith('file-scan', 2, ADMIN_ID);

    await controller.list(ADMIN_ID, {});
    expect(list).toHaveBeenCalledWith(undefined, 1, ADMIN_ID);
  });

  it('retries one job, with the site admin’s reason', async () => {
    await controller.retry('chat-transcript', '42', ADMIN_ID, {
      reason: 'Storage was down',
    });

    expect(retry).toHaveBeenCalledWith(
      'chat-transcript',
      '42',
      ADMIN_ID,
      'Storage was down',
    );
  });

  it('retries every job a retry can help, with the site admin’s reason', async () => {
    await expect(
      controller.retryAll(ADMIN_ID, { queue: 'file-scan', reason: 'Why' }),
    ).resolves.toBe('result');
    expect(retryAll).toHaveBeenCalledWith('file-scan', ADMIN_ID, 'Why');
  });

  it('discards one job, with the site admin’s reason', async () => {
    await controller.discard('file-scan', '7', ADMIN_ID, { reason: 'Gone' });

    expect(discard).toHaveBeenCalledWith('file-scan', '7', ADMIN_ID, 'Gone');
  });

  it('discards every job a retry cannot help, with the site admin’s reason', async () => {
    await expect(
      controller.discardUnretryable(ADMIN_ID, { reason: 'Tidy' }),
    ).resolves.toBe('discarded');
    expect(discardUnretryable).toHaveBeenCalledWith(
      undefined,
      ADMIN_ID,
      'Tidy',
    );
  });

  it('accepts only a queue that keeps its failures', async () => {
    const args = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      FailedJobsController,
      'retry',
    ) as Record<string, { data: string; pipes: unknown[] }>;
    const [pipe] = Object.values(args).find(arg => arg.data === 'queue')!
      .pipes as ParseEnumPipe[];

    await expect(
      pipe.transform('file-asset-publication', { type: 'param' }),
    ).resolves.toBe('file-asset-publication');
    await expect(
      pipe.transform('image-estate', { type: 'param' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('is for administrators only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, FailedJobsController)).toEqual([
      UserRole.ADMIN,
    ]);
  });
});

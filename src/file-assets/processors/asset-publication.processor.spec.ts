import { Logger } from '@nestjs/common';

import { jest } from '@jest/globals';
import { DelayedError, Job } from 'bullmq';

import { PUBLICATION_PAUSED_RECHECK_MS } from '../constants/file-asset-publication.constants';
import { PublicationPauseService } from '../publication/publication-pause.service';
import { AssetPublicationService } from '../services/asset-publication.service';
import { AssetPublicationProcessor } from './asset-publication.processor';

/**
 * Builds a job carrying whatever body the test wants.
 *
 * @param data - The body.
 * @returns The job.
 */
const job = (data: unknown): Job<unknown> =>
  ({ id: 'job-1', data }) as Job<unknown>;

describe('AssetPublicationProcessor', () => {
  let publish: jest.Mock<(...args: any[]) => Promise<any>>;
  let isPaused: jest.Mock<() => Promise<boolean>>;
  let apply: jest.Mock<(trigger: string) => Promise<boolean | null>>;
  let processor: AssetPublicationProcessor;

  beforeEach(() => {
    publish = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue({ published: true, refusal: null });
    isPaused = jest.fn<() => Promise<boolean>>().mockResolvedValue(false);
    apply = jest
      .fn<(trigger: string) => Promise<boolean | null>>()
      .mockResolvedValue(true);

    processor = new AssetPublicationProcessor(
      { publish } as unknown as AssetPublicationService,
      { isPaused, apply } as unknown as PublicationPauseService,
    );

    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('publishes the asset the job names', async () => {
    await processor.process(job({ assetId: 'asset-1' }));

    expect(publish).toHaveBeenCalledWith('asset-1');
  });

  // A job without an asset identifier will not grow one on the next
  // attempt, so it is dropped rather than retried.
  it.each([
    ['nothing at all', null],
    ['a string', 'asset-1'],
    ['no asset', {}],
    ['an asset that is not text', { assetId: 42 }],
    ['an empty asset', { assetId: '' }],
  ])('drops a job carrying %s', async (_name, data) => {
    await processor.process(job(data));

    expect(publish).not.toHaveBeenCalled();
  });

  // The usual reason publication fails is that Cloudflare Images did not
  // answer, which is exactly the kind of thing that works five minutes
  // later — so the job has to be retried rather than swallowed.
  // FC-042: the switch in the database is the authority, so a job that
  // reaches the processor while it is on publishes nothing and goes back.
  it('puts a job back, unharmed, while publication is paused', async () => {
    jest.useFakeTimers({ now: new Date('2026-09-30T12:00:00.000Z') });
    isPaused.mockResolvedValue(true);
    const moveToDelayed = jest
      .fn<(timestamp: number, token?: string) => Promise<void>>()
      .mockResolvedValue(undefined);
    const paused = {
      id: 'job-1',
      data: { assetId: 'asset-1' },
      moveToDelayed,
    } as unknown as Job<unknown>;

    try {
      await expect(processor.process(paused, 'token-1')).rejects.toThrow(
        DelayedError,
      );
    } finally {
      jest.useRealTimers();
    }

    expect(publish).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalledWith('processor');
    expect(moveToDelayed).toHaveBeenCalledWith(
      new Date('2026-09-30T12:00:00.000Z').getTime() +
        PUBLICATION_PAUSED_RECHECK_MS,
      'token-1',
    );
  });

  it('lets a failure through so BullMQ retries it', async () => {
    publish.mockRejectedValue(new Error('Cloudflare said no'));

    await expect(
      processor.process(job({ assetId: 'asset-1' })),
    ).rejects.toThrow('Cloudflare said no');
  });
});

import { Logger } from '@nestjs/common';

import { jest } from '@jest/globals';
import { Job } from 'bullmq';

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
  let processor: AssetPublicationProcessor;

  beforeEach(() => {
    publish = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue({ published: true, refusal: null });

    processor = new AssetPublicationProcessor({
      publish,
    } as unknown as AssetPublicationService);

    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
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
  it('lets a failure through so BullMQ retries it', async () => {
    publish.mockRejectedValue(new Error('Cloudflare said no'));

    await expect(
      processor.process(job({ assetId: 'asset-1' })),
    ).rejects.toThrow('Cloudflare said no');
  });
});

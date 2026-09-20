import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Job } from 'bullmq';

import { AssetPublicationQueueService } from 'src/file-assets/services/asset-publication-queue.service';

import { ScanVerdictService } from '../services/scan-verdict.service';
import { ScanVerdictProcessor } from './scan-verdict.processor';

const FIXTURE = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '..',
      'contract',
      '__fixtures__',
      'file-scan-contract-v2.json',
    ),
    'utf8',
  ),
);

/**
 * Builds a job carrying whatever body the test wants.
 *
 * @param data - The body.
 * @returns The job.
 */
function job(data: unknown): Job<unknown> {
  return { id: 'job-1', data } as Job<unknown>;
}

describe('ScanVerdictProcessor', () => {
  let apply: jest.Mock;
  let enqueue: jest.Mock;
  let processor: ScanVerdictProcessor;

  beforeEach(() => {
    apply = jest.fn(() => Promise.resolve({ applied: true, refusal: null }));
    enqueue = jest.fn(() => Promise.resolve());

    processor = new ScanVerdictProcessor(
      { apply } as unknown as ScanVerdictService,
      { enqueue } as unknown as AssetPublicationQueueService,
    );
  });

  it('hands a well-formed verdict on', async () => {
    await processor.process(job(FIXTURE.verdicts.clean));

    expect(apply).toHaveBeenCalledWith(FIXTURE.verdicts.clean);
  });

  it('parses the message before it touches a single field', async () => {
    // The worker is trusted to run a scanner, not to send well-formed
    // messages. A clean verdict with no observed hash is the one this
    // catches, and it is the one that would matter.
    await processor.process(
      job({ ...FIXTURE.verdicts.clean, observedSha256: null }),
    );

    expect(apply).not.toHaveBeenCalled();
  });

  it('drops a message that violates the contract rather than retrying it', async () => {
    await processor.process(job({ schemaVersion: 1, assetId: 'nope' }));

    expect(apply).not.toHaveBeenCalled();
  });

  it('lets a failure that is not a contract violation through', async () => {
    const exploding = {
      get schemaVersion(): number {
        throw new TypeError('something unexpected');
      },
    };

    await expect(processor.process(job(exploding))).rejects.toThrow(
      'something unexpected',
    );
  });

  it('lets a failure to apply the verdict through so the job stays visible', async () => {
    apply.mockImplementationOnce(() =>
      Promise.reject(new Error('no database')),
    );

    await expect(
      processor.process(job(FIXTURE.verdicts.clean)),
    ).rejects.toThrow('no database');
  });

  it('asks for a cleared asset to be published', async () => {
    await processor.process(job(FIXTURE.verdicts.clean));

    expect(enqueue).toHaveBeenCalledWith(FIXTURE.verdicts.clean.assetId);
  });

  it('does not ask for a refused asset to be published', async () => {
    await processor.process(job(FIXTURE.verdicts.rejected));

    expect(enqueue).not.toHaveBeenCalled();
  });

  it('does not ask for publication when the verdict was not applied', async () => {
    // A verdict that lost a race with a second one, or that arrived after
    // the asset had moved on. The registry did not move, so there is
    // nothing to publish.
    apply.mockImplementationOnce(() =>
      Promise.resolve({ applied: false, refusal: 'NOT_SCANNING' }),
    );

    await processor.process(job(FIXTURE.verdicts.clean));

    expect(enqueue).not.toHaveBeenCalled();
  });
});

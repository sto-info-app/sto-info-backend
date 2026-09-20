import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Job } from 'bullmq';

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
  let processor: ScanVerdictProcessor;

  beforeEach(() => {
    apply = jest.fn(() => Promise.resolve({ applied: true, refusal: null }));

    processor = new ScanVerdictProcessor({
      apply,
    } as unknown as ScanVerdictService);
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
});

import { Logger } from '@nestjs/common';

import { Job } from 'bullmq';

import { ChatTranscriptProcessor } from './chat-transcript.processor';
import { ChatTranscriptService } from './chat-transcript.service';

describe('ChatTranscriptProcessor', () => {
  let transcripts: { process: jest.Mock };
  let processor: ChatTranscriptProcessor;
  let error: jest.SpyInstance;

  const job = (data: unknown): Job<unknown> =>
    ({ id: 'job-1', data }) as unknown as Job<unknown>;

  beforeEach(() => {
    transcripts = { process: jest.fn(() => Promise.resolve()) };
    processor = new ChatTranscriptProcessor(
      transcripts as unknown as ChatTranscriptService,
    );
    error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('writes the transcript the job names', async () => {
    await processor.process(job({ transcriptId: 'transcript-1' }));

    expect(transcripts.process).toHaveBeenCalledWith('transcript-1');
  });

  it.each([
    ['no payload', null],
    ['a payload that is not an object', 'transcript-1'],
    ['no transcript', {}],
    ['a transcript that is not a string', { transcriptId: 7 }],
    ['an empty transcript', { transcriptId: '' }],
  ])('drops a job with %s rather than retrying it', async (_case, data) => {
    await expect(processor.process(job(data))).resolves.toBeUndefined();

    expect(transcripts.process).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      '[process] Transcript job rejected - JobId: job-1',
    );
  });

  it('rethrows a failure, so the job is retried', async () => {
    transcripts.process.mockRejectedValue(new Error('R2 is down'));

    await expect(
      processor.process(job({ transcriptId: 'transcript-1' })),
    ).rejects.toThrow('R2 is down');
  });
});

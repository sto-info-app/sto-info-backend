import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';

import { Job } from 'bullmq';

import { CHAT_TRANSCRIPT_QUEUE } from './chat-transcript.constants';
import { ChatTranscriptService } from './chat-transcript.service';

/**
 * Writes a transcript when asked (FC-035).
 *
 * Thin, like the roster replay's: the job carries the transcript's ID and
 * nothing else, and everything about it is read from its row when the job
 * runs. A malformed job is dropped; anything else is rethrown so BullMQ
 * retries, which is safe, since only a transcript still waiting is written.
 */
@Processor(CHAT_TRANSCRIPT_QUEUE)
export class ChatTranscriptProcessor extends WorkerHost {
  private readonly _logger = new Logger(ChatTranscriptProcessor.name);

  /**
   * Creates an instance of ChatTranscriptProcessor.
   *
   * @param _transcripts - What writes a transcript.
   */
  constructor(private readonly _transcripts: ChatTranscriptService) {
    super();
  }

  /**
   * Handles one job.
   *
   * @param job - The job.
   */
  async process(job: Job<unknown>): Promise<void> {
    const data = job.data as { transcriptId?: unknown } | null;
    const transcriptId =
      typeof data === 'object' && data !== null ? data.transcriptId : null;

    if (typeof transcriptId !== 'string' || transcriptId.length === 0) {
      this._logger.error(
        `[process] Transcript job rejected - JobId: ${job.id}`,
      );

      return;
    }

    await this._transcripts.process(transcriptId);
  }
}

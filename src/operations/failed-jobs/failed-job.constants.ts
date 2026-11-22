import { FILE_ASSET_PUBLICATION_QUEUE } from 'src/file-assets/constants/file-asset-publication.constants';
import {
  FILE_SCAN_REQUEST_QUEUE,
  FILE_SCAN_VERDICT_QUEUE,
} from 'src/file-scanning/contract/file-scan-contract';
import { CHAT_TRANSCRIPT_QUEUE } from 'src/fleet/chat/transcripts/chat-transcript.constants';
import { ROSTER_REPLAY_QUEUE } from 'src/fleet/projection/constants/roster-replay.constants';

/**
 * The queues whose failed jobs a site admin can see and retry (FC-042):
 * every queue this application registers that keeps a job once it has run
 * out of attempts (`removeOnFail: false`).
 *
 * Two are left out because they keep nothing to retry: `image-estate`
 * (FC-040) and `file-rescan` (FC-041) drop a failed job
 * (`removeOnFail: true`), since each run records its own failures and is
 * resumed from its page.
 */
export const FAILED_JOB_QUEUES = [
  FILE_SCAN_REQUEST_QUEUE,
  FILE_SCAN_VERDICT_QUEUE,
  FILE_ASSET_PUBLICATION_QUEUE,
  CHAT_TRANSCRIPT_QUEUE,
  ROSTER_REPLAY_QUEUE,
] as const;

/** A queue whose failed jobs a site admin can see and retry. */
export type FailedJobQueue = (typeof FAILED_JOB_QUEUES)[number];

/** How many failed jobs a page lists. */
export const FAILED_JOB_PAGE_SIZE = 25;

/**
 * The most failed jobs one "Retry all" looks at, so a very long failed set
 * takes several presses rather than one request that never answers.
 */
export const FAILED_JOB_RETRY_ALL_LIMIT = 500;

/**
 * The network failures a failure reason is reduced to by name. Anything
 * else is reduced to the name of the error class that was thrown.
 */
export const NETWORK_FAILURE_CODES = [
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
] as const;

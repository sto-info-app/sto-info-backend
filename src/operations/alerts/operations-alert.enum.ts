/**
 * A problem the operations alert cron watches for (FC-042).
 *
 * One alert per problem until it clears: every site admin is told once when
 * it opens and once when it clears. Each threshold is a named constant in
 * `operations-alert.constants.ts`, fixed in code by Steve's choice.
 */
export enum OperationsAlertKind {
  /** An upload has waited too long on the scan queue. */
  SCAN_QUEUE_LAG = 'SCAN_QUEUE_LAG',
  /** A cleared upload has waited too long to be published. */
  PUBLICATION_QUEUE_LAG = 'PUBLICATION_QUEUE_LAG',
  /** No scan worker has reported lately, or its heartbeat cannot be read. */
  WORKER_SILENT = 'WORKER_SILENT',
  /** Every live scan worker has been paused for too long. */
  WORKER_PAUSED = 'WORKER_PAUSED',
  /** The newest signatures any live worker holds are old. */
  SIGNATURES_STALE = 'SIGNATURES_STALE',
  /** A background job has failed and is waiting for a site admin. */
  FAILED_JOBS = 'FAILED_JOBS',
  /** Publication has been paused for too long. */
  PUBLICATION_PAUSED_LONG = 'PUBLICATION_PAUSED_LONG',
  /** Redis, which carries every queue, has not answered for too long. */
  QUEUES_UNREACHABLE = 'QUEUES_UNREACHABLE',
  /**
   * A withdrawn picture's public copy has gone undeleted for too long
   * (FC-043).
   */
  PURGE_OWED = 'PURGE_OWED',
}

/**
 * A reader's relationship with a Story.
 *
 * `IN_PROGRESS` and `COMPLETED` are derived from Chapter progress, while
 * `ON_HOLD` and `ABANDONED` are set deliberately by the reader. Automatic
 * transitions never overwrite a deliberate choice, with one agreed exception:
 * a Story the reader had completed returns to `IN_PROGRESS` when a new Chapter
 * is published.
 */
export enum ReaderStoryStatus {
  /** No Chapter activity recorded. */
  NOT_STARTED = 'NOT_STARTED',
  /** At least one Chapter has been meaningfully read. */
  IN_PROGRESS = 'IN_PROGRESS',
  /** Every currently published readable Chapter has been read. */
  COMPLETED = 'COMPLETED',
  /** Deliberately paused by the reader. */
  ON_HOLD = 'ON_HOLD',
  /** Deliberately given up by the reader. */
  ABANDONED = 'ABANDONED',
}

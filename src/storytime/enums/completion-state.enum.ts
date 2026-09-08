/**
 * How far through a Story its creator considers the whole work to be.
 *
 * This is the creator's statement about the Story, not a reader's progress
 * through it. Reader progress is {@link ReaderStoryStatus}.
 */
export enum CompletionState {
  /** More Chapters are intended. */
  ONGOING = 'ONGOING',
  /** The creator considers the Story finished. */
  COMPLETED = 'COMPLETED',
  /** Paused, with the intention of resuming. */
  HIATUS = 'HIATUS',
  /** Abandoned by the creator and will not be finished. */
  CANCELLED = 'CANCELLED',
}

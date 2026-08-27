/**
 * A reader's relationship with a single Chapter.
 *
 * Opening a Chapter is not enough to leave {@link ReaderChapterStatus.UNREAD}.
 * Progress begins only after a meaningful reading interaction, so that merely
 * following a link does not silently mark content read.
 */
export enum ReaderChapterStatus {
  /** Not started, or explicitly marked unread again. */
  UNREAD = 'UNREAD',
  /** Meaningful reading activity recorded, but not finished. */
  IN_PROGRESS = 'IN_PROGRESS',
  /** Finished. */
  READ = 'READ',
}

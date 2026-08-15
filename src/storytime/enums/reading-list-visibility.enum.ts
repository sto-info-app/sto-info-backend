/**
 * Who may see a reader's list.
 *
 * Public lists follow the same profile privacy conventions as public accounts
 * and characters elsewhere in the application.
 */
export enum ReadingListVisibility {
  /** Visible only to the reader who owns it. */
  PRIVATE = 'PRIVATE',
  /** Visible to anyone who can see the owner's profile. */
  PUBLIC = 'PUBLIC',
}

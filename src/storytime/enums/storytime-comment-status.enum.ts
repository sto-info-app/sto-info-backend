/**
 * Whether a comment is shown, and who stopped it being shown.
 *
 * Four states rather than a boolean, because who silenced a comment matters:
 * an author who thought better of it, an owner tidying their own Story, and an
 * administrator enforcing the content policy are three different events, and
 * only the last is a moderation record.
 *
 * A silenced comment keeps its row either way. Deleting it outright would take
 * the replies with it and leave a conversation full of holes.
 */
export enum StorytimeCommentStatus {
  /** Shown to everybody. */
  VISIBLE = 'VISIBLE',
  /** The author took it back. */
  DELETED_BY_AUTHOR = 'DELETED_BY_AUTHOR',
  /** The owner of the content hid it from their own page. */
  HIDDEN_BY_OWNER = 'HIDDEN_BY_OWNER',
  /** An administrator removed it under the content policy. */
  REMOVED_BY_ADMIN = 'REMOVED_BY_ADMIN',
}

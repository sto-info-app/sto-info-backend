/**
 * The reactions a reader may leave on Storytime content.
 *
 * A reader holds at most one reaction per target and may change or remove it.
 * The displayed rating is the count of {@link StorytimeReaction.THUMBS_UP}
 * minus the count of {@link StorytimeReaction.THUMBS_DOWN}.
 */
export enum StorytimeReaction {
  /** Approval. */
  THUMBS_UP = 'THUMBS_UP',
  /** Disapproval. */
  THUMBS_DOWN = 'THUMBS_DOWN',
}

/**
 * Why a Storytime picture was withdrawn when the work it belonged to was
 * deleted, as the file registry records it.
 *
 * A deleted Story, Chapter, Character or Arc can never be brought back, so the
 * pictures it carried are withdrawn with it rather than left to be served
 * from their old addresses: revoked in the registry and deleted from
 * Cloudflare, as a deleted news post's cover is.
 */
export const STORYTIME_DELETION_REASONS = {
  /** The Story was deleted, and its Chapters and cast with it. */
  STORY: 'Its Story was deleted',
  /** The Chapter was deleted on its own. */
  CHAPTER: 'Its Chapter was deleted',
  /** The Character was deleted on its own. */
  CHARACTER: 'Its Character was deleted',
  /** The Arc was deleted. */
  ARC: 'Its Arc was deleted',
} as const;

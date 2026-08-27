/**
 * The kinds of Storytime content that comments, reactions, reports, appeals,
 * reading lists and slug history can refer to.
 *
 * A single shared vocabulary keeps those features from each inventing their
 * own, which is what allows one report queue and one reaction table to serve
 * every kind of content. Individual features accept only the subset that makes
 * sense for them — reactions do not apply to media, for instance — and enforce
 * that in their own validation.
 */
export enum StorytimeTargetType {
  /** A Story. */
  STORY = 'STORY',
  /** A Chapter. */
  CHAPTER = 'CHAPTER',
  /** A Character. */
  CHARACTER = 'CHARACTER',
  /** An Arc. */
  ARC = 'ARC',
  /** An embedded media reference within a Chapter. */
  MEDIA = 'MEDIA',
  /** A Crew credit. */
  CREW_CREDIT = 'CREW_CREDIT',
  /** A comment. */
  COMMENT = 'COMMENT',
  /** A Spotlight entry. */
  SPOTLIGHT = 'SPOTLIGHT',
}

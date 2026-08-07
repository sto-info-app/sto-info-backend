/**
 * Why a member reported another member.
 *
 * Deliberately a short, fixed list: reporters pick the closest match and use
 * the free-text details for anything the list does not cover, which keeps the
 * admin queue filterable without asking reporters to categorise precisely.
 */
export enum ReportReason {
  /** Targeted abuse, threats or sustained unwanted contact. */
  HARASSMENT = 'HARASSMENT',
  /** Slurs or abuse aimed at a protected characteristic. */
  HATE_SPEECH = 'HATE_SPEECH',
  /** Unsolicited advertising, scams or repetitive junk. */
  SPAM = 'SPAM',
  /** Pretending to be another member, a developer or the site itself. */
  IMPERSONATION = 'IMPERSONATION',
  /** Offensive or otherwise unsuitable profile content. */
  INAPPROPRIATE_CONTENT = 'INAPPROPRIATE_CONTENT',
  /** Anything the other reasons do not cover, explained in the details. */
  OTHER = 'OTHER',
}

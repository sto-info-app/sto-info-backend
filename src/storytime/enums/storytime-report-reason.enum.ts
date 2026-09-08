/**
 * Why somebody reported a piece of Storytime content.
 *
 * These are the content policy's own categories rather than the member-report
 * list, because what a reader objects to in a Story is rarely what they object
 * to in a member: plagiarism and deceptive media have no meaning about a
 * person, and neither does "explicit content" about an account.
 *
 * A reporter picks the closest match and explains the rest in their own words,
 * which keeps the queue filterable without asking readers to be lawyers.
 *
 * Every value here is a prohibition the Content Policy actually states. Two of
 * them exist because the policy forbids something no other category describes:
 * generative-AI prose (§9) is not plagiarism, since nobody's work was taken,
 * and commercial use (§3, §18) is not spam, since a paywalled Story may be
 * entirely on-topic and still break the non-commercial principle the service
 * is built on.
 */
export enum StorytimeReportReason {
  /** Targeted abuse, threats or sustained unwanted contact. */
  HARASSMENT = 'HARASSMENT',
  /** Slurs or abuse aimed at a protected characteristic. */
  HATE_CONTENT = 'HATE_CONTENT',
  /** Sexual content beyond what the Story's rating declares. */
  EXPLICIT_CONTENT = 'EXPLICIT_CONTENT',
  /** Violence beyond what the Story's rating declares. */
  GRAPHIC_VIOLENCE = 'GRAPHIC_VIOLENCE',
  /** Somebody else's writing passed off as the author's own. */
  PLAGIARISM = 'PLAGIARISM',
  /** Pretending to be another member, a developer or the site itself. */
  IMPERSONATION = 'IMPERSONATION',
  /** Somebody's real-world details published without their agreement. */
  PERSONAL_INFORMATION = 'PERSONAL_INFORMATION',
  /** Use of a copyright holder's work beyond fan-work conventions. */
  COPYRIGHT = 'COPYRIGHT',
  /** Unsolicited advertising, scams or repetitive junk. */
  SPAM = 'SPAM',
  /** Links leading somewhere harmful. */
  MALICIOUS_LINK = 'MALICIOUS_LINK',
  /** Media presented as something it is not. */
  DECEPTIVE_MEDIA = 'DECEPTIVE_MEDIA',
  /** Substantive Story prose produced by a generative model. */
  AI_GENERATED_CONTENT = 'AI_GENERATED_CONTENT',
  /** Storytime used to sell, paywall, advertise or solicit. */
  COMMERCIAL_CONTENT = 'COMMERCIAL_CONTENT',
  /** Anything the other reasons do not cover, explained in the details. */
  OTHER = 'OTHER',
}

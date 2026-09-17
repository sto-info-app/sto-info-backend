/**
 * A kind of in-app notification a user may switch off.
 *
 * Requirement R16 fixes this list: these five are the only things that reach
 * the inbox. Everything else a Fleet does — a news post, a roster import
 * finishing, an admin action — belongs in the activity feed, so adding a value
 * here is a product decision rather than a convenience.
 *
 * Every category can be switched off, including {@link ROSTER_ASSOCIATION}.
 * Decided by Steve on 17 September 2026 over the alternative of forcing that
 * one on: a proposal nobody is told about goes unanswered and expires.
 */
export enum NotificationCategory {
  /** Someone named them in a message. */
  MENTION = 'MENTION',
  /** Someone replied to a message of theirs. */
  REPLY = 'REPLY',
  /** A direct message from an accepted friend. */
  DIRECT_MESSAGE = 'DIRECT_MESSAGE',
  /** Someone proposed that an imported roster row is one of their Characters. */
  ROSTER_ASSOCIATION = 'ROSTER_ASSOCIATION',
  /** A reminder for an event they explicitly subscribed to. */
  EVENT_REMINDER = 'EVENT_REMINDER',
}

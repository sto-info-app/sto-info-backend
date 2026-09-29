/** What a moderation hold keeps (FC-036). */
export enum ModerationHoldKind {
  /** A chat report's evidence, past its 90 days. */
  CHAT_REPORT = 'CHAT_REPORT',
  /** Everything one member wrote in chat, past the 45-day purge. */
  MEMBER_MESSAGES = 'MEMBER_MESSAGES',
}

/** What was done to a hold, as its log records it. */
export enum ModerationHoldActionKind {
  PLACED = 'PLACED',
  EXTENDED = 'EXTENDED',
  RELEASED = 'RELEASED',
  /** Somebody read what it keeps, with a purpose. */
  READ = 'READ',
  /** Its review date passed, and its owner was told (FC-037). */
  REVIEW_DUE = 'REVIEW_DUE',
  /** Every site admin was told the system will release it soon (FC-037). */
  RELEASE_WARNED = 'RELEASE_WARNED',
}

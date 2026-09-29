/** A Fleet retention job whose runs are recorded (FC-037). */
export enum RetentionJob {
  /** Sanitised roster files, 180 days after upload. */
  ROSTER_SOURCES = 'ROSTER_SOURCES',
  /** Scoped news posts, 30 days after they were deleted. */
  NEWS_POSTS = 'NEWS_POSTS',
  /** Retracted Character Fleet memberships, 30 days after. */
  CHARACTER_FLEET_MEMBERSHIPS = 'CHARACTER_FLEET_MEMBERSHIPS',
  /** Chat messages past the chat retention period. */
  CHAT_MESSAGES = 'CHAT_MESSAGES',
  /** Chat reports closed more than 90 days ago, with their evidence. */
  CHAT_REPORTS = 'CHAT_REPORTS',
  /** Transcripts past their 24 hours. */
  CHAT_TRANSCRIPTS = 'CHAT_TRANSCRIPTS',
  /** Activity items older than twelve months. */
  ACTIVITY = 'ACTIVITY',
  /** Holds past their review date: notices, then release. */
  MODERATION_HOLDS = 'MODERATION_HOLDS',
  /** This record's own runs, after a year. */
  RETENTION_RUNS = 'RETENTION_RUNS',
}

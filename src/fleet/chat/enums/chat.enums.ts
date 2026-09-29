/** Whether a channel is its scope's own or one its managers added (FC-031). */
export enum ChatChannelKind {
  /** The scope's one standard channel, open to all its members. */
  STANDARD = 'STANDARD',
  /** One of up to three its managers added. */
  CUSTOM = 'CUSTOM',
}

/** What a manager or moderator did in chat (FC-031). */
export enum ChatActionKind {
  CHANNEL_CREATED = 'CHANNEL_CREATED',
  CHANNEL_CHANGED = 'CHANNEL_CHANGED',
  CHANNEL_ARCHIVED = 'CHANNEL_ARCHIVED',
  MESSAGE_REMOVED = 'MESSAGE_REMOVED',
  /** A scope admin asked for a transcript (FC-035). */
  TRANSCRIPT_REQUESTED = 'TRANSCRIPT_REQUESTED',
  /** A transcript was downloaded (FC-035). */
  TRANSCRIPT_DOWNLOADED = 'TRANSCRIPT_DOWNLOADED',
  /** A transcript was written (FC-039). The system's. */
  TRANSCRIPT_READY = 'TRANSCRIPT_READY',
  /** A transcript was given up on (FC-039). The system's. */
  TRANSCRIPT_FAILED = 'TRANSCRIPT_FAILED',
  /** A transcript's file was deleted after its 24 hours (FC-039). */
  TRANSCRIPT_EXPIRED = 'TRANSCRIPT_EXPIRED',
}

/** Where a transcript is (FC-035). */
export enum ChatTranscriptStatus {
  /** Asked for, not yet written. */
  PENDING = 'PENDING',
  /** Written, and downloadable until it expires. */
  READY = 'READY',
  /** Not written: the asker lost the right, or the job failed. */
  FAILED = 'FAILED',
  /** Past its 24 hours, and deleted. */
  EXPIRED = 'EXPIRED',
}

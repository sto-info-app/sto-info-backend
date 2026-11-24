/**
 * Each kind of email a user can opt in to (sc-1067).
 *
 * One switch per notice type, as agreed for the story. Every type but
 * {@link LOGIN} starts off; the login alert starts on and is marked
 * "Recommended". The values are stored in `user_preference`, so renaming one
 * is a migration.
 */
export enum NotificationEmailType {
  /** Somebody signed in to the account. Sent at once, never in a digest. */
  LOGIN = 'LOGIN',

  /** Invited to help write a Story. */
  STORYTIME_STORY_INVITE = 'STORYTIME_STORY_INVITE',
  /** Invited to help assemble an Arc. */
  STORYTIME_ARC_INVITE = 'STORYTIME_ARC_INVITE',
  /** An administrator acted on their work. */
  STORYTIME_MODERATION = 'STORYTIME_MODERATION',
  /** One of their appeals was decided. */
  STORYTIME_APPEAL = 'STORYTIME_APPEAL',
  /** Their work was chosen for the Storytime Spotlight. */
  STORYTIME_SPOTLIGHT = 'STORYTIME_SPOTLIGHT',
  /** Somebody followed them, or a Story or Arc of theirs. */
  STORYTIME_FOLLOWER = 'STORYTIME_FOLLOWER',
  /** Somebody commented on their Story, Chapter or Arc. */
  STORYTIME_COMMENT = 'STORYTIME_COMMENT',
  /** Somebody replied to their comment. */
  STORYTIME_REPLY = 'STORYTIME_REPLY',
  /** Somebody reacted to their work. */
  STORYTIME_REACTION = 'STORYTIME_REACTION',
  /** A creator or Story they follow published something new. */
  STORYTIME_FOLLOWED_PUBLICATION = 'STORYTIME_FOLLOWED_PUBLICATION',

  /** Somebody asked to be their friend. */
  FRIEND_REQUEST = 'FRIEND_REQUEST',
  /** Somebody accepted their friend request. */
  FRIEND_ACCEPTED = 'FRIEND_ACCEPTED',

  /** Somebody named them in chat. */
  FLEET_MENTION = 'FLEET_MENTION',
  /** Somebody replied to a chat message of theirs. */
  FLEET_REPLY = 'FLEET_REPLY',
  /** A direct message from a friend. */
  FLEET_DIRECT_MESSAGE = 'FLEET_DIRECT_MESSAGE',
  /** A roster row was proposed as one of their Characters. */
  FLEET_ROSTER_PROPOSAL = 'FLEET_ROSTER_PROPOSAL',
  /** An event they asked to be reminded of starts soon. */
  FLEET_EVENT_REMINDER = 'FLEET_EVENT_REMINDER',
  /** An event they are reminded of was cancelled. */
  FLEET_EVENT_CANCELLED = 'FLEET_EVENT_CANCELLED',
  /** An event they are reminded of was moved. */
  FLEET_EVENT_MOVED = 'FLEET_EVENT_MOVED',
  /** A place came free at an event, and it is theirs. */
  FLEET_EVENT_PROMOTED = 'FLEET_EVENT_PROMOTED',
  /** Community ownership was offered or passed to them. */
  FLEET_OWNERSHIP = 'FLEET_OWNERSHIP',
  /** Somewhere they belong was suspended or reinstated. */
  FLEET_SUSPENSION = 'FLEET_SUSPENSION',
  /** Their Fleet membership was suspended or reinstated. */
  FLEET_MEMBERSHIP = 'FLEET_MEMBERSHIP',
  /** A Fleet of theirs joined, left or was refused by an Armada. */
  FLEET_ARMADA = 'FLEET_ARMADA',
  /** A chat transcript they asked for is ready. */
  FLEET_TRANSCRIPT = 'FLEET_TRANSCRIPT',
}

/** The headings Settings groups the switches under. */
export enum NotificationEmailGroup {
  ACCOUNT = 'ACCOUNT',
  STORYTIME = 'STORYTIME',
  FRIENDS = 'FRIENDS',
  FLEET = 'FLEET',
}

/** What each type is called, and where it sits. */
export interface NotificationEmailTypeInfo {
  /** The heading it is listed under. */
  readonly group: NotificationEmailGroup;
  /**
   * Its label on Settings, quoted by the unsubscribe page and each email's
   * footer, so all three use the reader's own words.
   */
  readonly label: string;
}

/**
 * Every type, in the order Settings lists them.
 *
 * The frontend keeps the same labels; its spec and this one both pin them.
 */
export const NOTIFICATION_EMAIL_TYPES: Readonly<
  Record<NotificationEmailType, NotificationEmailTypeInfo>
> = {
  [NotificationEmailType.LOGIN]: {
    group: NotificationEmailGroup.ACCOUNT,
    label: 'Login alerts',
  },
  [NotificationEmailType.STORYTIME_STORY_INVITE]: {
    group: NotificationEmailGroup.STORYTIME,
    label: 'Invitations to help write a Story',
  },
  [NotificationEmailType.STORYTIME_ARC_INVITE]: {
    group: NotificationEmailGroup.STORYTIME,
    label: 'Invitations to help with an Arc',
  },
  [NotificationEmailType.STORYTIME_MODERATION]: {
    group: NotificationEmailGroup.STORYTIME,
    label: 'Moderation of my work',
  },
  [NotificationEmailType.STORYTIME_APPEAL]: {
    group: NotificationEmailGroup.STORYTIME,
    label: 'Appeal decisions',
  },
  [NotificationEmailType.STORYTIME_SPOTLIGHT]: {
    group: NotificationEmailGroup.STORYTIME,
    label: 'Storytime Spotlight',
  },
  [NotificationEmailType.STORYTIME_FOLLOWER]: {
    group: NotificationEmailGroup.STORYTIME,
    label: 'New followers',
  },
  [NotificationEmailType.STORYTIME_COMMENT]: {
    group: NotificationEmailGroup.STORYTIME,
    label: 'Comments on my work',
  },
  [NotificationEmailType.STORYTIME_REPLY]: {
    group: NotificationEmailGroup.STORYTIME,
    label: 'Replies to my comments',
  },
  [NotificationEmailType.STORYTIME_REACTION]: {
    group: NotificationEmailGroup.STORYTIME,
    label: 'Reactions to my work',
  },
  [NotificationEmailType.STORYTIME_FOLLOWED_PUBLICATION]: {
    group: NotificationEmailGroup.STORYTIME,
    label: 'New Stories and Chapters I follow',
  },
  [NotificationEmailType.FRIEND_REQUEST]: {
    group: NotificationEmailGroup.FRIENDS,
    label: 'Friend requests',
  },
  [NotificationEmailType.FRIEND_ACCEPTED]: {
    group: NotificationEmailGroup.FRIENDS,
    label: 'Accepted friend requests',
  },
  [NotificationEmailType.FLEET_MENTION]: {
    group: NotificationEmailGroup.FLEET,
    label: 'Chat mentions',
  },
  [NotificationEmailType.FLEET_REPLY]: {
    group: NotificationEmailGroup.FLEET,
    label: 'Chat replies',
  },
  [NotificationEmailType.FLEET_DIRECT_MESSAGE]: {
    group: NotificationEmailGroup.FLEET,
    label: 'Direct messages',
  },
  [NotificationEmailType.FLEET_ROSTER_PROPOSAL]: {
    group: NotificationEmailGroup.FLEET,
    label: 'Roster association proposals',
  },
  [NotificationEmailType.FLEET_EVENT_REMINDER]: {
    group: NotificationEmailGroup.FLEET,
    label: 'Event reminders',
  },
  [NotificationEmailType.FLEET_EVENT_CANCELLED]: {
    group: NotificationEmailGroup.FLEET,
    label: 'Cancelled events',
  },
  [NotificationEmailType.FLEET_EVENT_MOVED]: {
    group: NotificationEmailGroup.FLEET,
    label: 'Moved events',
  },
  [NotificationEmailType.FLEET_EVENT_PROMOTED]: {
    group: NotificationEmailGroup.FLEET,
    label: 'Places freed for me at events',
  },
  [NotificationEmailType.FLEET_OWNERSHIP]: {
    group: NotificationEmailGroup.FLEET,
    label: 'Community ownership',
  },
  [NotificationEmailType.FLEET_SUSPENSION]: {
    group: NotificationEmailGroup.FLEET,
    label: 'Suspensions and reinstatements',
  },
  [NotificationEmailType.FLEET_MEMBERSHIP]: {
    group: NotificationEmailGroup.FLEET,
    label: 'Fleet membership changes',
  },
  [NotificationEmailType.FLEET_ARMADA]: {
    group: NotificationEmailGroup.FLEET,
    label: 'Armada changes',
  },
  [NotificationEmailType.FLEET_TRANSCRIPT]: {
    group: NotificationEmailGroup.FLEET,
    label: 'Chat transcripts ready',
  },
};

/** What a new or existing account receives until it says otherwise. */
export const DEFAULT_EMAIL_NOTIFICATION_TYPES: readonly NotificationEmailType[] =
  [NotificationEmailType.LOGIN];

/**
 * The types that can come in bursts. Sent instantly, each is held to one email
 * an hour, which rolls up whatever arrived meanwhile.
 */
export const THROTTLED_EMAIL_TYPES: ReadonlySet<NotificationEmailType> =
  new Set([
    NotificationEmailType.STORYTIME_REACTION,
    NotificationEmailType.STORYTIME_FOLLOWER,
  ]);

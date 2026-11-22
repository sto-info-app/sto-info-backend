import { NotificationCategory } from 'src/user/enums/notification-category.enum';

/**
 * What a targeted in-app notice tells somebody (FC-028, FC-029).
 *
 * Each kind belongs to one of the five {@link NotificationCategory} values
 * R16 allows, which is the preference that can switch it off. A kind is
 * added with the feature that raises it, and its handler registered with
 * the outbox; routine activity is feed, never a kind here.
 */
export enum NotificationOutboxKind {
  /** An event occurrence somebody subscribed to starts soon. */
  EVENT_REMINDER = 'EVENT_REMINDER',
  /** An occurrence somebody is reminded of was cancelled. */
  EVENT_CANCELLED = 'EVENT_CANCELLED',
  /** An occurrence somebody is reminded of was moved. */
  EVENT_MOVED = 'EVENT_MOVED',
  /** A place came free at an occurrence, and it is theirs. */
  EVENT_PROMOTED = 'EVENT_PROMOTED',
  /** A roster row was proposed as one of their Characters. */
  ROSTER_ASSOCIATION_PROPOSED = 'ROSTER_ASSOCIATION_PROPOSED',
  CHAT_MENTION = 'CHAT_MENTION',
  CHAT_REPLY = 'CHAT_REPLY',
  CHAT_DIRECT_MESSAGE = 'CHAT_DIRECT_MESSAGE',
}

/** The preference each kind of notice answers to. */
export const NOTIFICATION_OUTBOX_CATEGORIES: Readonly<
  Record<NotificationOutboxKind, NotificationCategory>
> = {
  [NotificationOutboxKind.EVENT_REMINDER]: NotificationCategory.EVENT_REMINDER,
  [NotificationOutboxKind.EVENT_CANCELLED]: NotificationCategory.EVENT_REMINDER,
  [NotificationOutboxKind.EVENT_MOVED]: NotificationCategory.EVENT_REMINDER,
  [NotificationOutboxKind.EVENT_PROMOTED]: NotificationCategory.EVENT_REMINDER,
  [NotificationOutboxKind.ROSTER_ASSOCIATION_PROPOSED]:
    NotificationCategory.ROSTER_ASSOCIATION,
  [NotificationOutboxKind.CHAT_MENTION]: NotificationCategory.MENTION,
  [NotificationOutboxKind.CHAT_REPLY]: NotificationCategory.REPLY,
  [NotificationOutboxKind.CHAT_DIRECT_MESSAGE]:
    NotificationCategory.DIRECT_MESSAGE,
};

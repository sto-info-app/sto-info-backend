/**
 * Audience for an inbox notification.
 */
export enum NotificationTarget {
  /** Delivered to every authenticated user. */
  BROADCAST = 'BROADCAST',
  /** Delivered to a single user identified by `userId`. */
  USER = 'USER',
}

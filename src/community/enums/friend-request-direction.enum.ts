/**
 * Which way a pending friend request points, relative to the caller.
 */
export enum FriendRequestDirection {
  /** Sent to the caller, awaiting their response. */
  INCOMING = 'INCOMING',
  /** Sent by the caller, awaiting the other member's response. */
  OUTGOING = 'OUTGOING',
}

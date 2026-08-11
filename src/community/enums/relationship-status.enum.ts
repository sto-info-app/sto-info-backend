/**
 * How the authenticated caller relates to the member they are looking at.
 *
 * Drives which action the profile page offers — add, cancel, respond, unfriend
 * or unblock — so the client never has to infer it from raw friendship rows.
 */
export enum RelationshipStatus {
  /** The caller is looking at their own record. */
  SELF = 'SELF',
  /** No friendship row exists, or the last one was declined. */
  NONE = 'NONE',
  /** The caller has sent a request that is still pending. */
  REQUEST_SENT = 'REQUEST_SENT',
  /** The member has sent the caller a request that is still pending. */
  REQUEST_RECEIVED = 'REQUEST_RECEIVED',
  /** The request was accepted; the two are friends. */
  FRIENDS = 'FRIENDS',
  /** The caller has blocked this member. */
  BLOCKED = 'BLOCKED',
}

/**
 * Lifecycle state of a friendship row.
 *
 * A cancelled request and an unfriend both soft-delete the row rather than
 * adding a state here, so the partial unique index can free the pair up for a
 * fresh request.
 */
export enum FriendshipStatus {
  /** The addressee has not yet responded. */
  PENDING = 'PENDING',
  /** Both members are friends. */
  ACCEPTED = 'ACCEPTED',
  /** The addressee turned the request down; the requester may try again. */
  DECLINED = 'DECLINED',
}

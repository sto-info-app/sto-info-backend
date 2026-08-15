/**
 * Where a Story sits in an Arc's inclusion workflow.
 *
 * Inclusion is agreed by both sides: a curator may invite a Story, or an owner
 * may request inclusion, and only {@link ArcMembershipStatus.APPROVED}
 * membership counts towards public Arc navigation and progress.
 */
export enum ArcMembershipStatus {
  /** The Story owner has asked to join the Arc. */
  REQUESTED = 'REQUESTED',
  /** The Arc curator has invited the Story. */
  INVITED = 'INVITED',
  /** Both sides agree; the Story is part of the Arc. */
  APPROVED = 'APPROVED',
  /** The invitation or request was turned down. */
  DECLINED = 'DECLINED',
  /** The curator removed the Story from the Arc. */
  REMOVED = 'REMOVED',
  /** The Story owner withdrew the Story from the Arc. */
  WITHDRAWN = 'WITHDRAWN',
}

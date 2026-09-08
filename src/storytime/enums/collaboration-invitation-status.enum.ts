/**
 * Where a Story collaboration invitation has got to.
 *
 * Only `ACCEPTED` confers anything. An invitation nobody has answered grants
 * no access at all, which is what stops a Story owner from adding somebody to
 * their Story without that person agreeing to it.
 */
export enum CollaborationInvitationStatus {
  /** Sent, and waiting on the invited member. */
  INVITED = 'INVITED',
  /** Accepted by the invited member. The only status that grants access. */
  ACCEPTED = 'ACCEPTED',
  /** Turned down by the invited member. */
  DECLINED = 'DECLINED',
  /** Withdrawn by the Story owner, or the collaborator removed later. */
  REVOKED = 'REVOKED',
}

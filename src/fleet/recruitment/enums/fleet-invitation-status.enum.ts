/**
 * Where an invitation to join a Fleet stands (FC-021).
 *
 * An invitation lapses 14 days after it is sent. That is read from its
 * `expiresAt` rather than kept as a status, so it cannot be stale: `LAPSED`
 * is set only when an expired invitation is replaced by a new one, which
 * frees the one-open-invitation slot the new one needs.
 */
export enum FleetInvitationStatus {
  /** Sent, and not yet answered. Open until `expiresAt`. */
  PENDING = 'PENDING',
  /** The invitee accepted with one of their Characters. */
  ACCEPTED = 'ACCEPTED',
  /** The invitee said no. */
  DECLINED = 'DECLINED',
  /** An officer took it back. */
  WITHDRAWN = 'WITHDRAWN',
  /** It expired unanswered and a newer invitation replaced it. */
  LAPSED = 'LAPSED',
}

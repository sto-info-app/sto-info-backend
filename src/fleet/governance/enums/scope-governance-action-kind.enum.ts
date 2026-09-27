/**
 * What a governance change was (FC-022).
 *
 * Role assignments and capability grants are temporal rows, so they already
 * say when a role or a grant began and ended. What they cannot say is who
 * ended it and why, and nothing at all records an ownership offer that was
 * declined or a closure's reason. This is that record.
 */
export enum ScopeGovernanceActionKind {
  /** A role label was given to somebody here. */
  ROLE_ASSIGNED = 'ROLE_ASSIGNED',
  /** A role label was taken away. Carries its reason. */
  ROLE_WITHDRAWN = 'ROLE_WITHDRAWN',
  /** A capability was granted, to Officers here or to one person. */
  CAPABILITY_GRANTED = 'CAPABILITY_GRANTED',
  /** A capability was denied to one person. Carries its reason. */
  CAPABILITY_DENIED = 'CAPABILITY_DENIED',
  /**
   * A grant or a denial was cleared. Carries its reason when what was
   * cleared was a grant, which takes a power away.
   */
  CAPABILITY_CLEARED = 'CAPABILITY_CLEARED',
  /** The Owner offered the Community to one of its Admins. */
  OWNERSHIP_OFFERED = 'OWNERSHIP_OFFERED',
  /** The Admin accepted, and became the Owner. */
  OWNERSHIP_ACCEPTED = 'OWNERSHIP_ACCEPTED',
  /** The Admin declined. */
  OWNERSHIP_DECLINED = 'OWNERSHIP_DECLINED',
  /** The offer was taken back before it was answered. */
  OWNERSHIP_CANCELLED = 'OWNERSHIP_CANCELLED',
  /**
   * A site administrator moved ownership in a dispute, with no acceptance.
   * Carries its reason.
   */
  OWNERSHIP_REASSIGNED = 'OWNERSHIP_REASSIGNED',
  /** The scope was closed. Carries its reason. */
  CLOSED = 'CLOSED',
}

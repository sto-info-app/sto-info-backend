/**
 * How a Fleet or Community accepts new members.
 *
 * Fixed set from plan section 4.1. This describes the posture only: it decides
 * whether an application may be started, never whether one is approved, and it
 * grants nothing on its own.
 */
export enum FleetRecruitmentState {
  /** Anyone eligible may join without an application. */
  OPEN = 'OPEN',
  /** Joining requires an application that an Officer or Admin decides. */
  APPLICATION = 'APPLICATION',
  /** Only an invitation from within the scope can start membership. */
  INVITE_ONLY = 'INVITE_ONLY',
  /** Not recruiting. Existing members are unaffected. */
  CLOSED = 'CLOSED',
}

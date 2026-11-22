/**
 * The fixed role labels a scope may grant, from plan section 4.3.
 *
 * There are no user-created role names in v1. A label on its own is not a
 * capability set: Officer abilities are delegated explicitly and default to
 * least privilege, and a CSV Guild Rank never assigns any of these — that is
 * FC-005's second and third acceptance criteria.
 */
export enum FleetScopeRole {
  /** Owns the scope. Settings, delegation, transfer and closure. */
  OWNER = 'OWNER',
  /** Administers the scope short of ownership transfer and closure. */
  ADMIN = 'ADMIN',
  /** Holds only the capabilities explicitly delegated to them. */
  OFFICER = 'OFFICER',
  /** Approved member with no management capability. */
  MEMBER = 'MEMBER',
}

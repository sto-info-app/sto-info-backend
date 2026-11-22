/**
 * Whether a scoped capability grant adds a capability or takes one away.
 *
 * Deliberately the same two-valued shape as the site-wide
 * {@link PermissionEffect}, and for the same reason: withdrawing one capability
 * from one Officer must not require inventing a role for them, and must not
 * mean removing a role that also carries a dozen capabilities they should keep.
 *
 * `DENY` always beats `GRANT` and always beats a role baseline. That is
 * FC-005's first acceptance criterion and it is not configurable.
 */
export enum ScopeCapabilityEffect {
  /** Adds the capability at this scope. */
  GRANT = 'GRANT',
  /** Removes the capability at this scope, whatever else would confer it. */
  DENY = 'DENY',
}

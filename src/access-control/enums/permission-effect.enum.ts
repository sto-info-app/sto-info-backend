/**
 * Whether a per-user permission override grants or withholds a permission.
 *
 * Overrides exist so a single user can be treated differently from everyone
 * else holding their role, without inventing a new role for one person.
 * {@link PermissionEffect.DENY} always beats {@link PermissionEffect.GRANT} and
 * both beat the permissions inherited from the user's role, which is what lets
 * an administrator bar one abusive account from a capability while leaving the
 * account otherwise usable.
 */
export enum PermissionEffect {
  /** Adds a permission the user's role does not confer. */
  GRANT = 'GRANT',
  /** Withholds a permission the user's role would otherwise confer. */
  DENY = 'DENY',
}

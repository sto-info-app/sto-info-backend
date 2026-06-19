/**
 * Application user roles used for authorization decisions.
 *
 * Roles are intentionally coarse-grained: most users are {@link UserRole.USER},
 * while site maintainers are {@link UserRole.ADMIN} and may manage news posts,
 * banners and notifications.
 */
export enum UserRole {
  /** Standard authenticated user. */
  USER = 'USER',
  /** Site administrator with content-management privileges. */
  ADMIN = 'ADMIN',
}

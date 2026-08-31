/**
 * Application user roles used for authorization decisions.
 *
 * Roles are intentionally coarse-grained: most users are {@link UserRole.USER},
 * Storytime curators look after the community's content, and site maintainers
 * are {@link UserRole.ADMIN} and may manage news posts, banners and
 * notifications.
 */
export enum UserRole {
  /** Standard authenticated user. */
  USER = 'USER',
  /** Site administrator with content-management privileges. */
  ADMIN = 'ADMIN',
  /**
   * Moderates and curates Storytime without any of the site-wide
   * administration an {@link UserRole.ADMIN} holds.
   */
  STORYTIME_CURATOR = 'STORYTIME_CURATOR',
}


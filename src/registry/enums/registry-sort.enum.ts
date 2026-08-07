/**
 * Ordering options for the registry profile listing.
 */
export enum RegistrySort {
  /** Alphabetical by username — the default browse order. */
  USERNAME = 'username',
  /** Newest STO Info members first, by profile creation date. */
  RECENTLY_JOINED = 'recently-joined',
  /** Most recently signed-in members first. */
  RECENTLY_ACTIVE = 'recently-active',
}

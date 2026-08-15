/**
 * The application area a permission belongs to.
 *
 * Used to group permissions in the administration UI and to let a module's
 * permissions be seeded, listed and reasoned about independently of the rest of
 * the application.
 */
export enum PermissionModule {
  /** STO Storytime — community fan-fiction publishing. */
  STORYTIME = 'STORYTIME',
}

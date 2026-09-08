/**
 * Which kind of STO record a custom definition describes.
 *
 * A definition belongs to a scope rather than to one record: an
 * `ACCOUNT`-scoped Section appears against every STO Account its owner has,
 * and a `CHARACTER`-scoped one against every Character. That is what makes the
 * feature configurable once and answerable many times, instead of a template
 * the user has to copy onto each record.
 *
 * The scope is fixed when a Section is created and can never change. Moving a
 * definition between scopes would strand every value already recorded under it
 * — the values hang off an Account or a Character, and the other scope has no
 * row to move them to — so the user is asked to build the definition again on
 * the other side rather than being offered a migration that would quietly lose
 * data.
 */
export enum CustomTrackingTargetScope {
  /** Definitions answered once per STO Account. */
  ACCOUNT = 'ACCOUNT',
  /** Definitions answered once per STO Character. */
  CHARACTER = 'CHARACTER',
}

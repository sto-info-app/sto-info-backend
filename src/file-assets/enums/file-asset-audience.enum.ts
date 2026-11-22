/**
 * Who an asset may be handed to.
 *
 * Visibility only. Holding an audience says nothing about who may replace or
 * delete the asset — that is the owning feature's business and is decided by
 * the scoped capability policy, which is ADR-0002's separation of seeing from
 * doing.
 *
 * Matched by name at every site, never compared as an ordering, for the same
 * reason {@link FleetAudience} is: written widest-first it invites "at least
 * this", and then a value inserted later silently widens every check.
 */
export enum FileAssetAudience {
  /** Anyone, including signed-out visitors. A profile picture. */
  PUBLIC = 'PUBLIC',

  /** Any signed-in reader, whoever they are. */
  AUTHENTICATED = 'AUTHENTICATED',

  /** The uploading user alone. */
  OWNER = 'OWNER',

  /**
   * Whoever the owning Fleet scope says, resolved by the Fleet audience
   * service.
   *
   * An asset carrying this names a Community, Fleet or Armada and one of the
   * four {@link FleetAudience} values, and the question is answered by
   * FC-005's existing service rather than by a second implementation here.
   * That matters: "may this person see this" already has one answer in this
   * codebase and a file is not a reason to write another.
   */
  SCOPE = 'SCOPE',

  /**
   * Nobody, through any ordinary route.
   *
   * What a retained roster import source is. It is evidence, not content: it
   * exists so an authorised investigator can be shown why an import produced
   * what it did, and that route is W09's to build with its own authority and
   * its own reason logging. Until then this audience means the delivery
   * endpoint refuses it to every caller, including the person who uploaded it.
   */
  RESTRICTED = 'RESTRICTED',
}

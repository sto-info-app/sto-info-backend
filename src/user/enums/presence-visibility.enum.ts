/**
 * Who may see that a user is online.
 *
 * A single choice rather than a set of independent toggles, and matched by
 * name rather than compared as a level: inserting a value here must never
 * silently widen a check that was written as "at least", which is the same
 * reasoning ADR-0009 applies to scope authority.
 *
 * Hiding is deliberately not a value. A user who wants to disappear for an
 * afternoon sets `appearOffline` instead, so their real audience is still
 * there when they come back rather than having been overwritten.
 */
export enum PresenceVisibility {
  /** Anyone who can see their profile. */
  EVERYONE = 'EVERYONE',
  /** Accepted friends only. */
  FRIENDS = 'FRIENDS',
  /** Members of Fleets and Armadas they currently belong to. */
  FLEETS_AND_ARMADAS = 'FLEETS_AND_ARMADAS',
}

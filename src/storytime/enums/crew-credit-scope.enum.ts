/**
 * What a Crew credit attaches to.
 *
 * Crew credits are public acknowledgement only. They never confer edit access,
 * which comes exclusively from an accepted Story collaboration.
 */
export enum CrewCreditScope {
  /** Credited for the Story as a whole. */
  STORY = 'STORY',
  /** Credited for a specific Chapter. */
  CHAPTER = 'CHAPTER',
  /** Credited for a specific Character, optionally within a Chapter. */
  CHARACTER = 'CHARACTER',
}

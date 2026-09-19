/**
 * Which of the two headers an upload arrived with.
 *
 * Recorded as provenance because the sanitised file cannot say. Both shapes
 * produce the same twelve columns, so without this the fact that an export
 * once carried officer notes would be lost entirely — and that fact matters:
 * it is what tells an investigator that something was discarded, and it is
 * what lets an administrator see how much of the estate is officer-visible
 * without reading a single note.
 *
 * In the analysed corpus 868 of 1,199 files were officer-shaped.
 */
export enum RosterSourceHeaderShape {
  /** The twelve-column export. Nothing was discarded. */
  NORMAL = 'NORMAL',

  /** The fifteen-column export. The three officer columns were discarded. */
  OFFICER = 'OFFICER',
}

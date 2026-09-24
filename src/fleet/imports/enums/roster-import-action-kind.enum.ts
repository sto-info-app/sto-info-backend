/**
 * What an investigator did to a roster import, as the action log records it.
 *
 * Each is reversible by another, apart from a timezone correction, which is
 * corrected by another correction. None of them touches an observation's
 * values: they change whether, and how, the evidence counts.
 */
export enum RosterImportActionKind {
  /** The import was taken out of the Fleet's history. */
  EXCLUDED = 'EXCLUDED',

  /** An excluded import was put back. */
  REINSTATED = 'REINSTATED',

  /** The export was said to be possibly incomplete. */
  MARKED_PARTIAL = 'MARKED_PARTIAL',

  /** The export was said to be complete after all. */
  UNMARKED_PARTIAL = 'UNMARKED_PARTIAL',

  /** Some of its rows were excluded; the detail names their lines. */
  ROWS_EXCLUDED = 'ROWS_EXCLUDED',

  /** Some excluded rows were put back; the detail names their lines. */
  ROWS_REINSTATED = 'ROWS_REINSTATED',

  /** The zone its times were read through was changed; the detail says how. */
  TIMEZONE_CORRECTED = 'TIMEZONE_CORRECTED',

  /** It was selected as the roster at a moment several exports claim. */
  CONFLICT_SELECTED = 'CONFLICT_SELECTED',
}

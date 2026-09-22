/**
 * The name STO gives a roster export, anchored at both ends.
 *
 * `<Fleet>_YYYYMMDD-HHMMSS.csv`, with the extension in any case: the corpus
 * writes `.Csv`, and a browser or an operating system may write it back
 * differently.
 *
 * Two details matter more than they look.
 *
 * **The Fleet group is greedy**, so the stamp is read from the *last*
 * `_YYYYMMDD-HHMMSS` in the name rather than the first underscore. Fleet names
 * contain underscores and digits, and a lazy group would cut `House_of_MidNite
 * _20211221-034426` into a Fleet called `House` with nonsense after it.
 *
 * **It is anchored at the end**, which is the whole of the suffix rule. There
 * is nowhere for ` - Dragon Export` or `_PrePromotions` to go, so the 34
 * annotated files in the analysed corpus do not match — no suffix stripping,
 * no recovery, no exception for the ones that were useful as research.
 */
const ROSTER_FILENAME_PATTERN =
  /^(?<fleet>.+)_(?<date>\d{8})-(?<time>\d{6})\.[Cc][Ss][Vv]$/;

/** Where each field sits in the stamp's digits. */
const STAMP = {
  year: [0, 4],
  month: [4, 6],
  day: [6, 8],
  hour: [0, 2],
  minute: [2, 4],
  second: [4, 6],
} as const;

/** What an export's filename says about itself. */
export interface RosterFilenameReading {
  /**
   * The Fleet label, exactly as the name carries it.
   *
   * Never trimmed, case-folded or stripped. Three of the fixtures exist only
   * to prove that: a Fleet whose registered name begins with a space, a
   * hyphen or a guillemet is a different Fleet from one whose name does not,
   * and this game is played by people who know that.
   */
  readonly fleetLabel: string;

  /**
   * When the export says it was taken, as a local wall-clock time.
   *
   * `YYYY-MM-DDTHH:mm:ss`, which is the form the shared timezone utility
   * reads. Local, because that is all the name records: the digits are
   * whatever the exporting player's own clock said, and turning them into an
   * instant needs a zone that only the uploader can supply.
   */
  readonly localStamp: string;
}

/**
 * Reads an STO roster export's filename.
 *
 * Shape only. Whether the stamp names a real moment, and whether the Fleet
 * label is this Fleet, are questions that need a timezone and a database
 * respectively, and are asked by
 * {@link RosterExportIdentityService}.
 *
 * @param filename - The filename exactly as uploaded.
 * @returns What the name says, or null when it is not the name the game
 *   writes.
 */
export function readRosterFilename(
  filename: string,
): RosterFilenameReading | null {
  const match = ROSTER_FILENAME_PATTERN.exec(filename);

  if (!match?.groups) {
    return null;
  }

  const { fleet, date, time } = match.groups;

  const localStamp =
    `${date.slice(...STAMP.year)}-${date.slice(...STAMP.month)}-` +
    `${date.slice(...STAMP.day)}T${time.slice(...STAMP.hour)}:` +
    `${time.slice(...STAMP.minute)}:${time.slice(...STAMP.second)}`;

  return { fleetLabel: fleet, localStamp };
}

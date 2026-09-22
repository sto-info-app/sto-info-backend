import { ROSTER_FILENAME_MAX_LENGTH } from '../constants/roster-upload.constants';
import { RosterCsvRejectionCode } from '../enums/roster-csv-rejection-code.enum';
import { RosterCsvRejectedError } from '../errors/roster-csv-rejected.error';

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

/** The lowest code point a filename may hold: everything below is a control. */
const FIRST_PRINTABLE_CHARACTER = 0x20;

/** The code point of the delete character. */
const DELETE_CHARACTER = 0x7f;

/**
 * Refuses a filename that cannot be recorded as it stands.
 *
 * Asked before the grammar, and of every path that takes a file: the name is
 * written to a log line and shown back to people, and neither survives a
 * newline in the middle of one. Path separators go the same way, because a
 * filename that looks like a path invites some later caller to treat it as
 * one. This application never does, since a storage key comes from the
 * asset's own identifier, but the invitation is worth declining at the door.
 *
 * Refused rather than cleaned up. Cleaning it up would mean the recorded
 * filename was not the filename, which defeats recording it.
 *
 * @param filename - The filename as the browser sent it.
 * @throws RosterCsvRejectedError when it cannot be recorded as it stands.
 */
export function assertRosterFilenameUsable(filename: string): void {
  if (
    filename.trim().length === 0 ||
    filename.length > ROSTER_FILENAME_MAX_LENGTH ||
    hasUnusableCharacter(filename)
  ) {
    throw new RosterCsvRejectedError(RosterCsvRejectionCode.FILENAME_UNUSABLE);
  }
}

/**
 * Reports whether a filename holds a character it may not.
 *
 * @param filename - The filename as the browser sent it.
 * @returns True when it cannot be recorded as it stands.
 */
function hasUnusableCharacter(filename: string): boolean {
  for (let index = 0; index < filename.length; index += 1) {
    const code = filename.charCodeAt(index);

    if (code < FIRST_PRINTABLE_CHARACTER || code === DELETE_CHARACTER) {
      return true;
    }
  }

  return filename.includes('/') || filename.includes('\\');
}

import { normalizeHandle } from 'src/shared/utilities/handle.utility';

/**
 * Folds a Character name for matching.
 *
 * One definition for the two places that have to agree: the typed reader,
 * which refuses a file listing one member twice, and the observation table,
 * whose unique constraint says the same thing in the database. Were they to
 * fold differently, a file the reader passed could fail at the insert as a
 * database error with no line number, which is the one refusal nobody can
 * act on.
 *
 * Composed before it is lower-cased, because the same visible name can arrive
 * as one code point or as a letter and a combining mark depending on what
 * typed it. Never trimmed: a leading space is how two Characters are
 * deliberately told apart in this game, as it is in a Fleet's name.
 *
 * @param name - The name, exactly as exported.
 * @returns The name composed and lower-cased.
 */
export function normaliseRosterCharacterName(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

/**
 * Folds an account handle for matching.
 *
 * The site's own handle rule rather than a roster-specific one, so that a
 * roster row and a registered account compare the same way when FC-018 comes
 * to put them side by side.
 *
 * @param handle - The handle, exactly as exported.
 * @returns The handle trimmed and lower-cased.
 */
export function normaliseRosterAccountHandle(handle: string): string {
  return normalizeHandle(handle);
}

/**
 * Folds a roster row's name and handle into a registered Character's full
 * handle, as `character.fullHandleNormalized` holds it.
 *
 * The one place a roster row is put beside a registered Character: FC-018's
 * proposals and FC-020's profile links both match on it, and must agree.
 * The export writes the handle with its leading `@`, and a Character's full
 * handle has exactly one.
 *
 * @param characterName - The Character name, exactly as exported.
 * @param accountHandle - The account handle, exactly as exported.
 * @returns The full handle, trimmed and lower-cased.
 */
export function rosterRowFullHandle(
  characterName: string,
  accountHandle: string,
): string {
  return normalizeHandle(`${characterName}@${accountHandle.replace(/^@/, '')}`);
}

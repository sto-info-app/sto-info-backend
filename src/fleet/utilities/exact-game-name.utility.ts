import {
  EXACT_GAME_NAME_FORBIDDEN_PATTERN,
  EXACT_GAME_NAME_MAX_CODEPOINTS,
  EXACT_GAME_NAME_MIN_CODEPOINTS,
} from '../constants/fleet-name.constants';

/**
 * The three things STO Info does with the exact in-game name of a Fleet or
 * Armada, kept apart because they are not the same operation — ADR-0003.
 *
 * **Storing it.** Exactly as given. Every codepoint is preserved, including
 * leading and trailing spaces, which Steve ruled on directly: they are
 * accepted and kept rather than trimmed, because trimming mutates the stored
 * value and would stop it matching a roster filename that carries the space.
 *
 * **Comparing it to a filename.** On the NFC form, exactly: not
 * case-insensitively, not with punctuation stripped, not trimmed. That check
 * belongs to FC-016; {@link toComparableExactGameName} is the form it compares.
 *
 * **Warning that a name looks like one already registered.** A different job
 * with a different answer, and {@link toNormalisedExactGameName} is its form.
 */

/** Why a name was refused, for a message that says something useful. */
export type ExactGameNameProblem = 'EMPTY' | 'TOO_LONG' | 'CONTROL_CHARACTER';

/**
 * Counts a string in codepoints rather than UTF-16 units.
 *
 * `'a'.length` and `'𝕬'.length` differ, and a name bound measured in the
 * latter would silently halve for anything outside the basic plane.
 *
 * @param value - The string to measure.
 * @returns The number of Unicode codepoints.
 */
export function countCodepoints(value: string): number {
  return [...value].length;
}

/**
 * Checks a name against the rule, and says which part it failed.
 *
 * @param value - The name as it was typed.
 * @returns The problem, or null when the name is acceptable.
 */
export function findExactGameNameProblem(
  value: string,
): ExactGameNameProblem | null {
  if (EXACT_GAME_NAME_FORBIDDEN_PATTERN.test(value)) {
    return 'CONTROL_CHARACTER';
  }

  // Measured after trimming, so a name of three spaces is refused: it is
  // indistinguishable from no name everywhere one is displayed. A space
  // inside a name, or at either end of a name that has something else in it,
  // is still kept.
  if (countCodepoints(value.trim()) < EXACT_GAME_NAME_MIN_CODEPOINTS) {
    return 'EMPTY';
  }

  // Measured without trimming, because an edge space is stored and displayed
  // and so has to fit in the same budget as any other character.
  if (countCodepoints(value) > EXACT_GAME_NAME_MAX_CODEPOINTS) {
    return 'TOO_LONG';
  }

  return null;
}

/**
 * Determines whether a name is one STO Info will hold.
 *
 * @param value - The name as it was typed.
 * @returns True when nothing about it is refused.
 */
export function isValidExactGameName(value: unknown): boolean {
  return typeof value === 'string' && findExactGameNameProblem(value) === null;
}

/**
 * The form two names are compared in when the question is whether they are
 * the same name.
 *
 * NFC only. A name typed with a combining accent and the same name typed with
 * a precomposed one are the same name and have to match; nothing else about
 * the value is touched, because every other difference is a real difference.
 *
 * @param value - The name as stored.
 * @returns The comparable form.
 */
export function toComparableExactGameName(value: string): string {
  return value.normalize('NFC');
}

/**
 * The form the duplicate-detection column holds.
 *
 * A different question from {@link toComparableExactGameName}, and so a
 * different answer. This one asks "has somebody already registered what looks
 * like this Fleet", and it is used to *warn* a registrant — never to refuse
 * them, and never as a unique constraint, because two Communities may each
 * hold a record for the same in-game Fleet and neither is authoritative.
 *
 * **Case is folded. Whitespace is not.** Two names differing only in
 * capitalisation are the same Fleet, because the game does not let two Fleets
 * differ by case alone in any way a player could act on. A leading or
 * trailing space is the opposite: Steve has seen it used in game precisely so
 * that two different Fleets can carry almost the same name. Trimming here
 * would make the directory tell a registrant that a Fleet already exists when
 * what exists is a deliberately distinct one, which is a worse failure than
 * missing a duplicate — the warning exists to inform, and a confident wrong
 * warning is what stops people trusting it.
 *
 * That makes the display obligation in ADR-0003 sharper rather than softer:
 * where an edge space is the only difference between two names, it is the
 * only thing telling two Fleets apart, so it has to be visible.
 *
 * @param value - The name as stored.
 * @returns The case-folded NFC form, with every space kept.
 */
export function toNormalisedExactGameName(value: string): string {
  return value.normalize('NFC').toLowerCase();
}

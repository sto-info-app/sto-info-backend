import { RosterProfession } from '../enums/roster-profession.enum';

/**
 * The grammar the typed reader holds values to, on top of the sanitised file
 * (FC-016).
 *
 * Everything here is asked of a *value*, where
 * {@link ROSTER_CSV_LIMITS} and its neighbours are asked of the file's shape.
 * The two are separate on purpose: the privacy parser must stay small enough
 * to reason about exhaustively and has no business knowing what a level is,
 * and this layer has no business re-deciding where a row ends.
 *
 * **No new length rules.** The privacy parser already refuses any retained
 * value over four kilobytes, and nothing in the corpus justifies a tighter
 * bound on a name, a rank label or a comment somebody typed. Inventing one
 * here would refuse real exports to no purpose.
 */

/**
 * An STO date, exactly: `M/D/YYYY h:mm:ssam`.
 *
 * Anchored, and read by this pattern rather than by `Date.parse`, which reads
 * `3/4/2024` as the fourth of March in one locale and the third of April in
 * another and would quietly transpose every date in an export.
 *
 * The pattern says nothing about whether the date exists. The twelve-hour
 * clock is range-checked where it is read, because `13:00:00am` matches the
 * digits here and means nothing; the calendar is range-checked by the shared
 * timezone utility, which already knows about leap years and has tests for
 * them.
 */
export const STO_DATE_PATTERN =
  /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2})([apAP][mM])$/;

/** How many hours the twelve-hour clock names before it repeats. */
export const HOURS_ON_A_CLOCK_FACE = 12;

/**
 * A Level, as the export writes it.
 *
 * Digits only, four at most. No upper game bound is asserted: the level cap
 * has moved four times since launch and an importer that refused a roster the
 * week the cap rose would be wrong about the game rather than about the file.
 */
export const ROSTER_LEVEL_PATTERN = /^\d{1,4}$/;

/**
 * A cumulative Contribution Total, as the export writes it.
 *
 * Digits only, fifteen at most. The largest figure in the analysed corpus is
 * 164,858,584, so the bound is six orders of magnitude clear of anything
 * observed — and it is fifteen rather than a rounder number because every
 * value under it is exactly representable as a JavaScript number, so a total
 * that is accepted is a total that can still be compared and subtracted
 * without a silent loss of precision.
 */
export const ROSTER_CONTRIBUTION_PATTERN = /^\d{1,15}$/;

/**
 * How a profession is read out of a Class value.
 *
 * The export writes `Starfleet Tactical Officer`, `KDF Engineering Officer`
 * and `RRF Tactical Officer`, among thirteen distinct values in the corpus.
 * The faction and the rank word carry no meaning this application needs; the
 * profession does, and it is the one word of the three that is fixed by the
 * game.
 *
 * Whole words, so a Fleet rank of `Sciences` or a ship called `Tactical Cube`
 * is not read as a profession by accident. Exactly one match counts: a value
 * naming two professions names neither, and guessing which was meant is how a
 * Character ends up filed under a career they do not have.
 */
export const ROSTER_PROFESSION_PATTERNS: readonly {
  /** What this pattern recognises. */
  readonly profession: RosterProfession;
  /** The whole word that recognises it, case-insensitively. */
  readonly pattern: RegExp;
}[] = [
  { profession: RosterProfession.TACTICAL, pattern: /\btactical\b/i },
  { profession: RosterProfession.ENGINEERING, pattern: /\bengineering\b/i },
  { profession: RosterProfession.SCIENCE, pattern: /\bscience\b/i },
];

/**
 * How many rows the preview draws back to whoever uploaded the file.
 *
 * Enough to see that a timezone is right, few enough that nobody reads the
 * screen as a roster. It exists to answer one question — does this look like
 * what you exported — and FC-020 builds the surface that answers the others,
 * behind the audience checks that surface needs.
 */
export const ROSTER_PREVIEW_SAMPLE_ROWS = 10;

/**
 * The longest a stored roster value may be, in characters.
 *
 * The width of the observation columns, stated where the reader can see it:
 * a value the table will not hold is refused while there is still a line
 * number to report it against. Generous by two orders of magnitude for every
 * column it applies to — in-game names and handles run to about twenty
 * characters — because the point is to have a bound rather than to police
 * one.
 */
export const ROSTER_STORED_TEXT_MAX_LENGTH = 255;

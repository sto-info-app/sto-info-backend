/**
 * The kind of answer a custom Field asks for.
 *
 * These identifiers are the feature's most permanent contract. A Field's type
 * is chosen once and never changes, because the type decides how every value
 * already recorded against it is stored, validated and rendered — silently
 * reinterpreting a stored decimal as a date, or a set of option references as
 * free text, would destroy data that the user cannot get back. Changing a
 * Field's kind therefore means creating a new Field and deleting the old one,
 * which is a decision the user makes knowingly.
 *
 * They are also stored, so they are deliberately machine values held apart
 * from the labels a user sees. Renaming "Single-line text" in the interface
 * must never require a data migration.
 *
 * Several pairs differ only in how they are presented — `TOGGLE` and
 * `CHECKBOX` both record a boolean, `RADIO` and `DROPDOWN` both record one
 * option — and they are kept as separate types rather than one type with a
 * presentation setting. A toggle and a checkbox mean different things to the
 * person answering, and because the type is immutable, collapsing them would
 * make the presentation the one property of a Field that could never be
 * corrected.
 */
export enum CustomTrackingFieldType {
  /** A short line of plain text. */
  TEXT_SINGLE_LINE = 'TEXT_SINGLE_LINE',
  /** A longer passage written in Markdown. */
  MARKDOWN = 'MARKDOWN',
  /** A whole number. */
  INTEGER = 'INTEGER',
  /** A number with a fractional part, held exactly. */
  DECIMAL = 'DECIMAL',
  /** A proportion, ordinarily between zero and one hundred. */
  PERCENTAGE = 'PERCENTAGE',
  /** A number chosen on a slider between creator-defined bounds. */
  RANGE = 'RANGE',
  /** A score out of three, five or ten. */
  RATING = 'RATING',
  /** A current figure against a maximum, such as a collection's completeness. */
  PROGRESS = 'PROGRESS',
  /** A calendar date, with no time and no timezone. */
  DATE = 'DATE',
  /** A wall-clock time in a named timezone. */
  TIME = 'TIME',
  /** A complete instant, stored in UTC with the timezone it was entered in. */
  DATE_TIME = 'DATE_TIME',
  /** A month within a year. */
  MONTH_YEAR = 'MONTH_YEAR',
  /** A four-digit year. */
  YEAR = 'YEAR',
  /** A length of time, held as its components rather than as text. */
  DURATION = 'DURATION',
  /** A start and end calendar date. */
  DATE_RANGE = 'DATE_RANGE',
  /** A start and end instant, stored in UTC with the entered timezone. */
  DATE_TIME_RANGE = 'DATE_TIME_RANGE',
  /** A yes-or-no answer presented as a switch. */
  TOGGLE = 'TOGGLE',
  /** A yes-or-no answer presented as a tick box. */
  CHECKBOX = 'CHECKBOX',
  /** One option from a list, all of them visible at once. */
  RADIO = 'RADIO',
  /** One option from a list, chosen from a menu. */
  DROPDOWN = 'DROPDOWN',
  /** Any number of options, all of them visible at once. */
  CHECKBOX_LIST = 'CHECKBOX_LIST',
  /** Any number of options, chosen from a menu. */
  MULTI_SELECT = 'MULTI_SELECT',
  /** Yes, no, or explicitly unknown. */
  YES_NO_UNKNOWN = 'YES_NO_UNKNOWN',
  /** A colour, held as a hexadecimal value. */
  COLOUR = 'COLOUR',
  /** Freely entered labels, normalised and de-duplicated. */
  TAGS = 'TAGS',
  /** One uploaded picture with its alternative text. */
  IMAGE = 'IMAGE',
  /** One YouTube video, held as a validated video identifier. */
  YOUTUBE = 'YOUTUBE',
}

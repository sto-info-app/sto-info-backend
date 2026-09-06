import { CUSTOM_TRACKING_MAX_NUMERIC_MAGNITUDE } from '../constants/custom-tracking-limits.constants';

/**
 * A decimal written out in full: optional sign, digits, optional fraction.
 *
 * Deliberately narrower than what `Number` will parse. Exponent notation,
 * hexadecimal, `Infinity` and `NaN` are all things `Number('1e400')` and its
 * kin accept and none of them is a figure a user typed into a box. Refusing
 * them here means the string that reaches the database is one a person could
 * read back.
 */
const DECIMAL_PATTERN = /^-?\d{1,19}(?:\.\d{1,10})?$/;

/**
 * A decimal broken into the parts an exact comparison needs.
 */
interface DecimalParts {
  /** True when the value is negative. */
  readonly negative: boolean;
  /** The digits before the point, without leading zeroes. */
  readonly whole: string;
  /** The digits after the point, without trailing zeroes. */
  readonly fraction: string;
}

/**
 * Determines whether a string is a decimal this feature will store.
 *
 * @param value - The candidate.
 * @returns True when the string is a well-formed decimal within range.
 */
export function isExactDecimal(value: unknown): value is string {
  return parseDecimal(value) !== null;
}

/**
 * Counts the decimal places a value actually uses.
 *
 * Trailing zeroes do not count. A user who types `1.50` into a field keeping
 * one decimal place has given a figure that fits, and telling them otherwise
 * would be pedantry about how they wrote it rather than about what they meant.
 *
 * @param value - A string already known to be a well-formed decimal.
 * @returns The number of significant decimal places.
 */
export function decimalPlaces(value: string): number {
  return parseDecimal(value)?.fraction.length ?? 0;
}

/**
 * Compares two decimals exactly.
 *
 * Done on the digits rather than by converting to numbers. Two values a user
 * typed can differ by less than a double can represent, and a bound checked
 * after that difference has been rounded away is not a bound.
 *
 * @param left - The first decimal.
 * @param right - The second decimal.
 * @returns Negative when left is smaller, positive when larger, zero when
 *   they are the same number.
 */
export function compareDecimals(left: string, right: string): number {
  const first = parseDecimal(left);
  const second = parseDecimal(right);

  // Neither is reachable with a validated value, but the comparison has to
  // answer something for a caller that has not validated yet.
  if (!first || !second) {
    return 0;
  }

  if (first.negative !== second.negative) {
    return first.negative ? -1 : 1;
  }

  const magnitude = compareMagnitudes(first, second);

  return first.negative ? -magnitude : magnitude;
}

/**
 * Reduces a decimal to its canonical spelling.
 *
 * `+`-free, without leading or trailing zeroes, and with negative zero written
 * as zero, since a zero carries no sign. Storing the canonical form means two
 * spellings of the same figure do not both exist, and that a value read back
 * looks like the one entered.
 *
 * @param value - A string already known to be a well-formed decimal.
 * @returns The canonical spelling, or null when the string is not a decimal.
 */
export function canonicaliseDecimal(value: string): string | null {
  const parts = parseDecimal(value);

  if (!parts) {
    return null;
  }

  const magnitude = parts.fraction
    ? `${parts.whole}.${parts.fraction}`
    : parts.whole;

  return parts.negative ? `-${magnitude}` : magnitude;
}

/**
 * Reads a decimal into its parts.
 *
 * @param value - The candidate.
 * @returns The parts, or null when the value is not a decimal in range.
 */
function parseDecimal(value: unknown): DecimalParts | null {
  if (typeof value !== 'string' || !DECIMAL_PATTERN.test(value)) {
    return null;
  }

  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [rawWhole, rawFraction = ''] = unsigned.split('.');

  const whole = rawWhole.replace(/^0+(?=\d)/, '');
  const fraction = rawFraction.replace(/0+$/, '');

  // Compared on the digits rather than by converting, so a figure far beyond
  // what a double can hold is refused rather than silently accepted as
  // whatever it rounds to.
  if (
    whole.length > String(CUSTOM_TRACKING_MAX_NUMERIC_MAGNITUDE).length ||
    (whole.length === String(CUSTOM_TRACKING_MAX_NUMERIC_MAGNITUDE).length &&
      whole > String(CUSTOM_TRACKING_MAX_NUMERIC_MAGNITUDE))
  ) {
    return null;
  }

  // A zero has no sign. Without this, `-0` and `0` would be reported as
  // different numbers, and `-0` would sort below every positive value.
  const isZero = whole === '0' && fraction === '';

  return { negative: negative && !isZero, whole, fraction };
}

/**
 * Compares two decimals' magnitudes, ignoring their signs.
 *
 * @param first - The first decimal's parts.
 * @param second - The second decimal's parts.
 * @returns Negative, zero or positive.
 */
function compareMagnitudes(first: DecimalParts, second: DecimalParts): number {
  if (first.whole.length !== second.whole.length) {
    return first.whole.length - second.whole.length;
  }

  if (first.whole !== second.whole) {
    return first.whole < second.whole ? -1 : 1;
  }

  // Padded to the same length so the fractions compare as text. Without it
  // `.9` would sort below `.11`, since text comparison stops at the first
  // differing character rather than aligning the decimal places.
  const width = Math.max(first.fraction.length, second.fraction.length);
  const left = first.fraction.padEnd(width, '0');
  const right = second.fraction.padEnd(width, '0');

  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

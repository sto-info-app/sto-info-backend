import {
  COMBINING_DIACRITICS_PATTERN,
  LEADING_HYPHENS_PATTERN,
  NON_ALPHANUMERIC_PATTERN,
} from '../constants/regex-patterns.constants';

/** Longest slug produced unless a caller asks for something shorter. */
export const DEFAULT_SLUG_MAX_LENGTH = 220;

/**
 * Reduces a title to the URL-safe form used for slugs.
 *
 * Accents are folded rather than dropped, so "Sécurité" becomes "securite"
 * instead of "scurit". Runs of anything else collapse to a single hyphen.
 *
 * This produces the slug's readable stem only. It makes no attempt at
 * uniqueness — callers decide whether to append a counter, a timestamp, or to
 * reject a collision outright, because the right answer differs by feature.
 *
 * @param value - The title to reduce.
 * @param maxLength - Longest slug to produce.
 * @returns The normalised slug, which is empty when the input has no
 *   alphanumeric characters at all.
 */
export function normaliseToSlug(
  value: string,
  maxLength: number = DEFAULT_SLUG_MAX_LENGTH,
): string {
  const normalised = value
    .toLowerCase()
    .normalize('NFKD')
    .replaceAll(COMBINING_DIACRITICS_PATTERN, '')
    .replaceAll(NON_ALPHANUMERIC_PATTERN, '-')
    .replace(LEADING_HYPHENS_PATTERN, '');

  return trimTrailingHyphens(
    trimTrailingHyphens(normalised).slice(0, maxLength),
  );
}

/**
 * Removes any trailing hyphens from a value.
 *
 * Applied again after truncation, because slicing can land mid-word and leave
 * a hyphen dangling at the end.
 *
 * @param value - The value to trim.
 * @returns The value without trailing hyphens.
 */
export function trimTrailingHyphens(value: string): string {
  let end = value.length;

  while (end > 0 && value[end - 1] === '-') {
    end -= 1;
  }

  return value.slice(0, end);
}
